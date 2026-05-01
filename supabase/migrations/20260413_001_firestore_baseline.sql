-- Firestore -> Supabase baseline schema for Saudidex collections.
-- Run this before importing JSON files with firebase-to-supabase.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id text primary key,
  slug text not null,
  slug_en text,
  slug_ar text,
  name_en text not null,
  name_ar text,
  business_type text,
  description_en text,
  description_ar text,
  scope_en text,
  scope_ar text,
  logo_url text,
  cover_image_url text,
  website_url text,
  linkedin_url text,
  instagram_url text,
  twitter_url text,
  facebook_url text,
  email text,
  contact_email text,
  sales_email text,
  procurement_email text,
  phone text,
  whatsapp text,
  city_id text,
  region_id text,
  full_address text,
  latitude numeric,
  longitude numeric,
  google_maps_url text,
  is_verified boolean default false,
  is_featured boolean default false,
  status text,
  master_id text,
  duplicate_reason text,
  claimed_by text,
  claim_status text,
  seo_title_en text,
  seo_title_ar text,
  seo_description_en text,
  seo_description_ar text,
  confidence_score numeric,
  data_source text,
  source_url text,
  source_links jsonb default '[]'::jsonb,
  last_scraped_at timestamptz,
  categories jsonb default '[]'::jsonb,
  brands jsonb default '[]'::jsonb,
  products jsonb default '[]'::jsonb,
  fields jsonb default '[]'::jsonb,
  extraction_metadata jsonb,
  field_metadata jsonb,
  merged_from jsonb default '[]'::jsonb,
  secondary_emails jsonb default '[]'::jsonb,
  secondary_phones jsonb default '[]'::jsonb,
  secondary_websites jsonb default '[]'::jsonb,
  secondary_linkedin jsonb default '[]'::jsonb,
  secondary_socials jsonb default '[]'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.inquiries (
  id text primary key,
  company_id text,
  company_name text,
  sender_id text,
  sender_name text,
  sender_email text,
  sender_phone text,
  subject text,
  message text,
  status text,
  type text,
  created_at timestamptz
);

create table if not exists public.claim_requests (
  id text primary key,
  company_id text,
  company_name text,
  claimant_name text,
  claimant_email text,
  claimant_phone text,
  status text,
  note text,
  created_at timestamptz,
  updated_at timestamptz,
  payload jsonb
);

create table if not exists public.crawl_schedules (
  id text primary key,
  url text,
  frequency text,
  is_active boolean default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  payload jsonb
);

create table if not exists public.ai_logs (
  id text primary key,
  provider text,
  model text,
  type text,
  status text,
  duration_ms integer,
  error_message text,
  usage jsonb,
  request_payload jsonb,
  response_payload jsonb,
  created_at timestamptz
);

create index if not exists idx_companies_status on public.companies (status);
create index if not exists idx_companies_name_en on public.companies (name_en);
create index if not exists idx_companies_website_url on public.companies (website_url);
create index if not exists idx_inquiries_company_id on public.inquiries (company_id);
create index if not exists idx_claim_requests_company_id on public.claim_requests (company_id);
create index if not exists idx_ai_logs_created_at on public.ai_logs (created_at desc);
