export type BusinessType = 'vendor' | 'manufacturer' | 'trader';

export interface ResearchGoal {
  query: string;
  breadth: number;
  depth: number;
}

export interface ResearchFinding {
  source_url: string;
  title: string;
  content: string;
}

export interface ResearchState {
  goal: ResearchGoal;
  learnings: string[];
  visited_urls: string[];
  follow_up_questions: string[];
  report?: string;
  is_searching: boolean;
  current_step: string;
}

export interface FieldMetadata {
  confidence: number;
  source_url?: string;
  last_updated: string;
}

export interface ExtractionMetadata {
  run_id?: string;
  model?: string;
  extracted_at: string;
  field_confidence?: Record<string, number>;
  field_evidence?: Record<string, string>;
  raw_summary?: string;
  original_data?: any;
}

export interface Company {
  id: string;
  slug: string;
  slug_en?: string;
  slug_ar?: string;
  name_en: string;
  name_ar: string;
  business_type: BusinessType;
  description_en: string;
  description_ar: string;
  scope_en?: string;
  scope_ar?: string;
  logo_url?: string;
  cover_image_url?: string;
  website_url?: string;
  linkedin_url?: string;
  email?: string;
  contact_email?: string;
  sales_email?: string;
  procurement_email?: string;
  phone?: string;
  whatsapp?: string;
  city_id: string;
  region_id: string;
  full_address: string;
  latitude?: number;
  longitude?: number;
  google_maps_url?: string;
  is_verified: boolean;
  is_featured: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'duplicated';
  master_id?: string;
  duplicate_reason?: string;
  claimed_by?: string;
  claim_status?: 'unclaimed' | 'pending' | 'verified';
  seo_title_en?: string;
  seo_title_ar?: string;
  seo_description_en?: string;
  seo_description_ar?: string;
  confidence_score: number;
  data_source: string;
  source_url?: string;
  source_domain?: string;
  source_links?: string[];
  raw_text?: string;
  raw_json?: any;
  data_quality_score?: number;
  scrape_status?: 'success' | 'partial' | 'failed_parse' | 'failed_request' | 'blocked';
  first_seen_at?: string;
  last_seen_at?: string;
  last_scraped_at?: string;
  created_at: string;
  updated_at: string;
  categories: string[];
  brands: string[];
  products: string[];
  fields: string[];
  extraction_metadata?: ExtractionMetadata;
  field_metadata?: Record<string, FieldMetadata>;
  merged_from?: string[];
  secondary_emails?: string[];
  secondary_phones?: string[];
  secondary_websites?: string[];
  instagram_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  secondary_linkedin?: string[];
  secondary_socials?: string[];
  youtube_url?: string;
  tiktok_url?: string;
  locations?: string[];
  services?: string[];
  team_members?: { name: string; role: string }[];
  extraction_method?: 'adapter' | 'json-ld' | 'meta' | 'ai';
  public_company_id: number;
  // Saudi-specific data
  cr_number?: string;
  vat_number?: string;
  is_vat_registered?: boolean;
  procurement_portal_url?: string;
  chamber_commerce_id?: string;
}

export interface Category {
  id: string;
  name_en: string;
  name_ar: string;
  slug: string;
  icon?: string;
}

export interface Region {
  id: string;
  name_en: string;
  name_ar: string;
  slug: string;
}

export interface City {
  id: string;
  region_id: string;
  name_en: string;
  name_ar: string;
  slug: string;
}

export interface Inquiry {
  id: string;
  company_id: string;
  company_name: string;
  sender_id?: string;
  sender_name: string;
  sender_email: string;
  sender_phone?: string;
  subject: string;
  message: string;
  status: 'new' | 'sent' | 'read' | 'archived';
  type: 'general' | 'quote' | 'partnership';
  created_at: string;
}

export interface DuplicateGroup {
  id: string;
  companyIds: string[];
  reason: string;
  status: 'pending' | 'resolved';
}
