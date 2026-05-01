-- Add missing data_quality_score column for enrichment persistence.
-- Safe to run multiple times.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS data_quality_score NUMERIC;

COMMENT ON COLUMN companies.data_quality_score IS
  'Optional normalized data quality score (0..1) for ranking and QA.';
