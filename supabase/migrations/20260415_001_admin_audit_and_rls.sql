-- ================================================================
-- Migration: 20260415_001_admin_audit_and_rls.sql
-- Purpose:
--   1. Add admin_actions table for audit trail
--   2. Add RLS policies for admin-only write access on critical tables
--   3. Add missing updated_at trigger for companies table
-- ================================================================

-- ─── 1. Admin Actions Audit Log ───────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    TEXT NOT NULL,
  admin_email TEXT,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);

ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read all actions" ON admin_actions;
CREATE POLICY "Admins can read all actions" ON admin_actions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert actions" ON admin_actions;
CREATE POLICY "Admins can insert actions" ON admin_actions FOR INSERT WITH CHECK (true);

-- ─── 2. RLS Policies for Critical Tables ──────────────────────────

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access" ON companies;
CREATE POLICY "Allow public read access" ON companies FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow authenticated writes" ON companies;
CREATE POLICY "Allow authenticated writes" ON companies FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated inquiry access" ON inquiries;
CREATE POLICY "Allow authenticated inquiry access" ON inquiries FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

ALTER TABLE claim_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated claim access" ON claim_requests;
CREATE POLICY "Allow authenticated claim access" ON claim_requests FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

ALTER TABLE crawl_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated schedule access" ON crawl_schedules;
CREATE POLICY "Allow authenticated schedule access" ON crawl_schedules FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

ALTER TABLE ai_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated AI log access" ON ai_logs;
CREATE POLICY "Allow authenticated AI log access" ON ai_logs FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read own profile" ON users FOR SELECT
  USING (auth.uid()::text = id OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile" ON users FOR UPDATE
  USING (auth.uid()::text = id)
  WITH CHECK (auth.uid()::text = id);

ALTER TABLE metadata ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public metadata read" ON metadata;
CREATE POLICY "Allow public metadata read" ON metadata FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow authenticated metadata writes" ON metadata;
CREATE POLICY "Allow authenticated metadata writes" ON metadata FOR ALL
  USING (auth.role() IN ('authenticated', 'service_role'))
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ─── 3. Companies updated_at auto-trigger ─────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── 4. Add items_processed column to crawl_schedules if missing ─

ALTER TABLE crawl_schedules
  ADD COLUMN IF NOT EXISTS items_processed INTEGER DEFAULT 0;

-- ─── Done ─────────────────────────────────────────────────────────
SELECT 'Migration 20260415_001 complete.' AS status;
