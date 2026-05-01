-- Backfill migration: ensure companies.public_company_id exists on remote DB.
-- This is needed when older migration history was repaired as "applied"
-- without actually executing schema changes.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS public_company_id BIGINT;

CREATE SEQUENCE IF NOT EXISTS public_company_id_seq
  START WITH 1000001
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER TABLE companies
  ALTER COLUMN public_company_id SET DEFAULT nextval('public_company_id_seq');

UPDATE companies
SET public_company_id = nextval('public_company_id_seq')
WHERE public_company_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_public_company_id_unique
  ON companies(public_company_id);
