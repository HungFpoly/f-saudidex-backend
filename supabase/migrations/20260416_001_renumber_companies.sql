-- ================================================================
-- Migration: 20260415_002_renumber_companies.sql
-- Purpose:
--   Renumber ALL companies to sequential numeric IDs starting from 100000.
--   Updates all foreign key references (inquiries, claim_requests, etc.).
-- ================================================================

-- ─── 1. Build ID mapping (old_id → new_id) ────────────────────────

-- Create a temporary mapping table
DROP TABLE IF EXISTS _company_id_map;
CREATE TEMP TABLE _company_id_map AS
SELECT
  id AS old_id,
  (100000 + ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC))::TEXT AS new_id
FROM companies;

-- ─── 2. Update foreign key references BEFORE changing company IDs ─

-- Inquiries
UPDATE inquiries
SET company_id = m.new_id
FROM _company_id_map m
WHERE inquiries.company_id = m.old_id;

-- Claim requests
UPDATE claim_requests
SET company_id = m.new_id
FROM _company_id_map m
WHERE claim_requests.company_id = m.old_id;

-- Companies referencing other companies (master_id, merged_from)
UPDATE companies
SET master_id = m.new_id
FROM _company_id_map m
WHERE companies.master_id = m.old_id;

UPDATE companies
SET merged_from = (
  SELECT jsonb_agg(
    CASE
      WHEN elem::text IS NOT NULL AND elem::text != 'null'
        THEN COALESCE(
          (SELECT new_id FROM _company_id_map WHERE old_id = elem::text),
          elem::text
        )
      ELSE elem::text
    END
  )
  FROM jsonb_array_elements(COALESCE(companies.merged_from, '[]'::jsonb)) AS elem
)
WHERE companies.merged_from IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(companies.merged_from) AS elem
    JOIN _company_id_map m ON elem::text = m.old_id
  );

-- ─── 3. Renumber company IDs ──────────────────────────────────────

-- Step A: Update IDs to temporary prefixed IDs to avoid PK collision
UPDATE companies
SET id = 'tmp_' || m.new_id
FROM _company_id_map m
WHERE companies.id = m.old_id;

-- Step B: Remove temp prefix to get final numeric IDs
UPDATE companies
SET id = SUBSTRING(id FROM 5);

-- ─── 4. Update metadata counter ───────────────────────────────────

INSERT INTO metadata (key, value, updated_at)
VALUES ('company_counter', jsonb_build_object('lastId', (SELECT MAX(CAST(id AS INTEGER)) FROM companies WHERE id ~ '^\d+$')), NOW())
ON CONFLICT (key) DO UPDATE
SET value = jsonb_build_object('lastId', (SELECT MAX(CAST(id AS INTEGER)) FROM companies WHERE id ~ '^\d+$')),
    updated_at = NOW();

-- ─── 5. Cleanup ───────────────────────────────────────────────────

DROP TABLE IF EXISTS _company_id_map;

-- ─── Done ─────────────────────────────────────────────────────────
SELECT 'Migration 20260415_002 complete. Companies renumbered to sequential IDs starting from 100000.' AS status;
