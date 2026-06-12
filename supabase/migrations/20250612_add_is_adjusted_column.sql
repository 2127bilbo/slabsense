-- Migration: Add is_adjusted column to graded_references table
-- This flag indicates cards where a TAG grader manually overrode the defect-based grade
-- (usually for catastrophic damage like paper loss or creasing that the automated
-- defect list understates)

ALTER TABLE graded_references
ADD COLUMN IF NOT EXISTS is_adjusted BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN graded_references.is_adjusted IS 'True if TAG grader manually adjusted grade due to damage not captured by defect list';

-- Create index for filtering adjusted references
CREATE INDEX IF NOT EXISTS idx_graded_refs_adjusted ON graded_references(is_adjusted);
