-- 20260915_credits_atomic.sql
-- Atomic, idempotent credit spend / refund for AI grades.
--
-- Why: api/credits/spend.js did a read-modify-write on profiles.credits_balance (two
-- overlapping taps lost a deduction) and returned no transaction id when the log insert
-- failed, which made the client's refund impossible ("charged, no result").
-- These functions run under SECURITY DEFINER and are callable by the service role only;
-- the serverless endpoints verify the user's JWT and pass the user id themselves.
-- The endpoints fall back to the old path until this migration is applied.

-- ──────────────────────────────────────────────────────────────────────────
-- Bootstrap (2026-09-15): the owner's project never had 002_credits_system.sql applied — the
-- credit_transactions table did not exist, which is why the old spend endpoint's log insert failed
-- silently and refunds were impossible. Everything below is idempotent, so this file can be run on a
-- project with or without 002 applied. (002 still owns stripe_events / referrals / system_settings.)
-- ──────────────────────────────────────────────────────────────────────────
alter table profiles add column if not exists stripe_customer_id text;
alter table profiles add column if not exists subscription_status text default 'free';
alter table profiles add column if not exists subscription_id text;
alter table profiles add column if not exists subscription_renews_at timestamptz;
alter table profiles add column if not exists credits_balance integer default 0;
alter table profiles add column if not exists credits_expire_at timestamptz;
alter table profiles add column if not exists used_trial boolean default false;
alter table profiles add column if not exists signup_bonus_awarded boolean default false;
alter table profiles add column if not exists signup_bonus_eligible boolean default true;
alter table profiles add column if not exists cards_saved_count integer default 0;

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  amount integer not null,
  transaction_type text not null,
    -- 'subscription', 'bundle', 'single', 'signup_bonus', 'referral_bonus',
    -- 'grade_ai', 'grade_deep', 'refund', 'expired'
  description text,
  stripe_payment_id text,
  scan_id uuid,
  created_at timestamptz default now()
);
create index if not exists idx_credit_transactions_user_id on credit_transactions(user_id);
create index if not exists idx_credit_transactions_created_at on credit_transactions(created_at);

alter table credit_transactions enable row level security;
drop policy if exists "Users can view own transactions" on credit_transactions;
create policy "Users can view own transactions" on credit_transactions
  for select using (auth.uid() = user_id);
-- Writes happen through the service role (endpoints / the functions below); no user write policies.

alter table credit_transactions add column if not exists refunded_at timestamptz;
alter table credit_transactions add column if not exists refund_of uuid references credit_transactions(id);
create index if not exists idx_credit_transactions_refund_of on credit_transactions(refund_of);

-- ──────────────────────────────────────────────────────────────────────────
-- spend_credits: lock the profile row, check lifetime / expiry / balance,
-- deduct, log — all in one transaction. Cost is passed in by the server
-- (src/lib/grade-tiers.js is the single source of truth).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function spend_credits(
  p_user_id uuid,
  p_grade_type text,
  p_cost integer,
  p_scan_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_tx_id uuid;
  v_type text;
  v_label text;
  v_new integer;
begin
  if p_grade_type not in ('ai', 'deep') or p_cost is null or p_cost < 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_request');
  end if;
  v_type := case when p_grade_type = 'deep' then 'grade_deep' else 'grade_ai' end;
  v_label := case when p_grade_type = 'deep' then 'Deep' else 'AI' end;

  select * into v_profile from profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'user_not_found');
  end if;

  -- Lifetime / beta accounts: no charge, but the usage is still logged (refundable as 0).
  if v_profile.subscription_status in ('lifetime', 'beta_lifetime') then
    insert into credit_transactions (user_id, amount, transaction_type, description, scan_id)
      values (p_user_id, 0, v_type, v_label || ' grade (lifetime - no charge)', p_scan_id)
      returning id into v_tx_id;
    return jsonb_build_object('success', true, 'credits_spent', 0, 'credits_remaining', 'unlimited',
                              'transaction_id', v_tx_id, 'is_lifetime', true);
  end if;

  if v_profile.credits_expire_at is not null and v_profile.credits_expire_at < now() then
    return jsonb_build_object('success', false, 'error', 'credits_expired', 'credits_remaining', 0);
  end if;

  if coalesce(v_profile.credits_balance, 0) < p_cost then
    return jsonb_build_object('success', false, 'error', 'insufficient_credits',
                              'credits_required', p_cost,
                              'credits_remaining', coalesce(v_profile.credits_balance, 0));
  end if;

  v_new := coalesce(v_profile.credits_balance, 0) - p_cost;
  update profiles set credits_balance = v_new where id = p_user_id;
  insert into credit_transactions (user_id, amount, transaction_type, description, scan_id)
    values (p_user_id, -p_cost, v_type, v_label || ' grade', p_scan_id)
    returning id into v_tx_id;

  return jsonb_build_object('success', true, 'credits_spent', p_cost, 'credits_remaining', v_new,
                            'transaction_id', v_tx_id, 'is_lifetime', false);
end
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- refund_credits: refund exactly one grade transaction, once. Never extends
-- the credit expiry (the old endpoint added 30 days on every refund).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function refund_credits(
  p_user_id uuid,
  p_transaction_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx credit_transactions%rowtype;
  v_amount integer;
  v_new integer;
  v_refund_id uuid;
begin
  select * into v_tx from credit_transactions where id = p_transaction_id for update;
  if not found or v_tx.user_id is distinct from p_user_id then
    return jsonb_build_object('success', false, 'error', 'transaction_not_found');
  end if;
  if v_tx.transaction_type not in ('grade_ai', 'grade_deep') then
    return jsonb_build_object('success', false, 'error', 'not_refundable');
  end if;
  if v_tx.refunded_at is not null then
    select credits_balance into v_new from profiles where id = p_user_id;
    return jsonb_build_object('success', true, 'already_refunded', true, 'credits_refunded', 0,
                              'credits_remaining', coalesce(v_new, 0));
  end if;

  v_amount := abs(v_tx.amount);
  update credit_transactions set refunded_at = now() where id = p_transaction_id;

  if v_amount = 0 then
    return jsonb_build_object('success', true, 'credits_refunded', 0, 'credits_remaining', 'unlimited');
  end if;

  update profiles set credits_balance = coalesce(credits_balance, 0) + v_amount
    where id = p_user_id
    returning credits_balance into v_new;
  insert into credit_transactions (user_id, amount, transaction_type, description, refund_of)
    values (p_user_id, v_amount, 'refund', coalesce(p_reason, 'Refund: AI grading failed'), p_transaction_id)
    returning id into v_refund_id;

  return jsonb_build_object('success', true, 'credits_refunded', v_amount, 'credits_remaining', v_new,
                            'refund_transaction_id', v_refund_id);
end
$$;

revoke all on function spend_credits(uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function refund_credits(uuid, uuid, text) from public, anon, authenticated;
grant execute on function spend_credits(uuid, text, integer, uuid) to service_role;
grant execute on function refund_credits(uuid, uuid, text) to service_role;
