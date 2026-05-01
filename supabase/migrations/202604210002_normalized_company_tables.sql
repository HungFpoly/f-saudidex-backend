-- ================================================================
-- Migration: 20260419_003_normalized_company_tables.sql
-- Purpose: Create normalized junction tables for company data
--          that is currently stored as JSONB arrays.
--
-- Design principles:
--   - Normalize JSONB arrays into proper relational tables
--   - Maintain backward compatibility with existing JSONB columns
--   - Add proper foreign key references and indexes
--   - Support multiple values per company with metadata
-- ================================================================

-- ─── 1. company_contacts ────────────────────────────────────────
-- Separate contact information from the main companies table.

CREATE TABLE IF NOT EXISTS company_contacts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_type      TEXT        NOT NULL DEFAULT 'general',  -- general, sales, procurement, support, hr, info
  email             TEXT,
  phone             TEXT,
  whatsapp          TEXT,
  name              TEXT,                   -- Contact person name
  title             TEXT,                   -- Job title
  is_primary        BOOLEAN     DEFAULT FALSE,
  source_url        TEXT,
  verified          BOOLEAN     DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_contacts_company ON company_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_company_contacts_email ON company_contacts(email);
CREATE INDEX IF NOT EXISTS idx_company_contacts_phone ON company_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_company_contacts_type ON company_contacts(contact_type);

-- ─── 2. company_socials ─────────────────────────────────────────
-- Social media links as separate rows.

CREATE TABLE IF NOT EXISTS company_socials (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform          TEXT        NOT NULL,  -- linkedin, twitter, facebook, instagram, youtube, tiktok, snapchat, x
  url               TEXT        NOT NULL,
  is_primary        BOOLEAN     DEFAULT FALSE,
  username          TEXT,
  followers_count   INT,
  verified          BOOLEAN     DEFAULT FALSE,
  source_url        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_company_socials_company ON company_socials(company_id);
CREATE INDEX IF NOT EXISTS idx_company_socials_platform ON company_socials(platform);

-- ─── 3. company_categories ──────────────────────────────────────
-- Junction table for company-category relationships.

CREATE TABLE IF NOT EXISTS company_categories (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id       TEXT,                   -- References categories.id if available
  category_name     TEXT        NOT NULL,   -- Direct category name
  is_primary        BOOLEAN     DEFAULT FALSE,
  confidence        FLOAT       DEFAULT 1.0,
  source            TEXT        DEFAULT 'manual',  -- manual, ai_classify, adapter_parse
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, category_name)
);

CREATE INDEX IF NOT EXISTS idx_company_categories_company ON company_categories(company_id);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_categories'
      AND column_name = 'is_primary'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_company_categories_primary ON company_categories(company_id) WHERE is_primary = TRUE;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_categories'
      AND column_name = 'category_name'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_company_categories_name ON company_categories(category_name);
  END IF;
END $$;

-- ─── 4. company_products ────────────────────────────────────────
-- Products offered by a company.

CREATE TABLE IF NOT EXISTS company_products (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  description       TEXT,
  category          TEXT,
  source_url        TEXT,
  confidence        FLOAT       DEFAULT 1.0,
  source            TEXT        DEFAULT 'manual',  -- manual, ai_normalize, adapter_parse
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_company_products_company ON company_products(company_id);
CREATE INDEX IF NOT EXISTS idx_company_products_name ON company_products(name);

-- ─── 5. company_services ────────────────────────────────────────
-- Services provided by a company.

CREATE TABLE IF NOT EXISTS company_services (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  description       TEXT,
  category          TEXT,
  source_url        TEXT,
  confidence        FLOAT       DEFAULT 1.0,
  source            TEXT        DEFAULT 'manual',  -- manual, ai_normalize, adapter_parse
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_company_services_company ON company_services(company_id);
CREATE INDEX IF NOT EXISTS idx_company_services_name ON company_services(name);

-- ─── 6. company_brands ──────────────────────────────────────────
-- Brands represented/distributed by a company.

CREATE TABLE IF NOT EXISTS company_brands (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  brand_name        TEXT        NOT NULL,
  relationship      TEXT,                   -- authorized_distributor, reseller, partner, manufacturer, representative
  confidence        FLOAT       DEFAULT 1.0,
  evidence          TEXT,
  source            TEXT        DEFAULT 'manual',  -- manual, ai_detect_brands, adapter_parse
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, brand_name)
);

CREATE INDEX IF NOT EXISTS idx_company_brands_company ON company_brands(company_id);
CREATE INDEX IF NOT EXISTS idx_company_brands_name ON company_brands(brand_name);
CREATE INDEX IF NOT EXISTS idx_company_brands_relationship ON company_brands(relationship);

-- ─── 7. company_locations ───────────────────────────────────────
-- Multiple locations/branches for a company.

CREATE TABLE IF NOT EXISTS company_locations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_type     TEXT        DEFAULT 'branch',  -- headquarters, branch, warehouse, factory, office, retail
  full_address      TEXT,
  city_id           TEXT,
  region_id         TEXT,
  latitude          NUMERIC,
  longitude         NUMERIC,
  phone             TEXT,
  is_primary        BOOLEAN     DEFAULT FALSE,
  source_url        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_locations_company ON company_locations(company_id);
CREATE INDEX IF NOT EXISTS idx_company_locations_city ON company_locations(city_id);
CREATE INDEX IF NOT EXISTS idx_company_locations_primary ON company_locations(company_id) WHERE is_primary = TRUE;

-- ─── 8. updated_at triggers ─────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_company_contacts_updated_at ON company_contacts;
CREATE TRIGGER update_company_contacts_updated_at
  BEFORE UPDATE ON company_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_socials_updated_at ON company_socials;
CREATE TRIGGER update_company_socials_updated_at
  BEFORE UPDATE ON company_socials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_locations_updated_at ON company_locations;
CREATE TRIGGER update_company_locations_updated_at
  BEFORE UPDATE ON company_locations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── 9. Row Level Security ──────────────────────────────────────

ALTER TABLE company_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_socials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_services      ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_brands        ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_locations     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_contacts', 'company_socials', 'company_categories',
    'company_products', 'company_services', 'company_brands', 'company_locations'
  ]
  LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS "Public read %I" ON %I;
      CREATE POLICY "Public read %I" ON %I FOR SELECT USING (true);

      DROP POLICY IF EXISTS "Auth write %I" ON %I;
      CREATE POLICY "Auth write %I" ON %I FOR ALL
        USING  (auth.role() IN (''authenticated'', ''service_role''))
        WITH CHECK (auth.role() IN (''authenticated'', ''service_role''));
    ', t, t, t, t, t, t, t, t);
  END LOOP;
END $$;

-- ─── Done ─────────────────────────────────────────────────────────
SELECT 'Migration 20260419_003 complete — Normalized company tables created.' AS status;
