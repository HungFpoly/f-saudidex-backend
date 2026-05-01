import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
    console.log('🔍 Auditing companies table...');
    
    const { data: companies, error } = await supabase
        .from('companies')
        .select('*');

    if (error) {
        console.error('❌ Error fetching companies:', error.message);
        return;
    }

    const total = companies.length;
    console.log(`📊 Total Companies: ${total}`);

    const stats = {
        missing_logo: 0,
        missing_website: 0,
        missing_email: 0,
        missing_phone: 0,
        missing_description_ar: 0,
        missing_cr_vat: 0,
        low_confidence: 0,
        missing_name_ar: 0,
        name_ar_english: 0,
    };

    companies.forEach(c => {
        if (!c.logo_url) stats.missing_logo++;
        if (!c.website_url) stats.missing_website++;
        if (!c.email && !c.contact_email) stats.missing_email++;
        if (!c.phone) stats.missing_phone++;
        if (!c.description_ar) stats.missing_description_ar++;
        if (!c.cr_number && !c.vat_number) stats.missing_cr_vat++;
        if (c.confidence_score < 0.5) stats.low_confidence++;
        if (!c.name_ar) stats.missing_name_ar++;
        else if (/[a-zA-Z]/.test(c.name_ar)) stats.name_ar_english++;
    });

    console.log('\n📉 Gap Analysis:');
    Object.entries(stats).forEach(([key, count]) => {
        const percent = ((count / total) * 100).toFixed(1);
        console.log(`  - ${key.replace(/_/g, ' ')}: ${count} (${percent}%)`);
    });

    // Top categories distribution
    const catMap: Record<string, number> = {};
    companies.forEach(c => {
        const cats = Array.isArray(c.categories) ? c.categories : [];
        cats.forEach((cat: string) => {
            catMap[cat] = (catMap[cat] || 0) + 1;
        });
    });

    console.log('\n🏷️  Top Categories:');
    Object.entries(catMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([cat, count]) => {
            console.log(`  - ${cat}: ${count}`);
        });
}

audit().catch(console.error);
