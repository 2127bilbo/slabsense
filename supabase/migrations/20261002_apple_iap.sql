-- 2026-10-02 Apple in-app purchase ledger (App Store readiness fix group 3b; audit B-01, B-02,
-- B-03, B-10, B-14, Review Focus 1 and 2).
--
-- One paid product, two ways to buy it (src/lib/products.js):
--   subscription allowance -> profiles.sub_credits_balance, expires at the period end
--   consumable pack        -> profiles.credits_balance, never expires
-- spend_credits takes from the allowance first, then from the pack.
--
-- Every grant is idempotent on an external id (apple:<transactionId>, stripe:<session>) so a
-- replayed notification or a retried verify call can never credit twice.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sub_credits_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sub_credits_expire_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_source TEXT;          -- 'apple' | 'stripe'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT;
CREATE INDEX IF NOT EXISTS idx_profiles_apple_otid ON public.profiles(apple_original_transaction_id);

ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_transactions_external_id ON public.credit_transactions(external_id) WHERE external_id IS NOT NULL;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS bucket TEXT NOT NULL DEFAULT 'pack'; -- 'pack' | 'sub'

-- Every Apple transaction we have seen, decoded; the audit trail for the ledger.
CREATE TABLE IF NOT EXISTS public.apple_transactions (
  transaction_id            TEXT PRIMARY KEY,
  original_transaction_id   TEXT NOT NULL,
  user_id                   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  product_id                TEXT NOT NULL,
  type                      TEXT NOT NULL,            -- Apple's: 'Auto-Renewable Subscription' | 'Consumable' | ...
  environment               TEXT,                     -- 'Sandbox' | 'Production'
  quantity                  INTEGER NOT NULL DEFAULT 1,
  purchased_at              TIMESTAMPTZ,
  expires_at                TIMESTAMPTZ,
  revoked_at                TIMESTAMPTZ,
  last_notification         TEXT,                     -- notificationType/subtype that last touched it
  raw                       JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apple_transactions_otid ON public.apple_transactions(original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_apple_transactions_user ON public.apple_transactions(user_id);
ALTER TABLE public.apple_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own apple transactions" ON public.apple_transactions;
CREATE POLICY "own apple transactions" ON public.apple_transactions FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.apple_transactions FROM authenticated, anon;

-- Idempotent grant. Returns {success, granted, duplicate, balances}.
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_bucket text,              -- 'pack' | 'sub'
  p_external_id text,         -- e.g. 'apple:2000000123456789'
  p_description text default null,
  p_expires_at timestamptz default null,  -- for 'sub': the period end
  p_payment_ref text default null         -- Stripe payment intent, for refunds
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile profiles%rowtype;
  v_tx_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 OR p_bucket NOT IN ('pack', 'sub') OR p_external_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;
  IF EXISTS (SELECT 1 FROM credit_transactions WHERE external_id = p_external_id) THEN
    SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'granted', 0,
      'credits_balance', coalesce(v_profile.credits_balance, 0), 'sub_credits_balance', coalesce(v_profile.sub_credits_balance, 0));
  END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'user_not_found'); END IF;
  IF p_bucket = 'pack' THEN
    -- packs never expire: a pack grant also clears the legacy 30-day expiry on the pack bucket
    UPDATE profiles SET credits_balance = coalesce(credits_balance, 0) + p_amount, credits_expire_at = NULL WHERE id = p_user_id;
  ELSE
    -- a new period replaces the old allowance rather than stacking it
    UPDATE profiles SET sub_credits_balance = p_amount, sub_credits_expire_at = p_expires_at WHERE id = p_user_id;
  END IF;
  INSERT INTO credit_transactions (user_id, amount, transaction_type, description, external_id, bucket, stripe_payment_id)
    VALUES (p_user_id, p_amount, 'purchase', coalesce(p_description, 'Purchase'), p_external_id, p_bucket, p_payment_ref)
    RETURNING id INTO v_tx_id;
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  RETURN jsonb_build_object('success', true, 'duplicate', false, 'granted', p_amount, 'transaction_id', v_tx_id,
    'credits_balance', coalesce(v_profile.credits_balance, 0), 'sub_credits_balance', coalesce(v_profile.sub_credits_balance, 0));
END $$;

-- Refund / revoke of a purchase: take back what is left of it (never below zero), once.
CREATE OR REPLACE FUNCTION public.revoke_credits(
  p_user_id uuid,
  p_external_id text,          -- the purchase's external id
  p_reason text default 'refund'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_purchase credit_transactions%rowtype;
  v_profile profiles%rowtype;
  v_take integer;
BEGIN
  SELECT * INTO v_purchase FROM credit_transactions WHERE external_id = p_external_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'purchase_not_found'); END IF;
  IF EXISTS (SELECT 1 FROM credit_transactions WHERE external_id = p_external_id || ':revoked') THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'revoked', 0);
  END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_purchase.bucket = 'sub' THEN
    v_take := coalesce(v_profile.sub_credits_balance, 0);
    UPDATE profiles SET sub_credits_balance = 0, sub_credits_expire_at = NULL WHERE id = p_user_id;
  ELSE
    v_take := LEAST(coalesce(v_profile.credits_balance, 0), v_purchase.amount);
    UPDATE profiles SET credits_balance = coalesce(credits_balance, 0) - v_take WHERE id = p_user_id;
  END IF;
  INSERT INTO credit_transactions (user_id, amount, transaction_type, description, external_id, bucket)
    VALUES (p_user_id, -v_take, 'revoke', p_reason, p_external_id || ':revoked', v_purchase.bucket);
  RETURN jsonb_build_object('success', true, 'duplicate', false, 'revoked', v_take);
