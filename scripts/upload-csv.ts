import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import Papa from 'papaparse';
import path from 'path';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadCsv(filePath: string) {
    console.log(`🚀 Starting upload: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        return;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    const { data, errors } = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
    });

    if (errors.length > 0) {
        console.error('❌ CSV Parsing errors:', errors);
        return;
    }

    console.log(`📊 Parsed ${data.length} records. Deduplicating and Preparing for upsert...`);

    // 1. Fetch ALL existing companies to sync IDs (paginated)
    console.log('🔄 Fetching existing companies from database for deep sync...');
    const existingCompanies: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    
    while (true) {
        const { data: chunk, error: fetchError } = await supabase
            .from('companies')
            .select('id, name_en, public_company_id, slug')
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        
        if (fetchError) {
            console.error('❌ Failed to fetch existing companies:', fetchError);
            return;
        }

        if (!chunk || chunk.length === 0) break;
        existingCompanies.push(...chunk);
        page++;
        console.log(`  Fetched ${existingCompanies.length} records...`);
    }

    const nameToData = new Map();
    const takenIds = new Set();
    const takenPublicIds = new Set();
    const takenSlugs = new Set();
    let maxId = 100000;
    let maxPublicId = 1000000;

    const normalizeForMatch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    existingCompanies.forEach(c => {
        const matchKey = normalizeForMatch(c.name_en || '');
        if (matchKey) nameToData.set(matchKey, { id: c.id, public_company_id: c.public_company_id });
        
        const numericId = parseInt(c.id);
        if (!isNaN(numericId)) {
            takenIds.add(numericId);
            if (numericId > maxId) maxId = numericId;
        }

        const pubId = parseInt(c.public_company_id);
        if (!isNaN(pubId)) {
            takenPublicIds.add(pubId);
            if (pubId > maxPublicId) maxPublicId = pubId;
        }

        if (c.slug) takenSlugs.add(c.slug);
    });
    console.log(`📡 Found total ${existingCompanies.length} existing records.`);

    // List of array columns
    const arrayColumns = [
        'categories', 'brands', 'products', 'fields', 
        'extraction_metadata', 'field_metadata', 'merged_from',
        'secondary_emails', 'secondary_phones', 'secondary_websites', 
        'secondary_linkedin', 'secondary_socials', 'source_links'
    ];

    // 2. Process CSV data
    const uniqueRecordsMap = new Map();
    const batchSlugs = new Set();
    
    data.forEach((row: any) => {
        if (!row.name_en) return; 
        
        const nameEn = row.name_en.trim();
        const nameKey = nameEn.toLowerCase();
        
        // CLEANING STEP
        Object.keys(row).forEach(key => {
            if (typeof row[key] === 'string') {
                const val = row[key].trim();
                // Remove garbage strings
                if (val === '[object Object]' || val === '[]' || val === 'null' || val === 'undefined') {
                    row[key] = arrayColumns.includes(key) ? [] : null;
                } else if (arrayColumns.includes(key)) {
                    // Try to parse or split
                    try {
                        if (val.startsWith('[') && val.endsWith(']')) {
                            row[key] = JSON.parse(val);
                        } else {
                            row[key] = val.split(',').map((s: string) => s.trim()).filter(Boolean);
                        }
                    } catch (e) {
                        row[key] = val.split(',').map((s: string) => s.trim()).filter(Boolean);
                    }
                }
            } else if (arrayColumns.includes(key) && !Array.isArray(row[key])) {
                row[key] = [];
            }
        });

        // Slug deduplication (Batch-wide)
        let slug = row.slug || '';
        if (slug && (takenSlugs.has(slug) || batchSlugs.has(slug))) {
            // Only regenerate if this name doesn't already own this slug in the DB
            const existing = nameToData.get(nameKey);
            // If we don't have an existing company with this name OR the existing one has a DIFFERENT slug
            if (!existing || (existingCompanies?.find(c => c.id === existing.id)?.slug !== slug)) {
                let counter = 1;
                let originalSlug = slug;
                while (takenSlugs.has(slug) || batchSlugs.has(slug)) {
                    slug = `${originalSlug}-${counter}`;
                    counter++;
                }
            }
        }
        if (slug) batchSlugs.add(slug);

        // Aggressive normalization for matching
        const normalizeForMatch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const matchKey = normalizeForMatch(nameEn);
        
        let finalId;
        let finalPublicId;
        const existing = nameToData.get(matchKey);

        if (existing) {
            finalId = existing.id;
            finalPublicId = existing.public_company_id;
        } else {
            // New record - assign collision-free IDs
            const csvId = parseInt(row.id);
            if (!isNaN(csvId) && !takenIds.has(csvId)) {
                finalId = csvId.toString();
                takenIds.add(csvId);
            } else {
                maxId++;
                finalId = maxId.toString();
                takenIds.add(maxId);
            }

            const csvPubId = parseInt(row.public_company_id);
            if (!isNaN(csvPubId) && !takenPublicIds.has(csvPubId)) {
                finalPublicId = csvPubId;
                takenPublicIds.add(csvPubId);
            } else {
                maxPublicId++;
                finalPublicId = maxPublicId;
                takenPublicIds.add(maxPublicId);
            }
        }

        uniqueRecordsMap.set(matchKey, {
            ...row,
            id: finalId,
            public_company_id: finalPublicId,
            slug,
            updated_at: new Date().toISOString()
        });
    });

    const records = Array.from(uniqueRecordsMap.values());
    console.log(`✨ Final preparation for ${records.length} unique records sync.`);

    const toUpdate = [];
    const toInsert = [];

    records.forEach(r => {
        const matchKey = normalizeForMatch(r.name_en || '');
        if (nameToData.has(matchKey)) {
            toUpdate.push(r);
        } else {
            toInsert.push(r);
        }
    });

    console.log(`✨ Sync Plan: ${toUpdate.length} updates, ${toInsert.length} inserts.`);

    const CHUNK_SIZE = 1;
    let successCount = 0;
    let failCount = 0;

    // Phase 1: Updates
    if (toUpdate.length > 0) {
        console.log('🔄 Executing updates...');
        for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
            const chunk = toUpdate.slice(i, i + CHUNK_SIZE);
            const { error } = await supabase.from('companies').upsert(chunk, { onConflict: 'id' });
            if (error) {
                console.error(`❌ Update error at row ${i}:`, error.message);
                failCount += chunk.length;
            } else {
                successCount += chunk.length;
                process.stdout.write(`✅ Updated ${successCount}/${toUpdate.length}...\r`);
            }
        }
        console.log('\n');
    }

    // Phase 2: Inserts
    if (toInsert.length > 0) {
        console.log('➕ Executing inserts...');
        let insertSuccess = 0;
        for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
            const chunk = toInsert.slice(i, i + CHUNK_SIZE);
            const { error } = await supabase.from('companies').insert(chunk);
            if (error) {
                console.error(`❌ Insert error at row ${i}:`, error.message);
                failCount += chunk.length;
            } else {
                insertSuccess += chunk.length;
                process.stdout.write(`✅ Inserted ${insertSuccess}/${toInsert.length}...\r`);
            }
        }
        successCount += insertSuccess;
        console.log('\n');
    }

    console.log(`\n\n🎉 Upload Complete!`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
}

const csvPath = path.join(process.cwd(), 'all_companies_utf8_perfectly_cleaned.csv');
uploadCsv(csvPath).catch(console.error);
