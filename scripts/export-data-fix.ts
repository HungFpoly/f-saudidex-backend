import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import Papa from 'papaparse';
import path from 'path';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function exportCleanCsv() {
    console.log('🚀 Fetching clean data for export...');
    
    const { data: companies, error } = await supabase
        .from('companies')
        .select('*')
        .order('public_company_id', { ascending: true });

    if (error || !companies) {
        console.error('❌ Error fetching companies:', error);
        return;
    }

    console.log(`📊 Exporting ${companies.length} rows with UTF-8 BOM for Excel support...`);

    const csv = Papa.unparse(companies);

    const outputPath = path.join(process.cwd(), 'all_companies_utf8_fix.csv');
    
    // Write UTF-8 BOM first, then the CSV content
    fs.writeFileSync(outputPath, '\ufeff' + csv, 'utf8');
    
    console.log(`\n✅ Created clean CSV with UTF-8 BOM: ${outputPath}`);
    console.log('💡 TIP: Open this file in Excel - the Arabic text should now be correct.');
}

exportCleanCsv().catch(console.error);
