-- ================================================================
-- Migration: 20260417_001_categories_and_brands.sql
-- Purpose:
--   1. Create categories table + populate from companies.categories
--   2. Create brands table + populate from companies.brands
--   3. Create company_categories junction table
--   4. Create company_brands junction table
-- ================================================================

-- ─── 1. Categories Table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
  id        TEXT PRIMARY KEY,
  name_en   TEXT NOT NULL,
  name_ar   TEXT DEFAULT '',
  slug      TEXT NOT NULL UNIQUE,
  icon      TEXT DEFAULT 'Settings',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with known category slugs/IDs from the app
INSERT INTO categories (id, name_en, name_ar, slug, icon) VALUES
  ('electrical', 'Electrical Equipment', 'المعدات الكهربائية', 'electrical', 'Zap'),
  ('chemicals', 'Chemicals & Plastics', 'الكيماويات والبلاستيك', 'chemicals', 'FlaskConical'),
  ('construction', 'Construction & Building', 'الإنشاءات والبناء', 'construction', 'Construction'),
  ('healthcare', 'Healthcare & Medical', 'الرعاية الصحية والطبية', 'healthcare', 'Stethoscope'),
  ('food-beverage', 'Food & Beverage', 'الأغذية والمشروبات', 'food-beverage', 'Utensils'),
  ('technology', 'Technology & IT', 'التقنية والمعلومات', 'technology', 'Settings'),
  ('energy', 'Energy & Utilities', 'الطاقة والمرافق', 'energy', 'Zap'),
  ('manufacturing', 'General Manufacturing', 'التصنيع العام', 'manufacturing', 'Settings'),
  ('transport', 'Transport & Logistics', 'النقل والخدمات اللوجستية', 'transport', 'Settings'),
  ('agriculture', 'Agriculture & Farming', 'الزراعة', 'agriculture', 'Settings'),
  ('textiles', 'Textiles & Apparel', 'المنسوجات والملابس', 'textiles', 'Settings'),
  ('metals', 'Metals & Mining', 'المعادن والتعدين', 'metals', 'Settings')
ON CONFLICT (id) DO NOTHING;

-- Extract additional categories from companies.categories and companies.fields JSONB arrays
INSERT INTO categories (id, name_en, name_ar, slug, icon)
SELECT DISTINCT
  LOWER(REPLACE(source_value, ' ', '-')) AS id,
  INITCAP(REPLACE(source_value, '-', ' ')) AS name_en,
  '' AS name_ar,
  LOWER(REPLACE(source_value, ' ', '-')) AS slug,
  'Settings' AS icon
FROM (
  SELECT jsonb_array_elements_text(COALESCE(categories, '[]'::jsonb)) AS source_value
  FROM companies
  UNION
  SELECT jsonb_array_elements_text(COALESCE(fields, '[]'::jsonb)) AS source_value
  FROM companies
) extracted
WHERE source_value !~ '^\d+$'  -- Skip numeric IDs (they reference existing categories)
  AND TRIM(source_value) <> ''
ON CONFLICT (slug) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_ar = COALESCE(NULLIF(EXCLUDED.name_ar, ''), categories.name_ar);

-- ─── 2. Company Categories Junction Table ─────────────────────────

CREATE TABLE IF NOT EXISTS company_categories (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_company_categories_category ON company_categories(category_id);

-- Populate junction table from existing companies.categories and companies.fields
-- Handles mixed values: category IDs, slugs, and display names
INSERT INTO company_categories (company_id, category_id)
SELECT DISTINCT
  c.id AS company_id,
  matched_categories.id AS category_id
FROM companies c
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(COALESCE(c.categories, '[]'::jsonb)) AS source_value
  UNION
  SELECT jsonb_array_elements_text(COALESCE(c.fields, '[]'::jsonb)) AS source_value
) extracted
JOIN categories matched_categories
  ON matched_categories.id = extracted.source_value
  OR matched_categories.slug = LOWER(REPLACE(extracted.source_value, ' ', '-'))
WHERE extracted.source_value IS NOT NULL
  AND TRIM(extracted.source_value) <> ''
ON CONFLICT (company_id, category_id) DO NOTHING;

-- ─── 3. Brands Table ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_brand_name(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(trim(coalesce(input, '')), '\s+', ' ', 'g'));
$$;

