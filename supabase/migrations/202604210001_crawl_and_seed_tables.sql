-- ================================================================
-- Migration: 20260419_002_crawl_and_seed_tables.sql
-- Purpose: Create persistent crawl queue, seed management, and
--          review queue tables. Replaces in-memory-only state.
--
-- Design principles:
--   - Queue survives server restarts (DB-backed)
--   - Dead-letter queue for permanently failed jobs
--   - Seed sources and URLs are tracked in DB
--   - Review queue for admin approval workflow
-- ================================================================

-- ─── 1. crawl_jobs ──────────────────────────────────────────────
-- Persistent queue for all crawl/fetch tasks.
-- Replaces the in-memory CrawlQueue Map.

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url               TEXT        NOT NULL,
  canonical_url     TEXT        NOT NULL,
  domain            TEXT,
  queue_name        TEXT        NOT NULL,  -- seed_discover, directory_fetch, directory_parse, website_resolve,
                                           -- company_fetch_homepage, company_fetch_priority_page,
                                           -- field_extract, ai_enrich, entity_merge, entity_resolve,
                                           -- entity_index, review
  status            TEXT        NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed | dead_letter
  priority          TEXT        DEFAULT 'normal',  -- high | normal | low
  depth             INT         DEFAULT 0,
  max_depth         INT         DEFAULT 3,
  retries           INT         DEFAULT 0,
  max_retries       INT         DEFAULT 3,
  error             TEXT,
  idempotency_key   TEXT,                   -- Prevents duplicate jobs for same URL
  metadata          JSONB       DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  scheduled_for     TIMESTAMPTZ,            -- Delayed execution
  parent_job_id     UUID        REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  seed_id           UUID,                   -- Links to seed_urls.id
  source_page_id    UUID                    -- Links to source_pages.id (for re-crawl)
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_queue_status_priority ON crawl_jobs(queue_name, status, priority);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_canonical_url ON crawl_jobs(canonical_url);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_idempotency ON crawl_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_created_at ON crawl_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_dead_letter ON crawl_jobs(id) WHERE status = 'dead_letter';

-- Unique constraint: only one pending/processing job per canonical URL
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_jobs_unique_active_url
  ON crawl_jobs(canonical_url, queue_name)
  WHERE status IN ('pending', 'processing');

-- ─── 2. seed_sources ────────────────────────────────────────────
-- Registry of where seeds come from (manual, admin, import, auto-discovered).

CREATE TABLE IF NOT EXISTS seed_sources (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  source_type       TEXT        NOT NULL DEFAULT 'manual',  -- manual | adapter_discovered | admin_added | imported | auto_discovered
  description       TEXT,
  adapter_id        TEXT,                   -- Which parser adapter owns this source
  config            JSONB       DEFAULT '{}',  -- Source-specific config (pagination pattern, headers, etc.)
  is_active         BOOLEAN     DEFAULT TRUE,
  tags              TEXT[],
  companies_found   INT         DEFAULT 0,
  pages_scraped     INT         DEFAULT 0,
  last_run_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seed_sources_type ON seed_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_seed_sources_active ON seed_sources(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_seed_sources_adapter ON seed_sources(adapter_id);

-- ─── 3. seed_urls ───────────────────────────────────────────────
-- Individual URLs to crawl, linked to a source.

CREATE TABLE IF NOT EXISTS seed_urls (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         UUID        REFERENCES seed_sources(id) ON DELETE CASCADE,
  url               TEXT        NOT NULL,
  canonical_url     TEXT        NOT NULL,
  domain            TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed | skipped
  depth             INT         DEFAULT 0,
  max_depth         INT         DEFAULT 2,
  tags              TEXT[],
  metadata          JSONB       DEFAULT '{}',
  added_at          TIMESTAMPTZ DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  error             TEXT,
  companies_found   INT         DEFAULT 0,
  pages_scraped     INT         DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_seed_urls_source ON seed_urls(source_id);
CREATE INDEX IF NOT EXISTS idx_seed_urls_status ON seed_urls(status);
CREATE INDEX IF NOT EXISTS idx_seed_urls_canonical_url ON seed_urls(canonical_url);
CREATE INDEX IF NOT EXISTS idx_seed_urls_domain ON seed_urls(domain);

-- Prevent duplicate seed URLs within the same source
CREATE UNIQUE INDEX IF NOT EXISTS idx_seed_urls_unique_per_source
  ON seed_urls(source_id, canonical_url);

-- ─── 4. review_queue_items ──────────────────────────────────────
-- Admin review queue for companies pending approval.

CREATE TABLE IF NOT EXISTS review_queue_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        TEXT        REFERENCES companies(id) ON DELETE CASCADE,
  review_type       TEXT        NOT NULL DEFAULT 'new_company',  -- new_company | merge_request | data_change | claim_request
  status            TEXT        NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | deferred
  priority          TEXT        DEFAULT 'normal',  -- high | normal | low
  assigned_to       TEXT,                   -- Admin email assigned to review
  notes             TEXT,
  decision_reason   TEXT,
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  metadata          JSONB       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue_items(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_type ON review_queue_items(review_type);
CREATE INDEX IF NOT EXISTS idx_review_queue_company ON review_queue_items(company_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_assigned ON review_queue_items(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_queue_created ON review_queue_items(created_at DESC);

-- ─── 5. updated_at triggers ─────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_crawl_jobs_updated_at ON crawl_jobs;
CREATE TRIGGER update_crawl_jobs_updated_at
  BEFORE UPDATE ON crawl_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_seed_sources_updated_at ON seed_sources;
CREATE TRIGGER update_seed_sources_updated_at
  BEFORE UPDATE ON seed_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_review_queue_updated_at ON review_queue_items;
CREATE TRIGGER update_review_queue_updated_at
  BEFORE UPDATE ON review_queue_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── 6. Row Level Security ──────────────────────────────────────

ALTER TABLE crawl_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE seed_sources        ENABLE ROW LEVEL SECURITY;
ALTER TABLE seed_urls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue_items  ENABLE ROW LEVEL SECURITY;

-- crawl_jobs: authenticated reads/writes
DROP POLICY IF EXISTS "Auth read crawl_jobs" ON crawl_jobs;
CREATE POLICY "Auth read crawl_jobs" ON crawl_jobs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write crawl_jobs" ON crawl_jobs;
CREATE POLICY "Auth write crawl_jobs" ON crawl_jobs FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- seed_sources: authenticated reads/writes
DROP POLICY IF EXISTS "Auth read seed_sources" ON seed_sources;
CREATE POLICY "Auth read seed_sources" ON seed_sources FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write seed_sources" ON seed_sources;
CREATE POLICY "Auth write seed_sources" ON seed_sources FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- seed_urls: authenticated reads/writes
DROP POLICY IF EXISTS "Auth read seed_urls" ON seed_urls;
CREATE POLICY "Auth read seed_urls" ON seed_urls FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write seed_urls" ON seed_urls;
CREATE POLICY "Auth write seed_urls" ON seed_urls FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- review_queue_items: authenticated reads/writes
DROP POLICY IF EXISTS "Auth read review_queue" ON review_queue_items;
CREATE POLICY "Auth read review_queue" ON review_queue_items FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth write review_queue" ON review_queue_items;
CREATE POLICY "Auth write review_queue" ON review_queue_items FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ─── Done ─────────────────────────────────────────────────────────
SELECT 'Migration 20260419_002 complete — Crawl queue, seed, and review tables created.' AS status;
