-- Migration: Add user_card_image to scans and missing_images tracking table
-- Date: 2026-04-14

-- Add user_card_image column to scans for user-cropped fallback images
ALTER TABLE scans ADD COLUMN IF NOT EXISTS user_card_image TEXT;

-- Create missing_images table to track cards without TCGDex images
-- This helps us identify which cards need images added to the database
CREATE TABLE IF NOT EXISTS missing_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tcgdex_id TEXT NOT NULL UNIQUE,
  card_name TEXT,
  set_name TEXT,
  card_number TEXT,
  report_count INTEGER DEFAULT 1,
  first_reported TIMESTAMPTZ DEFAULT NOW(),
  last_reported TIMESTAMPTZ DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  notes TEXT
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_missing_images_tcgdex_id ON missing_images(tcgdex_id);
CREATE INDEX IF NOT EXISTS idx_missing_images_resolved ON missing_images(resolved);

-- Comment for documentation
COMMENT ON TABLE missing_images IS 'Tracks TCGDex cards that have no image available, so we can add them manually';
COMMENT ON COLUMN scans.user_card_image IS 'User-cropped card image URL when TCGDex has no image available';