CREATE TABLE IF NOT EXISTS brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  normalized_name TEXT,
  logo_url        TEXT DEFAULT '',
  website_url     TEXT DEFAULT '',
  description     TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

UPDATE brands
SET normalized_name = public.normalize_brand_name(name)
WHERE normalized_name IS NULL
   OR normalized_name <> public.normalize_brand_name(name);

ALTER TABLE brands
  ALTER COLUMN normalized_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_normalized_name ON brands(normalized_name);

-- Extract distinct brands from companies.brands JSONB array
INSERT INTO brands (name, normalized_name)
SELECT
  MIN(raw_name) AS name,
  normalized_name
FROM (
  SELECT
    TRIM(brand) AS raw_name,
    public.normalize_brand_name(brand) AS normalized_name
  FROM companies,
       jsonb_array_elements_text(COALESCE(brands, '[]'::jsonb)) AS brand
) extracted
WHERE normalized_name <> ''
GROUP BY normalized_name
ON CONFLICT (normalized_name) DO UPDATE
SET name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name;

-- ─── 4. Company Brands Junction Table ─────────────────────────────

DROP TABLE IF EXISTS company_brands;

CREATE TABLE company_brands (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  brand_id   UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_company_brands_brand ON company_brands(brand_id);

-- Populate junction table from existing companies.brands
INSERT INTO company_brands (company_id, brand_id)
SELECT DISTINCT
  c.id AS company_id,
  b.id AS brand_id
FROM companies c,
     jsonb_array_elements_text(COALESCE(c.brands, '[]'::jsonb)) AS brand_val
JOIN brands b
  ON b.normalized_name = public.normalize_brand_name(brand_val)
WHERE public.normalize_brand_name(brand_val) <> ''
ON CONFLICT (company_id, brand_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_company_brands()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM company_brands
    WHERE company_id = OLD.id;
  ELSE
    INSERT INTO brands (name, normalized_name)
    SELECT
      MIN(raw_name) AS name,
      normalized_name
    FROM (
      SELECT
        TRIM(brand_val) AS raw_name,
        public.normalize_brand_name(brand_val) AS normalized_name
      FROM jsonb_array_elements_text(COALESCE(NEW.brands, '[]'::jsonb)) AS brand_val
    ) extracted
    WHERE normalized_name <> ''
    GROUP BY normalized_name
    ON CONFLICT (normalized_name) DO UPDATE
    SET name = EXCLUDED.name,
        normalized_name = EXCLUDED.normalized_name;

    DELETE FROM company_brands
    WHERE company_id = NEW.id;

    INSERT INTO company_brands (company_id, brand_id)
    SELECT DISTINCT
      NEW.id,
      b.id
    FROM jsonb_array_elements_text(COALESCE(NEW.brands, '[]'::jsonb)) AS brand_val
    JOIN brands b
      ON b.normalized_name = public.normalize_brand_name(brand_val)
    WHERE public.normalize_brand_name(brand_val) <> ''
    ON CONFLICT (company_id, brand_id) DO NOTHING;
  END IF;

  DELETE FROM brands b
  WHERE NOT EXISTS (
    SELECT 1
    FROM company_brands cb
    WHERE cb.brand_id = b.id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_company_brands_on_write ON companies;
CREATE TRIGGER sync_company_brands_on_write
  AFTER INSERT OR UPDATE OF brands OR DELETE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_company_brands();

-- ─── 5. Enable RLS ────────────────────────────────────────────────

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public category read" ON categories;
CREATE POLICY "Allow public category read" ON categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated category writes" ON categories;
CREATE POLICY "Allow authenticated category writes" ON categories FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "Allow public company_categories read" ON company_categories;
CREATE POLICY "Allow public company_categories read" ON company_categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated company_categories writes" ON company_categories;
CREATE POLICY "Allow authenticated company_categories writes" ON company_categories FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "Allow public brand read" ON brands;
CREATE POLICY "Allow public brand read" ON brands FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated brand writes" ON brands;
CREATE POLICY "Allow authenticated brand writes" ON brands FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "Allow public company_brands read" ON company_brands;
CREATE POLICY "Allow public company_brands read" ON company_brands FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated company_brands writes" ON company_brands;
CREATE POLICY "Allow authenticated company_brands writes" ON company_brands FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ─── Done ─────────────────────────────────────────────────────────
SELECT 'Migration 20260417_001 complete.' AS status;
