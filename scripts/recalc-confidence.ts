/**
 * Recalculate confidence_score for all companies in the database.
 *
 * Scoring rubric (0–1 scale, weighted by business value):
 *
 *  IDENTITY (30%)
 *    - name_en present & not generic       10%
 *    - name_ar present                      5%
 *    - description_en ≥ 30 chars            8%
 *    - description_ar ≥ 30 chars            4%
 *    - business_type is meaningful           3%
 *
 *  CONTACT (30%)
 *    - email present                         8%
 *    - phone present                         7%
 *    - website_url present                   8%
 *    - full_address beyond "Saudi Arabia"    4%
 *    - any social (linkedin/insta/twitter)   3%
 *
 *  CLASSIFICATION (20%)
 *    - ≥1 category                           8%
 *    - ≥2 categories                         4%
 *    - ≥1 product                            4%
 *    - ≥1 brand                              2%
 *    - ≥1 field tag                          2%
 *
 *  PROVENANCE (20%)
 *    - source_url present                    6%
 *    - data_source is not empty              4%
 *    - extraction_metadata present           3%
 *    - last_scraped_at present               3%
 *    - cr_number or vat_number               4%
 *
 *  Usage: npx tsx scripts/recalc-confidence.ts [--dry-run]
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

const DRY_RUN = process.argv.includes('--dry-run');

// ── Generic names that should NOT earn full identity points ──
const GENERIC_NAMES = new Set([
  'unknown company', 'test company', 'unnamed', 'n/a', 'company', 'unknown',
  'test', 'unnamed company', 'no name',
]);

interface CompanyRow {
  id: string;
  name_en: string | null;
  name_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  business_type: string | null;
  email: string | null;
  contact_email: string | null;
  sales_email: string | null;
  procurement_email: string | null;
  phone: string | null;
  website_url: string | null;
  full_address: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  facebook_url: string | null;
  categories: string[] | null;
  brands: string[] | null;
  products: string[] | null;
  fields: string[] | null;
  source_url: string | null;
  data_source: string | null;
  extraction_metadata: any;
  last_scraped_at: string | null;
  cr_number: string | null;
  vat_number: string | null;
  confidence_score: number;
}

function hasValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}

function hasArray(v: string[] | null | undefined): boolean {
  return Array.isArray(v) && v.length > 0;
}

function calculateConfidence(c: CompanyRow): number {
  let score = 0;

  // ── IDENTITY (30%) ──
  const nameEn = (c.name_en || '').trim().toLowerCase();
  if (hasValue(c.name_en) && !GENERIC_NAMES.has(nameEn))         score += 0.10;
  if (hasValue(c.name_ar))                                        score += 0.05;
  if (hasValue(c.description_en) && c.description_en!.length >= 30) score += 0.08;
  if (hasValue(c.description_ar) && c.description_ar!.length >= 30) score += 0.04;
  if (hasValue(c.business_type) && c.business_type !== 'vendor')  score += 0.03; // vendor is the default

  // ── CONTACT (30%) ──
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

  // ── CLASSIFICATION (20%) ──
  if (hasArray(c.categories))                                     score += 0.08;
  if (Array.isArray(c.categories) && c.categories.length >= 2)    score += 0.04;
  if (hasArray(c.products))                                       score += 0.04;
  if (hasArray(c.brands))                                         score += 0.02;
  if (hasArray(c.fields))                                         score += 0.02;

  // ── PROVENANCE (20%) ──
  if (hasValue(c.source_url))                                     score += 0.06;
  if (hasValue(c.data_source))                                    score += 0.04;
  if (c.extraction_metadata && typeof c.extraction_metadata === 'object') score += 0.03;
  if (hasValue(c.last_scraped_at))                                score += 0.03;
  if (hasValue(c.cr_number) || hasValue(c.vat_number))            score += 0.04;

  // Clamp to [0, 1] and round to 2 decimal places
  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}

async function run() {
  console.log(`🔄 Recalculating confidence scores${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  // Fetch all companies
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name_en, name_ar, description_en, description_ar, business_type, email, contact_email, sales_email, procurement_email, phone, website_url, full_address, linkedin_url, instagram_url, twitter_url, facebook_url, categories, brands, products, fields, source_url, data_source, extraction_metadata, last_scraped_at, cr_number, vat_number, confidence_score');

  if (error) {
    console.error('❌ Failed to fetch companies:', error.message);
    process.exit(1);
  }

  if (!companies || companies.length === 0) {
    console.log('⚠️  No companies found.');
    return;
  }

  console.log(`📊 ${companies.length} companies loaded.\n`);

  let changed = 0;
  let unchanged = 0;
  const updates: { id: string; confidence_score: number }[] = [];
  const distribution: Record<string, number> = { '0.0-0.2': 0, '0.2-0.4': 0, '0.4-0.6': 0, '0.6-0.8': 0, '0.8-1.0': 0 };

  for (const company of companies as CompanyRow[]) {
    const newScore = calculateConfidence(company);
    const oldScore = company.confidence_score ?? 0;

    // Classify into distribution buckets
    if (newScore < 0.2)      distribution['0.0-0.2']++;
    else if (newScore < 0.4) distribution['0.2-0.4']++;
    else if (newScore < 0.6) distribution['0.4-0.6']++;
    else if (newScore < 0.8) distribution['0.6-0.8']++;
    else                     distribution['0.8-1.0']++;

    if (Math.abs(newScore - oldScore) > 0.005) {
      changed++;
      updates.push({ id: company.id, confidence_score: newScore });

      if (changed <= 10 || Math.abs(newScore - oldScore) > 0.3) {
        const arrow = newScore > oldScore ? '📈' : '📉';
        console.log(`  ${arrow} ${(company.name_en || 'N/A').substring(0, 40).padEnd(42)} ${oldScore.toFixed(2)} → ${newScore.toFixed(2)}`);
      }
    } else {
      unchanged++;
    }
  }

  if (changed > 10) {
    console.log(`  ... and ${changed - 10} more changes.\n`);
  }

  // Print distribution
  console.log('\n📊 Score Distribution:');
  const total = companies.length;
  for (const [range, count] of Object.entries(distribution)) {
    const bar = '█'.repeat(Math.round((count / total) * 40));
    console.log(`  ${range}: ${bar} ${count} (${Math.round(count / total * 100)}%)`);
  }

  const avgScore = updates.length > 0
    ? (companies as CompanyRow[]).reduce((s, c) => s + calculateConfidence(c), 0) / total
    : (companies as CompanyRow[]).reduce((s, c) => s + (c.confidence_score || 0), 0) / total;
  console.log(`\n  Average confidence: ${avgScore.toFixed(2)}`);
  console.log(`  Changed: ${changed} | Unchanged: ${unchanged}`);

  if (DRY_RUN) {
    console.log('\n🏁 Dry run complete — no database changes made.');
    return;
  }

  if (updates.length === 0) {
    console.log('\n✅ All scores already correct — nothing to update.');
    return;
  }

  // Batch update in groups of 50
  console.log(`\n💾 Writing ${updates.length} updates to database...`);
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    // Supabase doesn't support bulk update by different IDs, so row-by-row
    for (const { id, confidence_score } of batch) {
      const { error: updateError } = await supabase
        .from('companies')
        .update({ confidence_score, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (updateError) {
        errorCount++;
      } else {
        successCount++;
      }
    }
    process.stdout.write(`  Progress: ${Math.min(i + 50, updates.length)}/${updates.length}\r`);
  }

  console.log(`\n✅ Done! ${successCount} updated, ${errorCount} errors.`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
