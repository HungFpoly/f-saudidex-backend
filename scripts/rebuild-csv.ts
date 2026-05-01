import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Column order matches the DB schema (Baseline + Migrations)
const DB_COLUMNS = [
  "id", "slug", "slug_en", "slug_ar", "name_en", "name_ar", "business_type",
  "description_en", "description_ar", "scope_en", "scope_ar", "logo_url",
  "cover_image_url", "website_url", "linkedin_url", "instagram_url",
  "twitter_url", "facebook_url", "email", "contact_email", "sales_email",
  "procurement_email", "phone", "whatsapp", "city_id", "region_id",
  "full_address", "latitude", "longitude", "google_maps_url", "is_verified",
  "is_featured", "status", "master_id", "duplicate_reason", "claimed_by",
  "claim_status", "seo_title_en", "seo_title_ar", "seo_description_en",
  "seo_description_ar", "confidence_score", "data_source", "source_url",
  "source_links", "last_scraped_at", "categories", "brands", "products",
  "fields", "extraction_metadata", "field_metadata", "merged_from",
  "secondary_emails", "secondary_phones", "secondary_websites",
  "secondary_linkedin", "secondary_socials", "created_at", "updated_at",
  "public_company_id", // Added in 20260419000004
  "cr_number", "vat_number", "is_vat_registered", "procurement_portal_url", "chamber_commerce_id" // Added in 20260426000004
];

// confidence scoring logic (from recalc-confidence.ts)
const GENERIC_NAMES = new Set([
  'unknown company', 'test company', 'unnamed', 'n/a', 'company', 'unknown',
  'test', 'unnamed company', 'no name',
]);

function hasValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}

function hasArray(v: any): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string' && v.startsWith('[')) {
      try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) && parsed.length > 0;
      } catch { return false; }
  }
  return false;
}

function calculateConfidence(c: any): number {
  let score = 0;

  // IDENTITY (30%)
  const nameEn = (c.name_en || '').trim().toLowerCase();
  if (hasValue(c.name_en) && !GENERIC_NAMES.has(nameEn))         score += 0.10;
  if (hasValue(c.name_ar))                                        score += 0.05;
  if (hasValue(c.description_en) && c.description_en!.length >= 30) score += 0.08;
  if (hasValue(c.description_ar) && c.description_ar!.length >= 30) score += 0.04;
  if (hasValue(c.business_type) && c.business_type !== 'vendor')  score += 0.03;

  // CONTACT (30%)
  const anyEmail = hasValue(c.email) || hasValue(c.contact_email) || hasValue(c.sales_email) || hasValue(c.procurement_email);
  if (anyEmail)                                                   score += 0.08;
  if (hasValue(c.phone))                                          score += 0.07;
  if (hasValue(c.website_url))                                    score += 0.08;
  const addressMeaningful = hasValue(c.full_address) 
    && c.full_address!.trim().toLowerCase() !== 'saudi arabia'
    && c.full_address!.trim().length > 15;
  if (addressMeaningful)                                          score += 0.04;
  const hasSocial = hasValue(c.linkedin_url) || hasValue(c.instagram_url) || hasValue(c.twitter_url) || hasValue(c.facebook_url);
  if (hasSocial)                                                  score += 0.03;

  // CLASSIFICATION (20%)
  if (hasArray(c.categories))                                     score += 0.08;
  if (Array.isArray(c.categories) && c.categories.length >= 2)    score += 0.04;
  if (hasArray(c.products))                                       score += 0.04;
  if (hasArray(c.brands))                                         score += 0.02;
  if (hasArray(c.fields))                                         score += 0.02;

  // PROVENANCE (20%)
  if (hasValue(c.source_url))                                     score += 0.06;
  if (hasValue(c.data_source))                                    score += 0.04;
  if (c.extraction_metadata && typeof c.extraction_metadata === 'object') score += 0.03;
  if (hasValue(c.last_scraped_at))                                score += 0.03;
  if (hasValue(c.cr_number) || hasValue(c.vat_number))            score += 0.04;

  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}

async function rebuildCsv() {
    const jsonPath = path.join(__dirname, '..', 'backups', 'backup_2026-04-18T15-39-07-101Z', 'companies.json');
    if (!fs.existsSync(jsonPath)) {
        console.error(`❌ Source JSON not found: ${jsonPath}`);
        return;
    }

    console.log('🚀 Rebuilding CSV from JSON backup...');
    const companies = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    const rows = companies.map((c: any) => {
        // Recalculate confidence score before row mapping
        const recalculatedScore = calculateConfidence(c);
        c.confidence_score = recalculatedScore;

        const row: any = {};
        DB_COLUMNS.forEach(col => {
            let val = c[col];
            
            // Format JSONB fields as JSON strings for CSV
            if (val && (typeof val === 'object' || Array.isArray(val))) {
                val = JSON.stringify(val);
            }
            
            row[col] = val ?? '';
        });
        return row;
    });

    const csv = Papa.unparse({
        fields: DB_COLUMNS,
        data: rows
    });

    const outputPath = path.join(__dirname, '..', 'all_companies_full_2026-04-19.csv');
    fs.writeFileSync(outputPath, csv);
    console.log(`✅ CSV rebuilt and correctly sorted: ${outputPath}`);
}

rebuildCsv().catch(console.error);
