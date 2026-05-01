-- ================================================================
-- Migration: 20260420_002_slug_permanence.sql
-- Purpose: 
--   1. Create a robust slugify function in SQL
--   2. Sanitize and ensure uniqueness for existing company/category slugs
--   3. Add unicity constraints where missing
--   4. Add triggers for automatic slug generation
-- ================================================================

-- ─── 1. Slugify Function ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.slugify(text_to_slug TEXT)
RETURNS TEXT AS $$
DECLARE
  slug TEXT;
BEGIN
  -- 1. Lowercase
  slug := LOWER(text_to_slug);
  -- 2. Replace non-alphanumeric (allowing hyphens and Arabic characters) with hyphens
  -- Using regex to keep Arabic \u0600-\u06FF and standard word characters
  slug := REGEXP_REPLACE(slug, '[^a-z0-9\u0600-\u06FF]+', '-', 'g');
  -- 3. Trim hyphens from ends
  slug := REGEXP_REPLACE(slug, '^-+|-+$', '', 'g');
  -- 4. Replace multiple hyphens with single hyphen
  slug := REGEXP_REPLACE(slug, '-+', '-', 'g');
  
  RETURN slug;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── 2. Sanitize Categories ──────────────────────────────────────

-- Step A: Temporarily set slugs to IDs to clear any existing collisions
UPDATE categories SET slug = 'TEMP-' || id;

-- Step B: Ensure all category slugs are sanitized and unique in a single pass
WITH updated_categories AS (
  SELECT 
    id, 
    public.slugify(name_en) as base_slug
  FROM categories
),
unique_categories AS (
  SELECT 
    id, 
    base_slug,
    ROW_NUMBER() OVER (PARTITION BY base_slug ORDER BY id) as rn
  FROM updated_categories
)
UPDATE categories
SET slug = CASE 
  WHEN rn = 1 THEN base_slug 
  ELSE base_slug || '-' || (rn - 1) 
END
FROM unique_categories
WHERE categories.id = unique_categories.id;

-- ─── 3. Sanitize Companies ───────────────────────────────────────

-- Step A: Clear existing slugs to prevent index collisions during update
UPDATE companies SET slug = 'TEMP-' || id;

-- Step B: Sanitization batch update for existing companies
WITH updated_slugs AS (
  SELECT 
    id, 
    public.slugify(COALESCE(name_en, id)) as base_slug
  FROM companies
),
unique_slugs AS (
  SELECT 
    id, 
    base_slug,
    ROW_NUMBER() OVER (PARTITION BY base_slug ORDER BY created_at, id) as rn
  FROM updated_slugs
  JOIN companies USING (id)
)
UPDATE companies
SET slug = CASE 
  WHEN rn = 1 THEN base_slug 
  ELSE base_slug || '-' || (rn - 1) 
END
FROM unique_slugs
WHERE companies.id = unique_slugs.id;

-- Add uniqueness constraint to companies.slug
-- First, ensure no duplicates exist (the CTE above should have handled it)
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_slug_unique ON companies (slug);

-- ─── 4. Automation Triggers ──────────────────────────────────────

-- Function for company slug triggers
CREATE OR REPLACE FUNCTION public.handle_company_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Only generate if slug is empty or name changed
  IF NEW.slug IS NULL OR NEW.slug = '' OR (TG_OP = 'UPDATE' AND NEW.name_en <> OLD.name_en) THEN
    base_slug := public.slugify(NEW.name_en);
    final_slug := base_slug;
    
    -- Loop to ensure uniqueness
    WHILE EXISTS (SELECT 1 FROM companies WHERE slug = final_slug AND id <> NEW.id) LOOP
      counter := counter + 1;
      final_slug := base_slug || '-' || counter;
    END LOOP;
    
    NEW.slug := final_slug;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_company_slug ON companies;
CREATE TRIGGER trg_generate_company_slug
  BEFORE INSERT OR UPDATE OF name_en ON companies
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_company_slug();

-- Function for category slug triggers
CREATE OR REPLACE FUNCTION public.handle_category_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' OR (TG_OP = 'UPDATE' AND NEW.name_en <> OLD.name_en) THEN
    base_slug := public.slugify(NEW.name_en);
    final_slug := base_slug;
    
    -- Loop to ensure uniqueness for categories
    WHILE EXISTS (SELECT 1 FROM categories WHERE slug = final_slug AND id <> NEW.id) LOOP
      counter := counter + 1;
      final_slug := base_slug || '-' || counter;
    END LOOP;
    
    NEW.slug := final_slug;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_category_slug ON categories;
CREATE TRIGGER trg_generate_category_slug
  BEFORE INSERT OR UPDATE OF name_en ON categories
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_category_slug();

-- ─── Done ────────────────────────────────────────────────────────
SELECT 'Migration 20260420_002 complete.' AS status;
