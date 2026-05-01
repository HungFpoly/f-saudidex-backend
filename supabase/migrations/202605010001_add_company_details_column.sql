-- Add missing company_details column used by enrichment/upsert payloads.
-- Safe for repeated runs.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS company_details JSONB;

COMMENT ON COLUMN companies.company_details IS
  'Optional structured enrichment details (raw/extended company metadata).';