END $$;

-- Refund arriving as a Stripe charge: find the purchase by its payment intent, then revoke it.
CREATE OR REPLACE FUNCTION public.revoke_credits_by_payment(
  p_user_id uuid,
  p_payment_ref text,
  p_reason text default 'stripe refund'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ext text;
BEGIN
  SELECT external_id INTO v_ext FROM credit_transactions
    WHERE user_id = p_user_id AND stripe_payment_id = p_payment_ref AND external_id IS NOT NULL AND transaction_type = 'purchase'
    ORDER BY created_at DESC LIMIT 1;
  IF v_ext IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'purchase_not_found'); END IF;
  RETURN revoke_credits(p_user_id, v_ext, p_reason);
END $$;

-- spend_credits v2: allowance first (if not expired), then the pack.
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_user_id uuid,
  p_grade_type text,
  p_cost integer,
  p_scan_id uuid default null
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile profiles%rowtype;
  v_tx_id uuid;
  v_type text;
  v_label text;
  v_sub integer;
  v_from_sub integer;
  v_from_pack integer;
  v_total integer;
BEGIN
  IF p_grade_type NOT IN ('ai', 'deep') OR p_cost IS NULL OR p_cost < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;
  v_type := CASE WHEN p_grade_type = 'deep' THEN 'grade_deep' ELSE 'grade_ai' END;
  v_label := CASE WHEN p_grade_type = 'deep' THEN 'Deep' ELSE 'AI' END;
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'user_not_found'); END IF;
  IF v_profile.subscription_status IN ('lifetime', 'beta_lifetime') THEN
    INSERT INTO credit_transactions (user_id, amount, transaction_type, description, scan_id)
      VALUES (p_user_id, 0, v_type, v_label || ' grade (lifetime - no charge)', p_scan_id) RETURNING id INTO v_tx_id;
    RETURN jsonb_build_object('success', true, 'credits_spent', 0, 'credits_remaining', 'unlimited', 'transaction_id', v_tx_id, 'is_lifetime', true);
  END IF;
  v_sub := CASE WHEN v_profile.sub_credits_expire_at IS NOT NULL AND v_profile.sub_credits_expire_at < now() THEN 0 ELSE coalesce(v_profile.sub_credits_balance, 0) END;
  v_total := v_sub + coalesce(v_profile.credits_balance, 0);
  IF v_total < p_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credits', 'credits_required', p_cost, 'credits_remaining', v_total);
  END IF;
  v_from_sub := LEAST(v_sub, p_cost);
  v_from_pack := p_cost - v_from_sub;
  UPDATE profiles SET sub_credits_balance = v_sub - v_from_sub, credits_balance = coalesce(credits_balance, 0) - v_from_pack WHERE id = p_user_id;
  INSERT INTO credit_transactions (user_id, amount, transaction_type, description, scan_id, bucket)
    VALUES (p_user_id, -p_cost, v_type, v_label || ' grade', p_scan_id, CASE WHEN v_from_pack = 0 THEN 'sub' ELSE 'pack' END)
    RETURNING id INTO v_tx_id;
  RETURN jsonb_build_object('success', true, 'credits_spent', p_cost, 'credits_remaining', v_total - p_cost, 'transaction_id', v_tx_id, 'is_lifetime', false,
                            'from_sub', v_from_sub, 'from_pack', v_from_pack);
END $$;

-- ---------------------------------------------------------------------------
-- WHO MAY CALL THESE.
--
-- Postgres grants EXECUTE on a new function to PUBLIC, and in Supabase both
-- `anon` and `authenticated` inherit that, with PostgREST exposing every
-- public-schema function at /rest/v1/rpc/<name>. So a SECURITY DEFINER
-- function left at the default is callable from any browser holding the anon
-- key - and being SECURITY DEFINER, it runs as the owner and bypasses every
-- table grant.
--
-- These three take p_user_id as a PARAMETER and never consult auth.uid(), so
-- at the default they would let any signed-in user mint credits for
-- themselves, and zero out any other user's balance. That is exactly the hole
-- 20261001_lockdown.sql closed by revoking UPDATE on profiles and INSERT on
-- credit_transactions; defining these without revoking would re-open it
-- through the front door.
--
-- Same pattern 20260915_credits_atomic.sql already uses for spend_credits.
-- Every caller is server-side via serviceDb() (api/_lib/route.js), and
-- service_role bypasses these grants, so nothing legitimate loses access.
--
-- spend_credits is re-revoked belt-and-braces: CREATE OR REPLACE preserves the
-- existing ACL and the signature is unchanged, so its 20260915 revoke already
-- survives - but stating it here keeps the file true on its own.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.grant_credits(uuid, integer, text, text, text, timestamptz, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credits(uuid, integer, text, text, text, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.revoke_credits(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_credits(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.revoke_credits_by_payment(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_credits_by_payment(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.spend_credits(uuid, text, integer, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid, text, integer, uuid) TO service_role;

COMMIT;
