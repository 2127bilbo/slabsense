-- 2026-10-03 Free tier counter: free accounts get FREE_TIER.gradesPerMonth on-device grades per UTC
-- calendar month (src/lib/products.js, owner decision 2026-10-02). Only use_free_grade() moves the
-- counter; the lockdown migration keeps clients from touching these columns. Safe to re-run.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS free_grades_month TEXT;           -- 'YYYY-MM' (UTC)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS free_grades_used INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.use_free_grade(p_user_id uuid, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month text := to_char((now() at time zone 'UTC'), 'YYYY-MM');
  v_used integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 0 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_request'); END IF;
  SELECT CASE WHEN free_grades_month = v_month THEN free_grades_used ELSE 0 END INTO v_used
    FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'user_not_found'); END IF;
  IF v_used >= p_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'free_grades_exhausted', 'used', v_used, 'limit', p_limit, 'remaining', 0, 'month', v_month);
  END IF;
  UPDATE profiles SET free_grades_month = v_month, free_grades_used = v_used + 1 WHERE id = p_user_id;
  RETURN jsonb_build_object('success', true, 'used', v_used + 1, 'limit', p_limit, 'remaining', p_limit - v_used - 1, 'month', v_month);
END $$;

REVOKE ALL ON FUNCTION public.use_free_grade(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Free-account collection cap (FREE_TIER.collectionLimit in src/lib/products.js; a test checks the
-- numbers match). Plus, trial, grace and lifetime are unlimited, using the same rule as isUnlimited():
-- a paid status counts while its period is current plus 3 days. Existing cards are never removed;
-- only a new save past the cap is refused, before any photo is uploaded for it.
CREATE OR REPLACE FUNCTION public.enforce_collection_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_collection_limit integer := 25;
  v_status text;
  v_renews timestamptz;
  v_count integer;
BEGIN
  SELECT subscription_status, subscription_renews_at INTO v_status, v_renews FROM profiles WHERE id = NEW.user_id;
  IF v_status IN ('lifetime', 'beta_lifetime') THEN RETURN NEW; END IF;
  IF v_status IN ('sub_monthly', 'trialing', 'grace') AND (v_renews IS NULL OR v_renews > now() - interval '3 days') THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM scans WHERE user_id = NEW.user_id;
  IF v_count >= v_collection_limit THEN
    RAISE EXCEPTION 'collection_limit_reached: %', v_collection_limit USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scans_collection_limit ON public.scans;
CREATE TRIGGER scans_collection_limit BEFORE INSERT ON public.scans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_collection_limit();

-- ---------------------------------------------------------------------------------------------
-- card-images bucket rules (owner, 2026-10-02): a signed-in user may only write
--   <their id>/<a card they own>/...             saved card photos and opted-in training photos
--   <their id>/standard-analysis|deep-analysis/  AI Grade uploads (deleted by scripts/storage/cleanup-grade-uploads.mjs)
-- so photos cannot be parked in storage without a saved card (which the collection cap limits).
-- Files: 10 MB max, images plus JSON (training labels). Public URLs keep working (public bucket).
-- The old rules were made in the dashboard with unknown names: every card-images rule is dropped
-- and these four are created. The service role (API routes, account deletion) is not affected.
-- ---------------------------------------------------------------------------------------------
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/json']
 WHERE id = 'card-images';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects'
              AND (coalesce(qual, '') ILIKE '%card-images%' OR coalesce(with_check, '') ILIKE '%card-images%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- the rule both write policies share
CREATE OR REPLACE FUNCTION public.card_images_writable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND (storage.foldername(p_name))[1] = auth.uid()::text
     AND (
       (storage.foldername(p_name))[2] IN ('standard-analysis', 'deep-analysis')
       OR EXISTS (SELECT 1 FROM public.scans s
                   WHERE s.id::text = (storage.foldername(p_name))[2] AND s.user_id = auth.uid())
     );
$$;

CREATE POLICY "card-images: owner reads own folder" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'card-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "card-images: upload to own card or grade folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'card-images' AND public.card_images_writable(name));

CREATE POLICY "card-images: replace in own card or grade folder" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'card-images' AND public.card_images_writable(name))
  WITH CHECK (bucket_id = 'card-images' AND public.card_images_writable(name));

CREATE POLICY "card-images: owner deletes own files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'card-images' AND (storage.foldername(name))[1] = auth.uid()::text);
