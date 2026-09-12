-- 20260912_slabs.sql — slabbing orders, cert numbers, public cert view
-- Apply in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS / OR REPLACE throughout).

-- Columns the app already writes (src/services/scans.js) but no earlier migration declares.
alter table scans add column if not exists card_info jsonb;
alter table scans add column if not exists enhanced_front_path text;
alter table scans add column if not exists enhanced_back_path text;

create sequence if not exists slab_cert_seq;

create or replace function next_cert() returns text
language sql volatile security definer set search_path = public as $$
  select 'SS' || to_char(now() at time zone 'utc', 'YY') || '-' || lpad(nextval('public.slab_cert_seq')::text, 5, '0');
$$;

create table if not exists slabs (
  id                 uuid primary key default gen_random_uuid(),
  cert               text unique not null default next_cert(),
  scan_id            uuid not null references scans(id),
  user_id            uuid not null references profiles(id),
  status             text not null default 'paid' check (status in ('paid','engraved','shipped')),
  stripe_session_id  text unique,
  shipping           jsonb,
  label_svg_path     text,
  slab_image_path    text,
  paid_at            timestamptz not null default now(),
  engraved_at        timestamptz,
  shipped_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists slabs_status_idx on slabs(status, paid_at);
create index if not exists slabs_scan_idx on slabs(scan_id);

alter table slabs enable row level security;
drop policy if exists "owner reads own slabs" on slabs;
create policy "owner reads own slabs" on slabs for select using (auth.uid() = user_id);
-- No insert/update policies: only the service role (webhook, admin routes) writes.

-- Public projection: the ONLY thing the anonymous cert page reads.
create or replace view slab_public with (security_invoker = false) as
select
  s.cert, s.status, s.paid_at, s.engraved_at, s.shipped_at,
  c.card_name, c.card_set, c.card_number, c.card_game, c.card_info,
  c.grade_value, c.grade_label, c.subgrades, c.front_centering, c.back_centering, c.dings,
  c.user_card_image, c.enhanced_front_path, c.enhanced_back_path, c.front_image_path, c.back_image_path
from slabs s
join scans c on c.id = s.scan_id;

-- Revoke direct grants: the public cert page reads this view through api/slab.js using the
-- Supabase service role, which bypasses RLS/grants entirely. Anon/authenticated clients should
-- never query slab_public straight from the browser (no per-cert filtering to hide behind).
revoke select on slab_public from anon, authenticated;

-- Label SVGs, private; written by admin routes only.
insert into storage.buckets (id, name, public)
values ('slab-labels', 'slab-labels', false)
on conflict (id) do nothing;
