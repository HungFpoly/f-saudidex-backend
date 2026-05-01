-- Recovery Migration: Fix RLS recursion
-- This script drops all recursive policies and resets them to safe versions.

-- 1. Disable RLS temporarily to allow modification
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE companies DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries DISABLE ROW LEVEL SECURITY;

-- 2. Drop EVERY potential policy on critical tables dynamically
DO $$ 
DECLARE 
    tbl text;
    pol record;
BEGIN 
    FOR tbl IN SELECT unnest(ARRAY['profiles', 'companies', 'users', 'inquiries']) LOOP
        FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = tbl LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, tbl);
        END LOOP;
    END LOOP;
END $$;

-- 3. Create simple, non-recursive policies
-- Profiles: Everyone can read, only user can write
CREATE POLICY "Public read profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Full access service role profiles" ON profiles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "User manage own profile" ON profiles FOR ALL USING (auth.uid() = id);

-- Companies: Public read, service role full access
CREATE POLICY "Public read companies" ON companies FOR SELECT USING (true);
CREATE POLICY "Full access service role companies" ON companies FOR ALL USING (auth.role() = 'service_role');

-- Users: Public read, user manage own
CREATE POLICY "Public read users" ON users FOR SELECT USING (true);
CREATE POLICY "User manage own user" ON users FOR ALL USING (auth.uid() = id::uuid);

-- Inquiries: Service role or authenticated
CREATE POLICY "Inquiries access" ON inquiries FOR ALL USING (auth.role() = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

-- 4. Re-enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
