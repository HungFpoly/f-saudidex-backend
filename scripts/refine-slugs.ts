import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

const STOP_WORDS = new Set([
    'and', 'the', 'of', 'for', 'co', 'corp', 'ltd', 'limited', 'company', 
    'saudi', 'arabia', 'wll', 'fzc', 'fze', 'group', 'industry', 'industries',
    'trading', 'contracting', 'services', 'manufacturing', 'factory', 'branch'
]);

function refineSlug(name: string): string {
    if (!name) return '';

    // 1. Lowercase and replace non-alphanumeric with space
    let slug = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

    // 2. Split into words and filter stop words
    let words = slug.split(/\s+/).filter(word => word.length > 0 && !STOP_WORDS.has(word));

    // 3. Fallback: If everything was a stop word, use the first 2 words of the original name
    if (words.length === 0) {
        words = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).slice(0, 2);
    }

    // 4. Limit length (Max 5 keywords)
    return words.slice(0, 5).join('-');
}

async function run() {
    console.log('🚀 Refining slugs for SEO optimization...');

    const { data: companies, error } = await supabase
        .from('companies')
        .select('id, name_en, slug, categories');

    if (error || !companies) {
        console.error('❌ Error fetching companies:', error);
        return;
    }

    let updatedCount = 0;

    for (const company of companies) {
        const newSlugBase = refineSlug(company.name_en);
        
        // Optional: Hierarchical logic
        // If they have categories, we could do: category/slug
        // But for the database 'slug' field, we usually keep it flat and unique.
        let categoryPrefix = '';
        if (Array.isArray(company.categories) && company.categories.length > 0) {
            categoryPrefix = company.categories[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
        }

        const finalSlug = newSlugBase; // keeping it flat for now as requested for the slug field

        if (finalSlug !== company.slug) {
            console.log(`  🔗 Refined: "${company.slug || 'null'}" -> "${finalSlug}" (${company.name_en})`);
            
            const { error: upErr } = await supabase
                .from('companies')
                .update({ 
                    slug: finalSlug,
                    updated_at: new Date().toISOString()
                })
                .eq('id', company.id);

            if (!upErr) {
                updatedCount++;
            } else {
                // If collision, add public_company_id as suffix
                const fallbackSlug = `${finalSlug}-${company.id.slice(0, 4)}`;
                await supabase.from('companies').update({ slug: fallbackSlug }).eq('id', company.id);
                updatedCount++;
            }
        }
    }

    console.log(`\n✅ Done! Optimized ${updatedCount} slugs.`);
}

run().catch(console.error);
