-- ================================================================
-- Migration: 20260418_001_ai_enrichment_tables.sql
-- Purpose: Create downstream AI enrichment tables
--
-- Design principles:
--   - AI suggests; humans/rules validate before applying
--   - Scraping pipeline is NOT affected (enrichment is downstream)
--   - All outputs are stored as suggestions, not direct overwrites
--   - Locked/manually-curated fields are never touched by AI
-- ================================================================

-- ─── 1. ai_enrichment_runs ───────────────────────────────────────
-- Tracks each AI enrichment job execution for auditing and replay.

CREATE TABLE IF NOT EXISTS ai_enrichment_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_type      TEXT        NOT NULL,   -- classify_company | normalize_taxonomy | improve_profile |
                                        -- suggest_missing_fields | rank_merge_candidates |
                                        -- summarize_evidence | completeness_score | detect_brands
  provider      TEXT        NOT NULL,   -- groq | mistral | openrouter | huggingface | gemini
  model         TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending',   -- pending | running | success | error
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  duration_ms   INT,
  error_message TEXT,
  usage         JSONB       DEFAULT '{}',   -- { prompt_tokens, completion_tokens, estimated_cost }
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_company ON ai_enrichment_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_job_type ON ai_enrichment_runs(job_type);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_status ON ai_enrichment_runs(status);

-- ─── 2. ai_field_suggestions ─────────────────────────────────────
-- AI-suggested field values. Never written directly to companies.
-- Admin reviews and accepts/rejects each suggestion.
-- Covers: categories, description_en/ar, scope_en/ar, brands,
--          products, seo_title/description, tags, sectors served.
-- NOT for: phone, email, website, exact address, branch count.

CREATE TABLE IF NOT EXISTS ai_field_suggestions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id           UUID        REFERENCES ai_enrichment_runs(id) ON DELETE SET NULL,
  field_name       TEXT        NOT NULL,   -- e.g. 'categories', 'description_en', 'brands'
  suggested_value  JSONB       NOT NULL,   -- string | string[] | object
  current_value    JSONB,                  -- snapshot of existing value at suggestion time
  confidence       FLOAT       DEFAULT 0.0 CHECK (confidence >= 0 AND confidence <= 1),
  reason           TEXT,                   -- why this was suggested
  status           TEXT        NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected
  reviewed_by      TEXT,                   -- email of reviewer
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_suggestions_company ON ai_field_suggestions(company_id);
CREATE INDEX IF NOT EXISTS idx_field_suggestions_status ON ai_field_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_field_suggestions_field ON ai_field_suggestions(field_name);

-- ─── 3. ai_merge_rankings ────────────────────────────────────────
-- AI-ranked duplicate candidates. Final merge requires human/rule validation.

CREATE TABLE IF NOT EXISTS ai_merge_rankings (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  source_company_id     TEXT    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_company_id  TEXT    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  match_score           FLOAT   NOT NULL CHECK (match_score >= 0 AND match_score <= 1),
  match_reasons         TEXT[], -- e.g. ['Same domain', 'Similar name', 'Same phone']
  recommended_master_id TEXT    REFERENCES companies(id) ON DELETE SET NULL,
  recommended_action    TEXT    DEFAULT 'review',  -- merge | review | dismiss
  status                TEXT    NOT NULL DEFAULT 'pending',  -- pending | merged | rejected
  run_id                UUID    REFERENCES ai_enrichment_runs(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_company_id, candidate_company_id)
);

CREATE INDEX IF NOT EXISTS idx_merge_rankings_source ON ai_merge_rankings(source_company_id);
CREATE INDEX IF NOT EXISTS idx_merge_rankings_score ON ai_merge_rankings(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_merge_rankings_status ON ai_merge_rankings(status);

-- ─── 4. ai_taxonomy_mappings ─────────────────────────────────────
-- Cache of raw text → normalized category/tag mappings.
-- Avoids redundant AI calls for identical text patterns.

CREATE TABLE IF NOT EXISTS ai_taxonomy_mappings (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text        TEXT    NOT NULL,
  raw_text_hash   TEXT    GENERATED ALWAYS AS (md5(lower(trim(raw_text)))) STORED,
  mapped_category TEXT,           -- primary normalized category name
  mapped_tags     TEXT[],         -- additional normalized tags
  confidence      FLOAT   DEFAULT 0.0 CHECK (confidence >= 0 AND confidence <= 1),
  provider        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomy_mappings_hash ON ai_taxonomy_mappings(raw_text_hash);

-- ─── 5. ai_profile_improvements ──────────────────────────────────
-- AI-generated profile rewrites (descriptions, SEO, bilingual text).
-- Stored as suggestions; applied only after review.

CREATE TABLE IF NOT EXISTS ai_profile_improvements (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id           UUID    REFERENCES ai_enrichment_runs(id) ON DELETE SET NULL,
  improvement_type TEXT    NOT NULL,  -- description | seo | bilingual | scope | full_profile
  -- Generated content
  description_en   TEXT,
  description_ar   TEXT,
  seo_title_en     TEXT,
  seo_title_ar     TEXT,
  seo_description_en TEXT,
  seo_description_ar TEXT,
  scope_summary_en TEXT,
  scope_summary_ar TEXT,
  -- Status
  status           TEXT    NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_improvements_company ON ai_profile_improvements(company_id);
CREATE INDEX IF NOT EXISTS idx_profile_improvements_status ON ai_profile_improvements(status);

-- ─── 6. ai_review_summaries ──────────────────────────────────────
-- Human-readable summaries generated for admin review panels.
-- Explains why a category was assigned, why two records are duplicates, etc.

CREATE TABLE IF NOT EXISTS ai_review_summaries (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT    REFERENCES companies(id) ON DELETE CASCADE,
  merge_ranking_id UUID    REFERENCES ai_merge_rankings(id) ON DELETE CASCADE,
  run_id           UUID    REFERENCES ai_enrichment_runs(id) ON DELETE SET NULL,
  summary_type     TEXT    NOT NULL,  -- category_evidence | merge_evidence | brand_evidence | general
  summary          TEXT    NOT NULL,
  evidence_points  TEXT[],
  confidence       FLOAT   DEFAULT 0.0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_summaries_company ON ai_review_summaries(company_id);

-- ─── 7. Enable Row Level Security ────────────────────────────────

ALTER TABLE ai_enrichment_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_field_suggestions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_merge_rankings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_taxonomy_mappings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_profile_improvements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_review_summaries     ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users + service role to read/write all enrichment tables

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_enrichment_runs', 'ai_field_suggestions', 'ai_merge_rankings',
    'ai_taxonomy_mappings', 'ai_profile_improvements', 'ai_review_summaries'
  ]
  LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS "Enrichment read" ON %I;
      CREATE POLICY "Enrichment read" ON %I FOR SELECT USING (true);

      DROP POLICY IF EXISTS "Enrichment write" ON %I;
      CREATE POLICY "Enrichment write" ON %I FOR ALL
        USING  (auth.role() IN (''authenticated'', ''service_role''))
        WITH CHECK (auth.role() IN (''authenticated'', ''service_role''));
    ', t, t, t, t);
  END LOOP;
END $$;

-- ─── Done ─────────────────────────────────────────────────────────
SELECT 'Migration 20260418_001 complete — AI enrichment tables created.' AS status;
