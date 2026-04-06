-- SlabSense Database Schema
-- Run this in Supabase SQL Editor (supabase.com → SQL Editor → New Query)

-- ============================================
-- PROFILES TABLE (extends Supabase auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  display_name TEXT,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'beta_lifetime', 'pro_monthly')),
  preferred_company TEXT DEFAULT 'tag' CHECK (preferred_company IN ('tag', 'psa', 'bgs', 'cgc', 'sgc')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Row Level Security)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- SCANS TABLE (user's graded cards)
-- ============================================
CREATE TABLE IF NOT EXISTS scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Card identification (optional - for future card database)
  card_name TEXT,
  card_set TEXT,
  card_number TEXT,
  card_game TEXT DEFAULT 'pokemon' CHECK (card_game IN ('pokemon', 'mtg', 'yugioh', 'sports', 'other')),

  -- Images (stored in Supabase Storage)
  front_image_path TEXT,
  back_image_path TEXT,

  -- Grading results
  grading_company TEXT DEFAULT 'tag' CHECK (grading_company IN ('tag', 'psa', 'bgs', 'cgc', 'sgc')),
  raw_score INTEGER CHECK (raw_score >= 0 AND raw_score <= 1000),
  grade_value NUMERIC(3,1),
  grade_label TEXT,

  -- Subgrades (JSON for flexibility)
  subgrades JSONB DEFAULT '{}',
  -- Example: {"frontCenter": 920, "backCenter": 970, "condition": 950}

  -- Centering data
  front_centering JSONB DEFAULT '{}',
  -- Example: {"lrRatio": 52.3, "tbRatio": 48.1}
  back_centering JSONB DEFAULT '{}',

  -- Detected defects
  dings JSONB DEFAULT '[]',
  -- Example: [{"side": "FRONT", "type": "CORNER WEAR", "location": "FRONT / TOP LEFT", "severity": 1}]

  -- Metadata
  notes TEXT,
  is_favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

-- Users can only see their own scans
CREATE POLICY "Users can view own scans" ON scans
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own scans
CREATE POLICY "Users can insert own scans" ON scans
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own scans
CREATE POLICY "Users can update own scans" ON scans
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own scans
CREATE POLICY "Users can delete own scans" ON scans
  FOR DELETE USING (auth.uid() = user_id);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS scans_user_id_idx ON scans(user_id);
CREATE INDEX IF NOT EXISTS scans_created_at_idx ON scans(created_at DESC);

-- ============================================
-- MEMBERSHIPS TABLE (for paid tiers)
-- ============================================
CREATE TABLE IF NOT EXISTS memberships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('beta_lifetime', 'pro_monthly')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  amount_paid NUMERIC(10,2),
  currency TEXT DEFAULT 'USD',
  stripe_payment_id TEXT,
  stripe_subscription_id TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- NULL for lifetime
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- Users can only see their own memberships
CREATE POLICY "Users can view own memberships" ON memberships
  FOR SELECT USING (auth.uid() = user_id);

-- Index
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships(user_id);

-- ============================================
-- HELPER FUNCTION: Update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to profiles
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Apply to scans
DROP TRIGGER IF EXISTS scans_updated_at ON scans;
CREATE TRIGGER scans_updated_at
  BEFORE UPDATE ON scans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- STORAGE BUCKET (for card images)
-- ============================================
-- Note: Run this separately or in Supabase Dashboard → Storage → New Bucket
-- Bucket name: card-images
-- Public: No (private, accessed via signed URLs)
