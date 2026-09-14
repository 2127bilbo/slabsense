-- 20260914_slab_label.sql — what was engraved: the exact label text and settings, stored at engrave time.
-- Apply in the Supabase SQL editor after 20260913_slab_images.sql. Safe to re-run.

alter table slabs add column if not exists label_text jsonb;
alter table slabs add column if not exists label_settings jsonb;

drop view if exists slab_public;
create view slab_public with (security_invoker = false) as
select
  s.cert, s.status, s.paid_at, s.engraved_at, s.shipped_at,
  c.card_name, c.card_set, c.card_number, c.card_game, c.card_info,
  c.grade_value, c.grade_label, c.subgrades, c.front_centering, c.back_centering, c.dings,
  s.front_image_url, s.back_image_url,
  s.label_text, s.label_settings
from slabs s
join scans c on c.id = s.scan_id;

revoke select on slab_public from anon, authenticated;
