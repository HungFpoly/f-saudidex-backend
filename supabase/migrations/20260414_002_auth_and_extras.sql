-- Migration 002: Users, Categories, Metadata, Duplicate Groups, and RLS policies
-- Run AFTER 20260413_001_firestore_baseline.sql

-- ============================================================
-- USERS TABLE (mirrors Firebase Auth + Firestore /users)
-- ============================================================
create table if not exists public.users (
  id text primary key,             -- Firebase UID
  email text not null,
  role text default 'user',        -- admin | moderator | user
  display_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- CATEGORIES TABLE
-- ============================================================
create table if not exists public.categories (
  id text primary key,
  name_en text not null,
  name_ar text,
  slug text not null,
  icon text,
  created_at timestamptz default now()
);

create unique index if not exists idx_categories_slug on public.categories (slug);

-- ============================================================
-- METADATA TABLE (replaces Firestore /metadata/company_counter)
-- ============================================================
create table if not exists public.metadata (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Seed the company counter (starts at 100000 so next call = 100001)
insert into public.metadata (key, value) values ('company_counter', '{"lastId": 100000}')
  on conflict (key) do nothing;

-- ============================================================
-- DUPLICATE GROUPS TABLE
-- ============================================================
create table if not exists public.duplicate_groups (
  id text primary key,
  company_ids jsonb default '[]'::jsonb,
  reason text,
  status text default 'pending',   -- pending | resolved
  created_at timestamptz default now()
);

-- ============================================================
-- COMPANY COUNTER FUNCTION (atomic increment via RPC)
-- Replaces Firestore runTransaction on /metadata/company_counter
-- ============================================================
create or replace function public.get_next_company_id()
returns integer
language plpgsql
security definer
as $$
declare
  current_last_id integer;
  new_id integer;
begin
  select (value->>'lastId')::integer
    into current_last_id
    from public.metadata
    where key = 'company_counter'
    for update;

  if current_last_id is null then
    current_last_id := 100000;
  end if;

  new_id := current_last_id + 1;

  update public.metadata
    set value = jsonb_set(value, '{lastId}', to_jsonb(new_id)),
        updated_at = now()
    where key = 'company_counter';

  return new_id;
end;
$$;

-- Batch version: reserve N ids, returns the first in the range
create or replace function public.get_next_company_ids(count integer)
returns integer
language plpgsql
security definer
as $$
declare
  current_last_id integer;
  start_id integer;
begin
  select (value->>'lastId')::integer
    into current_last_id
    from public.metadata
    where key = 'company_counter'
    for update;

  if current_last_id is null then
    current_last_id := 100000;
  end if;

  start_id := current_last_id + 1;

  update public.metadata
    set value = jsonb_set(value, '{lastId}', to_jsonb(current_last_id + count)),
        updated_at = now()
    where key = 'company_counter';

  return start_id;
end;
$$;

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_companies_slug on public.companies (slug);
create index if not exists idx_companies_is_featured on public.companies (is_featured);
create index if not exists idx_companies_city_id on public.companies (city_id);
create index if not exists idx_users_email on public.users (email);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- companies: public can read approved; only service role can write
alter table public.companies enable row level security;

create policy "Public read approved companies"
  on public.companies for select
  using (status = 'approved');

create policy "Service role full access on companies"
  on public.companies for all
  using (auth.role() = 'service_role');

-- inquiries: users see their own; service role sees all
alter table public.inquiries enable row level security;

create policy "Service role full access on inquiries"
  on public.inquiries for all
  using (auth.role() = 'service_role');

-- categories: public read
alter table public.categories enable row level security;

create policy "Public read categories"
  on public.categories for select
  using (true);

create policy "Service role full access on categories"
  on public.categories for all
  using (auth.role() = 'service_role');

-- users: only service role to protect PII
alter table public.users enable row level security;

create policy "Service role full access on users"
  on public.users for all
  using (auth.role() = 'service_role');

-- claim_requests, ai_logs, crawl_schedules, duplicate_groups: service role only
alter table public.claim_requests enable row level security;
alter table public.ai_logs enable row level security;
alter table public.crawl_schedules enable row level security;
alter table public.duplicate_groups enable row level security;

create policy "Service role full access on claim_requests"
  on public.claim_requests for all using (auth.role() = 'service_role');

create policy "Service role full access on ai_logs"
  on public.ai_logs for all using (auth.role() = 'service_role');

create policy "Service role full access on crawl_schedules"
  on public.crawl_schedules for all using (auth.role() = 'service_role');

create policy "Service role full access on duplicate_groups"
  on public.duplicate_groups for all using (auth.role() = 'service_role');
