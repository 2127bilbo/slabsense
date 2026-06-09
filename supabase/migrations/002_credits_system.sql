-- SlabSense Credits & Subscription System
-- Run this in Supabase SQL Editor

-- ============================================
-- Update profiles table with credit/subscription fields
-- ============================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free';
  -- Values: 'free', 'trial', 'hobby', 'pro', 'dealer', 'lifetime', 'beta_lifetime'
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_renews_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits_balance INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits_expire_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS used_trial BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signup_bonus_awarded BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signup_bonus_eligible BOOLEAN DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cards_saved_count INTEGER DEFAULT 0;

-- ============================================
-- Credit transactions log
-- ============================================

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
    -- 'subscription', 'bundle', 'single', 'signup_bonus', 'referral_bonus',
    -- 'grade_ai', 'grade_deep', 'refund', 'expired'
  description TEXT,
  stripe_payment_id TEXT,
  scan_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at);

-- ============================================
-- Stripe webhook idempotency
-- ============================================

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Referral tracking
-- ============================================

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  referred_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- 'pending', 'qualified', 'credited'
  qualified_at TIMESTAMPTZ,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);

-- ============================================
-- System settings (for referral toggle, etc.)
-- ============================================

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize referrals as enabled
INSERT INTO system_settings (key, value)
VALUES ('referrals_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- RLS Policies
-- ============================================

-- Credit transactions: Users can only see their own
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions" ON credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert transactions" ON credit_transactions
  FOR INSERT WITH CHECK (true);

-- Stripe events: Only service role
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON stripe_events
  FOR ALL USING (false);

-- Referrals: Users can see referrals they made
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referrals" ON referrals
  FOR SELECT USING (auth.uid() = referrer_id);

-- System settings: Read only for users
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read settings" ON system_settings
  FOR SELECT USING (true);

-- ============================================
-- Set up lifetime accounts (run after migration)
-- Replace YOUR_USER_ID and FRIEND_USER_ID with actual UUIDs
-- ============================================

-- UPDATE profiles SET
--   subscription_status = 'lifetime',
--   credits_balance = 100,
--   credits_expire_at = NOW() + INTERVAL '30 days'
-- WHERE id = 'YOUR_USER_ID';

-- UPDATE profiles SET
--   subscription_status = 'beta_lifetime',
--   credits_balance = 100,
--   credits_expire_at = NOW() + INTERVAL '30 days'
-- WHERE id = 'FRIEND_USER_ID';
