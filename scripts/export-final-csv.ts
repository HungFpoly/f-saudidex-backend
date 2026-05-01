import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import Papa from 'papaparse';
import * as path from 'path';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

const DB_COLUMNS = [
    'public_company_id', 'id', 'slug', 'name_en', 'name_ar', 'description_en', 'description_ar',
    'website_url', 'email', 'phone', 'cr_number', 'vat_number', 'is_vat_registered',
    'procurement_portal_url', 'chamber_commerce_id', 'linkedin_url', 'instagram_url',
    'twitter_url', 'facebook_url', 'logo_url', 'categories', 'confidence_score',
    'is_verified', 'is_featured', 'status', 'data_source', 'created_at', 'updated_at'
];

async function exportFinalCSV() {
    console.log('📤 Exporting sorted and enriched companies to CSV...');

    try {
        const { data, error } = await supabase
            .from('companies')
            .select('*')
            .order('public_company_id', { ascending: true });

        if (error) throw error;

        const processedData = data.map(row => {
            const sortedRow: any = {};
            DB_COLUMNS.forEach(col => {
                let value = row[col];
                
                // Format types for CSV
                if (Array.isArray(value)) {
                    value = value.join(', ');
                } else if (value && typeof value === 'object') {
                    value = JSON.stringify(value);
                } else if (value === null) {
                    value = '';
                }
                
                sortedRow[col] = value;
            });
            return sortedRow;
        });

        const csv = Papa.unparse({
            fields: DB_COLUMNS,
            data: processedData
        });

        const filename = `all_companies_full_${new Date().toISOString().split('T')[0]}.csv`;
        const filePath = path.join(process.cwd(), filename);
        
        fs.writeFileSync(filePath, csv);
        console.log(`✅ Successfully exported to ${filePath}`);
        console.log(`📊 Exported ${data.length} records.`);
    } catch (err) {
        console.error('❌ Export failed:', err);
    }
}

exportFinalCSV();
