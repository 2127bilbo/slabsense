-- 2026-10-02 account deletion (App Store readiness audit A-04, F-01, F-06, L-01, L-02).
--
-- Deleting a user who had ever ordered a slab failed with a raw foreign-key error, because
-- slabs.scan_id / slabs.user_id had no ON DELETE rule and were NOT NULL. The physical cert and its
-- public page outlive the account (the label is already stored on the row), so the person is
-- detached and the shipping address is purged instead of the record being destroyed.
-- The service-role route api/account.js does the detach explicitly; these rules make a direct
-- profile delete safe as well.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

BEGIN;

ALTER TABLE public.slabs ALTER COLUMN scan_id DROP NOT NULL;
ALTER TABLE public.slabs ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.slabs DROP CONSTRAINT IF EXISTS slabs_scan_id_fkey;
ALTER TABLE public.slabs ADD CONSTRAINT slabs_scan_id_fkey
  FOREIGN KEY (scan_id) REFERENCES public.scans(id) ON DELETE SET NULL;

ALTER TABLE public.slabs DROP CONSTRAINT IF EXISTS slabs_user_id_fkey;
ALTER TABLE public.slabs ADD CONSTRAINT slabs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- The public cert view must not depend on the owner still existing.
-- (slab_public selects from slabs only; no change needed, recorded here for the audit.)

COMMIT;
