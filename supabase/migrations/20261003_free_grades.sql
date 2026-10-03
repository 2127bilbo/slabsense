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
