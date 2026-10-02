-- 2026-10-01 security lockdown (App Store readiness audit G-01, G-02, B-03).
--
-- 1. profiles: the "update own profile" policy had no column restriction, so a signed-in user
--    could set credits_balance / subscription_status / stripe_customer_id from the browser with
--    the anon key. Row-level security cannot restrict columns; column-level GRANTs can. The
--    app's only legitimate self-service writes are the three columns granted below
--    (src/services/auth.js updateProfile ← ProfileSettings.jsx). The API uses the service role,
--    which is unaffected.
-- 2. credit_transactions: the INSERT policy was WITH CHECK (true), so any user could insert a fake
--    negative "grade_ai" row and have /api/credits/refund credit abs(amount). Only the service
--    role writes this table, and the service role bypasses RLS, so the policy is simply dropped.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

BEGIN;

-- 1. profiles: column-level update rights for signed-in users
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (display_name, username, preferred_company) ON TABLE public.profiles TO authenticated;
-- anon never updates profiles
REVOKE UPDATE ON TABLE public.profiles FROM anon;

-- 2. credit_transactions: no client inserts
DROP POLICY IF EXISTS "Service role can insert transactions" ON public.credit_transactions;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.credit_transactions FROM authenticated, anon;

COMMIT;

-- Verify (run as a signed-in user via the app, or with `set role authenticated` + a JWT claim):
--   update profiles set credits_balance = 999 where id = auth.uid();   -- must fail: permission denied
--   update profiles set display_name = 'x' where id = auth.uid();      -- must succeed
--   insert into credit_transactions (user_id, amount, type) values (auth.uid(), -500, 'grade_ai'); -- must fail
