-- Migration: Create graded_references table for two-pass grading system
-- This table stores 509 TAG-graded Pokemon cards as reference examples

CREATE TABLE IF NOT EXISTS graded_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cert TEXT UNIQUE NOT NULL,

  -- Card identification
  card_name TEXT NOT NULL,
  card_number TEXT,
  set_name TEXT,
  set_year INTEGER,

  -- Grade info
  grade TEXT NOT NULL,           -- "10 PRISTINE", "9 MINT", etc.
  grade_numeric DECIMAL NOT NULL, -- 10, 9, 8.5, 8, etc. for sorting/filtering
  score INTEGER,                  -- TAG 1000-point score

  -- Centering (stored as deviation %)
  centering_front_lr DECIMAL,     -- Left/Right deviation %
  centering_front_tb DECIMAL,     -- Top/Bottom deviation %
  centering_back_lr DECIMAL,
  centering_back_tb DECIMAL,

  -- Defects
  defect_count INTEGER DEFAULT 0,
  corner_defects INTEGER DEFAULT 0,
  edge_defects INTEGER DEFAULT 0,
  surface_defects INTEGER DEFAULT 0,
  defect_details JSONB,           -- Full defect list with locations

  -- Card metadata
  card_type TEXT DEFAULT 'modern_holo',  -- vintage_holo, modern_holo, non_holo

  -- Images (CloudFront URLs from TAG)
  img_front TEXT,
  img_back TEXT,
  img_surface_front TEXT,
  img_surface_back TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for similarity queries
CREATE INDEX idx_graded_refs_grade ON graded_references(grade_numeric);
CREATE INDEX idx_graded_refs_defects ON graded_references(defect_count);
CREATE INDEX idx_graded_refs_card_type ON graded_references(card_type);
CREATE INDEX idx_graded_refs_centering ON graded_references(centering_front_lr, centering_back_lr);

-- Composite index for the weighted similarity query
CREATE INDEX idx_graded_refs_similarity ON graded_references(
  grade_numeric,
  defect_count,
  centering_front_lr,
  card_type
);

-- Enable Row Level Security (optional, for public read access)
ALTER TABLE graded_references ENABLE ROW LEVEL SECURITY;

-- Allow public read access (these are reference cards, not user data)
CREATE POLICY "Allow public read access" ON graded_references
  FOR SELECT USING (true);

-- Only authenticated users with admin role can insert/update/delete
CREATE POLICY "Admin only write access" ON graded_references
  FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

COMMENT ON TABLE graded_references IS 'Reference database of 509 TAG-graded Pokemon cards for two-pass grading calibration';
COMMENT ON COLUMN graded_references.grade_numeric IS 'Numeric grade for sorting: 10, 9.5, 9, 8.5, 8, etc.';
COMMENT ON COLUMN graded_references.centering_front_lr IS 'Front Left/Right centering deviation as percentage (e.g., 4.2 means 4.2% off-center)';
COMMENT ON COLUMN graded_references.card_type IS 'Card era/type: vintage_holo (pre-2003), modern_holo (2003+), non_holo';
