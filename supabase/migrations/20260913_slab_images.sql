-- 20260913_slab_images.sql — cert-keyed slab images; slab_public stops exposing per-user image paths.
-- Apply in the Supabase SQL editor after 20260912_slabs.sql. Safe to re-run.

alter table slabs add column if not exists front_image_url text;
alter table slabs add column if not exists back_image_url text;

-- Public bucket: the cert page and anyone with the URL can read; only the service role writes.
insert into storage.buckets (id, name, public)
values ('slab-images', 'slab-images', true)
on conflict (id) do update set public = true;

drop policy if exists "public read slab-images" on storage.objects;
create policy "public read slab-images" on storage.objects
  for select using (bucket_id = 'slab-images');

-- Column set changes, so the view must be dropped (create or replace cannot remove columns).
drop view if exists slab_public;
create view slab_public with (security_invoker = false) as
select
  s.cert, s.status, s.paid_at, s.engraved_at, s.shipped_at,
  c.card_name, c.card_set, c.card_number, c.card_game, c.card_info,
  c.grade_value, c.grade_label, c.subgrades, c.front_centering, c.back_centering, c.dings,
  s.front_image_url, s.back_image_url
from slabs s
join scans c on c.id = s.scan_id;

-- The cert page reads through api/slab (service role); no direct anon/authenticated access.
revoke select on slab_public from anon, authenticated;
