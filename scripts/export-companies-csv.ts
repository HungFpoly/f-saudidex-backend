import 'dotenv/config';
import { supabaseAdmin } from '../shared/lib/supabase';
import * as fs from 'fs';
import Papa from 'papaparse';
import * as path from 'path';

async function exportToCSV() {
    if (!supabaseAdmin) {
        console.error('❌ Supabase Admin client not initialized');
        return;
    }

    const filename = 'all_companies_full_2026-04-19.csv';
    const filePath = path.join(process.cwd(), filename);

    console.log(`🚀 Exporting companies from Supabase to ${filename}...`);

    try {
        const { data, error } = await supabaseAdmin
            .from('companies')
            .select('*')
            .order('name_en', { ascending: true });

        if (error) throw error;
        if (!data || data.length === 0) {
            console.log('⚠️ No companies found in the database.');
            return;
        }

        console.log(`📊 Found ${data.length} companies.`);

        const processedData = data.map(row => {
            const newRow = { ...row };
            
            // Format arrays
            [
                'categories', 'brands', 'products', 'merged_from', 
                'secondary_emails', 'secondary_phones', 'secondary_websites', 
                'secondary_linkedin', 'secondary_socials'
            ].forEach(key => {
                if (Array.isArray(newRow[key])) {
                    newRow[key] = newRow[key].join(', ');
                }
            });

            // Format objects
            ['extraction_metadata', 'field_metadata', 'source_links'].forEach(key => {
                if (newRow[key] && typeof newRow[key] === 'object') {
                    newRow[key] = JSON.stringify(newRow[key]);
                }
            });

            return newRow;
        });

        const csv = Papa.unparse(processedData);
        fs.writeFileSync(filePath, csv);

        console.log(`✅ Successfully exported to ${filePath}`);
    } catch (err) {
        console.error('❌ Export failed:', err);
    }
}

exportToCSV();
