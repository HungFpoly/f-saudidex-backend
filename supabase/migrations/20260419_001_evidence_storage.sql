-- ================================================================
-- Migration: 20260419_001_evidence_storage.sql
-- Purpose: Create evidence storage tables for scraping provenance
--
-- Design principles:
--   - Every crawled page is stored with raw HTML
--   - Every extracted field has provenance (source URL, method, confidence)
--   - Raw HTML is archived separately for re-parsing capability
-- ================================================================

-- ─── 1. source_pages ─────────────────────────────────────────────
-- Stores every page that was crawled during a discovery/enrichment run.
-- This is the permanent record of "what was seen" during scraping.

CREATE TABLE IF NOT EXISTS source_pages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url             TEXT        NOT NULL,
  canonical_url   TEXT,
  domain          TEXT,
  page_type       TEXT,                   -- homepage, about, contact, products, services, team, other
  html            TEXT,                   -- Raw HTML (up to 500KB)
  text_content    TEXT,                   -- Extracted text (markdown or plain text)
  title           TEXT,
  status          TEXT        NOT NULL DEFAULT 'raw',  -- raw | parsed | error
  crawl_job_id    TEXT,                   -- Links to the crawl job that fetched this page
  seed_id         TEXT,                   -- Links to the seed URL that led here
  response_code   INT,
  response_headers JSONB,
  fetch_method    TEXT,                   -- 'http', 'browser', 'cheerio_crawler', 'playwright_crawler'
  fetch_time_ms   INT,
  html_size_bytes INT,
  crawled_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_pages_url ON source_pages(url);
CREATE INDEX IF NOT EXISTS idx_source_pages_canonical_url ON source_pages(canonical_url);
CREATE INDEX IF NOT EXISTS idx_source_pages_domain ON source_pages(domain);
CREATE INDEX IF NOT EXISTS idx_source_pages_crawl_job ON source_pages(crawl_job_id);
CREATE INDEX IF NOT EXISTS idx_source_pages_page_type ON source_pages(page_type);
CREATE INDEX IF NOT EXISTS idx_source_pages_status ON source_pages(status);
CREATE INDEX IF NOT EXISTS idx_source_pages_crawled_at ON source_pages(crawled_at DESC);

-- ─── 2. field_evidence ───────────────────────────────────────────
-- Provenance for every extracted field on every company.
-- Answers: "Where did this email/phone/name come from?"

CREATE TABLE IF NOT EXISTS field_evidence (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          TEXT        REFERENCES companies(id) ON DELETE CASCADE,
  field_name          TEXT        NOT NULL,   -- name_en, email, phone, website_url, address, etc.
  value               JSONB,                  -- The extracted value (string, array, or object)
  source_url          TEXT,                   -- The exact URL this field was extracted from
  source_page_id      UUID        REFERENCES source_pages(id) ON DELETE SET NULL,
  extraction_method   TEXT        NOT NULL,   -- regex, dom_selector, json_ld, meta_tag, ai_suggestion, adapter_parse
  extraction_detail   TEXT,                   -- CSS selector, regex pattern, AI model, adapter name
  confidence          FLOAT       DEFAULT 0.0 CHECK (confidence >= 0 AND confidence <= 1),
  is_locked           BOOLEAN     DEFAULT FALSE,  -- Manually verified fields
  verified_by         TEXT,
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_evidence_company ON field_evidence(company_id);
CREATE INDEX IF NOT EXISTS idx_field_evidence_field ON field_evidence(field_name);
CREATE INDEX IF NOT EXISTS idx_field_evidence_source_url ON field_evidence(source_url);
CREATE INDEX IF NOT EXISTS idx_field_evidence_method ON field_evidence(extraction_method);
CREATE INDEX IF NOT EXISTS idx_field_evidence_confidence ON field_evidence(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_field_evidence_locked ON field_evidence(is_locked) WHERE is_locked = TRUE;

-- ─── 3. company_raw_html ─────────────────────────────────────────
-- Archive of raw HTML for each company's website pages.
-- Was referenced in server.ts but never created in any migration.

CREATE TABLE IF NOT EXISTS company_raw_html (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      TEXT        REFERENCES companies(id) ON DELETE CASCADE,
  pages           JSONB,      -- Array of { page_type, url, html, scraped_at, order }
  total_pages     INT         DEFAULT 0,
  total_html_kb   INT         DEFAULT 0,
  stored_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_raw_html_company ON company_raw_html(company_id);
CREATE INDEX IF NOT EXISTS idx_company_raw_html_stored_at ON company_raw_html(stored_at DESC);

-- ─── 4. updated_at trigger for source_pages ──────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_source_pages_updated_at ON source_pages;
CREATE TRIGGER update_source_pages_updated_at
  BEFORE UPDATE ON source_pages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_raw_html_updated_at ON company_raw_html;
CREATE TRIGGER update_company_raw_html_updated_at
  BEFORE UPDATE ON company_raw_html
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── 5. Row Level Security ───────────────────────────────────────

ALTER TABLE source_pages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_evidence    ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_raw_html  ENABLE ROW LEVEL SECURITY;

-- Public can read source_pages (transparency)
DROP POLICY IF EXISTS "Public read source_pages" ON source_pages;
CREATE POLICY "Public read source_pages" ON source_pages FOR SELECT USING (true);

-- Authenticated users can write to source_pages
DROP POLICY IF EXISTS "Auth write source_pages" ON source_pages;
CREATE POLICY "Auth write source_pages" ON source_pages FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- Public can read field_evidence
DROP POLICY IF EXISTS "Public read field_evidence" ON field_evidence;
CREATE POLICY "Public read field_evidence" ON field_evidence FOR SELECT USING (true);

-- Authenticated users can write to field_evidence
DROP POLICY IF EXISTS "Auth write field_evidence" ON field_evidence;
CREATE POLICY "Auth write field_evidence" ON field_evidence FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- Public can read company_raw_html
DROP POLICY IF EXISTS "Public read company_raw_html" ON company_raw_html;
CREATE POLICY "Public read company_raw_html" ON company_raw_html FOR SELECT USING (true);

-- Authenticated users can write to company_raw_html
DROP POLICY IF EXISTS "Auth write company_raw_html" ON company_raw_html;
CREATE POLICY "Auth write company_raw_html" ON company_raw_html FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ─── Done ─────────────────────────────────────────────────────────
SELECT 'Migration 20260419_001 complete — Evidence storage tables created.' AS status;
