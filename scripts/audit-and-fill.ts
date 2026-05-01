import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || '';

async function callGemini(prompt: string): Promise<string> {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                }),
            }
        );
        const data: any = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e) {
        return '';
    }
}

async function auditAndFill() {
    console.log('🚀 Starting Review, Sort and Fill process...');

    // 1. Fetch available categories for mapping
    const { data: categoryList } = await supabase.from('categories').select('id, name_en');
    const validCategoryIds = categoryList?.map(c => c.id) || [];
    console.log(`🏷️ Loaded ${validCategoryIds.length} valid category slugs.`);

    // 2. Fetch companies that need filling
    // Priority: missing logo, missing description_ar, or numerical categories
    const { data: companies, error } = await supabase
        .from('companies')
        .select('*');

    if (error) {
        console.error('❌ Error fetching companies:', error.message);
        return;
    }

    console.log(`📊 Processing ${companies.length} records...`);

    let updatedCount = 0;

    for (const company of companies) {
        let needsUpdate = false;
        const updates: any = {};

        // A. Fix numerical categories
        const currentCats = Array.isArray(company.categories) ? company.categories : [];
        const hasNumerical = currentCats.some((c: string) => /^\d+$/.test(c));

        if (hasNumerical || currentCats.length === 0) {
            console.log(`  🛠️ Re-classifying: ${company.name_en}`);
            const prompt = `Based on this company name and description, pick the most relevant category IDs from this list: ${validCategoryIds.join(', ')}. 
            Company: ${company.name_en} - ${company.description_en}
            Return ONLY a comma-separated list of IDs.`;

            const response = await callGemini(prompt);
            const suggested = response.split(',').map(s => s.trim()).filter(id => validCategoryIds.includes(id));
            if (suggested.length > 0) {
                updates.categories = suggested;
                needsUpdate = true;
            }
        }

        // B. Fix missing logo
        if (!company.logo_url && company.website_url) {
            try {
                const url = new URL(company.website_url);
                const domain = url.hostname.replace('www.', '');
                updates.logo_url = `https://logo.clearbit.com/${domain}`;
                needsUpdate = true;
            } catch (e) { }
        }

        // C. Fix missing Arabic description
        if (!company.description_ar && company.description_en) {
            console.log(`  🌍 Translating description: ${company.name_en}`);
            const prompt = `Translate this business description to professional Arabic: "${company.description_en}". Return ONLY the Arabic text.`;
            const translation = await callGemini(prompt);
            if (translation) {
                updates.description_ar = translation.trim();
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            const { error: updateError } = await supabase
                .from('companies')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', company.id);

            if (!updateError) {
                updatedCount++;
                process.stdout.write(`.`);
            } else {
                console.error(`\n   ❌ Failed to update ${company.name_en}: ${updateError.message}`);
            }
        }
    }

    console.log(`\n\n✅ Process complete. ${updatedCount} companies enriched.`);
}

auditAndFill().catch(console.error);
