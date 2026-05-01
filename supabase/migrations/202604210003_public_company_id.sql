-- ================================================================
-- Migration: 20260419_004_public_company_id.sql
-- Purpose: Add public_company_id column starting at 1000001.
--          Internal UUIDs are NEVER exposed publicly.
--
-- Design principles:
--   - Public route uses: /company/{public_company_id}/{slug}
--   - Internal UUID stays as primary key
--   - Existing companies get sequential IDs assigned
-- ================================================================

-- ─── 1. Add public_company_id column ────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS public_company_id BIGINT;

-- Create a sequence starting at 1,000,001
CREATE SEQUENCE IF NOT EXISTS public_company_id_seq
  START WITH 1000001
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- Assign sequential IDs to existing companies (ordered by created_at)
DO $$
DECLARE
  rec RECORD;
  next_id BIGINT := 1000001;
BEGIN
  FOR rec IN SELECT id FROM companies ORDER BY created_at ASC, name_en ASC LOOP
    UPDATE companies SET public_company_id = next_id WHERE id = rec.id;
    next_id := next_id + 1;
  END LOOP;

  -- Update the sequence to continue from where we left off
  EXECUTE format('ALTER SEQUENCE public_company_id_seq RESTART WITH %s', next_id);
END $$;

-- Make the column NOT NULL after all rows have values
ALTER TABLE companies ALTER COLUMN public_company_id SET NOT NULL;
ALTER TABLE companies ALTER COLUMN public_company_id SET DEFAULT nextval('public_company_id_seq');

-- Ensure uniqueness
ALTER TABLE companies ADD CONSTRAINT uq_companies_public_id UNIQUE (public_company_id);

-- Index for fast public ID lookups
CREATE INDEX IF NOT EXISTS idx_companies_public_id ON companies(public_company_id);

-- ─── 2. Add slug normalization helper ───────────────────────────
-- Ensures slugs are URL-safe for public routes.

CREATE OR REPLACE FUNCTION normalize_slug(input TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(trim(input), '[^a-zA-Z0-9\s-]', '', 'g'),
      '\s+', '-', 'g'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── 3. Add helper function to get public URL ───────────────────

CREATE OR REPLACE FUNCTION get_company_public_url(company_id_param TEXT)
RETURNS TEXT AS $$
DECLARE
  rec RECORD;
BEGIN
  SELECT public_company_id, slug, name_en INTO rec
  FROM companies WHERE id = company_id_param LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN '/company/' || rec.public_company_id || '/' || normalize_slug(rec.name_en);
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── Done ─────────────────────────────────────────────────────────
SELECT 'Migration 20260419_004 complete — public_company_id assigned starting at 1000001.' AS status;
