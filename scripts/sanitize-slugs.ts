
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function generateSlug(text: string): string {
  if (!text) return '';
  
  // Basic slugification:
  // 1. Convert to lowercase
  // 2. Replace spaces/underscores with hyphens
  // 3. Remove non-alphanumeric (allowing hyphens and dots, but we want URL safe)
  // For Arabic, we keep the letters but replace spaces.
  
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')      // Replace spaces with -
    .replace(/[^\w\u0621-\u064A.-]+/g, '')  // Remove all non-word chars (allow Arabic, dots, hyphens)
    .replace(/\-\-+/g, '-')    // Replace multiple - with single -
    .replace(/^-+/, '')        // Trim - from start of text
    .replace(/-+$/, '')        // Trim - from end of text
    .replace(/\.+$/, '');      // Trim . from end (specific requirement from audit)
}

async function sanitizeCompanies() {
  console.log('📦 Sanitizing Company Slugs...');
  
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name_en, name_ar, slug');
    
  if (error) {
    console.error('Error fetching companies:', error);
    return;
  }
  
  console.log(`Found ${companies.length} companies.`);
  
  let updated = 0;
  const slugCounts: Record<string, number> = {};

  for (const company of companies) {
    let baseSlug = generateSlug(company.name_en || company.name_ar || 'id-' + company.id);
    
    // Ensure uniqueness
    let finalSlug = baseSlug;
    if (slugCounts[finalSlug] !== undefined) {
      slugCounts[finalSlug]++;
      finalSlug = `${baseSlug}-${slugCounts[finalSlug]}`;
    } else {
      slugCounts[finalSlug] = 0;
    }
    
    if (finalSlug !== company.slug) {
      const { error: updateError } = await supabase
        .from('companies')
        .update({ slug: finalSlug })
        .eq('id', company.id);
        
      if (updateError) {
        console.error(`Error updating company ${company.id}:`, updateError);
      } else {
        updated++;
      }
    }
  }
  
  console.log(`✅ ${updated} companies updated.`);
}

async function sanitizeCategories() {
  console.log('\n📦 Sanitizing Category Slugs...');
  
  const { data: categories, error } = await supabase
    .from('categories')
    .select('id, name_en, slug');
    
  if (error) {
    console.error('Error fetching categories:', error);
    return;
  }
  
  console.log(`Found ${categories.length} categories.`);
  
  let updated = 0;
  for (const category of categories) {
    const finalSlug = generateSlug(category.name_en);
    
    if (finalSlug !== category.slug) {
      const { error: updateError } = await supabase
        .from('categories')
        .update({ slug: finalSlug })
        .eq('id', category.id);
        
      if (updateError) {
        console.error(`Error updating category ${category.id}:`, updateError);
      } else {
        updated++;
      }
    }
  }
  
  console.log(`✅ ${updated} categories updated.`);
}

async function main() {
  await sanitizeCompanies();
  await sanitizeCategories();
  console.log('\n🚀 Migration complete!');
}

main().catch(console.error);
