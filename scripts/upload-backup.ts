/**
 * Saudidex Backup Restore Script
 * Imports JSON data from a backup folder into Supabase.
 * 
 * Usage: npx tsx scripts/upload-backup.ts [backup_folder_name]
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

if (!supabaseUrl || !supabaseKey) {
  console.log('❌ Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Target backup folder
const backupFolderName = process.argv[2] || 'backup_2026-04-18T15-39-07-101Z';
const backupDir = path.join(process.cwd(), 'backups', backupFolderName);

if (!fs.existsSync(backupDir)) {
  console.log(`❌ Backup directory not found: ${backupDir}`);
  process.exit(1);
}

// Table import order (to handle FKs)
const TABLES_TO_IMPORT = [
  'categories',
  'brands',
  'companies',
  'inquiries',
  'claim_requests',
  'crawl_schedules',
  'ai_logs'
  // company_categories and company_brands are automatically synced via DB triggers from companies table
];

// Mapping of backup ID to current DB ID (for deduplication handling)
const companyIdMap = new Map<string, string>();
const categoryMap = new Map<string, string>(); // id -> name_en
const brandMap = new Map<string, string>();    // id -> name

async function preloadMetadata() {
  const { data: cats } = await supabase.from('categories').select('id, name_en');
  cats?.forEach(c => categoryMap.set(c.id, c.name_en));

  const { data: brands } = await supabase.from('brands').select('id, name');
  brands?.forEach(b => brandMap.set(b.id, b.name));
}

async function importFile(tableName: string) {
  const filePath = path.join(backupDir, `${tableName}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`ℹ️  Skipping ${tableName}: ${tableName}.json not found in backup.`);
    return;
  }

  console.log(`\n📦 Importing ${tableName}...`);
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = JSON.parse(content);

  if (!Array.isArray(rows)) {
    console.log(`❌ Invalid data in ${tableName}.json: Expected an array.`);
    return;
  }

  if (rows.length === 0) {
    console.log(`ℹ️  ${tableName}.json is empty.`);
    return;
  }

  let success = 0;
  let errors = 0;
  let skipped = 0;
  const batchSize = 100;

  // Determine onConflict columns
  let onConflict = 'id';
  if (tableName === 'companies') onConflict = 'name_en';
  if (tableName === 'company_categories') onConflict = 'company_id,category_id';
  if (tableName === 'company_brands') onConflict = 'company_id,brand_name';

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    
    // Clean up and map Row IDs
    const cleanedBatch = batch.map(row => {
      const newRow = { ...row };
      
      // Remap company_id if we have a mapping
      if (newRow.company_id && companyIdMap.has(newRow.company_id)) {
        newRow.company_id = companyIdMap.get(newRow.company_id);
      }

      // Enrich junction tables with required names if missing
      if (tableName === 'company_categories' && !newRow.category_name && newRow.category_id) {
          newRow.category_name = categoryMap.get(newRow.category_id) || newRow.category_id;
      }
      if (tableName === 'company_brands' && !newRow.brand_name && newRow.brand_id) {
          newRow.brand_name = brandMap.get(newRow.brand_id) || newRow.brand_id;
      }

      // Validation for companies
      if (tableName === 'companies') {
        if (!newRow.name_en) return null;
        if (!newRow.slug) {
          newRow.slug = newRow.name_en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        }
        if (!newRow.id) newRow.id = newRow.slug;
      }

      // Ensure created_at/updated_at are valid
      ['created_at', 'updated_at', 'last_scraped_at', 'last_enriched_at'].forEach(key => {
        if (newRow[key] && isNaN(new Date(newRow[key]).getTime())) {
          delete newRow[key];
        }
      });

      return newRow;
    }).filter(r => r !== null);

    skipped += (batch.length - cleanedBatch.length);
    if (cleanedBatch.length === 0) continue;

    // For companies, we always go row-by-row to build the ID map
    if (tableName === 'companies') {
      for (const singleRow of cleanedBatch) {
        const { data: existingByName } = await supabase.from('companies').select('id').eq('name_en', singleRow.name_en).maybeSingle();
        let targetId = singleRow.id;
        if (existingByName) targetId = existingByName.id;
        else {
            const { data: existingById } = await supabase.from('companies').select('id').eq('id', singleRow.id).maybeSingle();
            if (existingById) targetId = existingById.id;
        }

        companyIdMap.set(singleRow.id, targetId);
        const rowToUpsert = { ...singleRow, id: targetId };
        let { error: upsertError } = await supabase.from('companies').upsert(rowToUpsert, { onConflict: 'id' });
        
        if (upsertError?.message?.includes('idx_companies_slug_unique')) {
            rowToUpsert.slug = `${rowToUpsert.slug}-${Math.floor(Math.random() * 1000)}`;
            const retry = await supabase.from('companies').upsert(rowToUpsert, { onConflict: 'id' });
            upsertError = retry.error;
        }

        if (upsertError) {
            console.error(`   ❌ Error in companies row (${singleRow.name_en}):`, upsertError.message);
            errors++;
        } else success++;
      }
    } else {
      // Normal table batch upsert
      const { error } = await supabase.from(tableName).upsert(cleanedBatch, { onConflict });
      
      if (error) {
        for (const singleRow of cleanedBatch) {
          const { error: singleError } = await supabase.from(tableName).upsert(singleRow, { onConflict });
          if (singleError) {
            console.error(`   ❌ Error in ${tableName} row (${singleRow.id || 'unknown'}):`, singleError.message);
            errors++;
          } else success++;
        }
      } else {
        success += cleanedBatch.length;
      }
    }
  }

  console.log(`   ✅ ${tableName}: ${success} rows imported, ${errors} errors, ${skipped} skipped.`);
}

async function run() {
  console.log('🚀 Restoring Saudidex backup to Supabase (with ID Remapping & Enrichment)...');
  console.log(`📂 Source: ${backupFolderName}`);
  console.log('='.repeat(50));

  await preloadMetadata();

  for (const table of TABLES_TO_IMPORT) {
    await importFile(table);
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Restore complete!');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
