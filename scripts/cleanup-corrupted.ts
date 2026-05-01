import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
    console.log('🧹 Cleaning up corrupted records...');
    
    const { data: companies } = await supabase.from('companies').select('*');
    if (!companies) return;

    for (const c of companies) {
        let needsDelete = false;
        
        // 1. Name is an email
        if (c.name_en && c.name_en.includes('@') && !c.name_en.includes(' ')) {
            console.log(`🗑️ Deleting email-named record: ${c.name_en}`);
            needsDelete = true;
        }
        
        // 2. Name is a date string
        if (c.name_en && c.name_en.match(/^\d{4}-\d{2}-\d{2}/)) {
            console.log(`🗑️ Deleting date-named record: ${c.name_en}`);
            needsDelete = true;
        }

        // 3. Name is just a number
        if (c.name_en && !isNaN(Number(c.name_en.replace(/\+/g, '')))) {
            console.log(`🗑️ Deleting numeric-named record: ${c.name_en}`);
            needsDelete = true;
        }

        if (needsDelete) {
            await supabase.from('companies').delete().eq('id', c.id);
        }
    }
    console.log('✅ Cleanup complete.');
}

cleanup().catch(console.error);
