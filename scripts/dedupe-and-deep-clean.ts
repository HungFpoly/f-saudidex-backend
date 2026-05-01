import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || '';

async function callGemini(prompt: string): Promise<string> {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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

async function run() {
    console.log('🚀 Starting Final Deduplication and Deep Clean...');

    const { data: companies, error } = await supabase.from('companies').select('*');
    if (error || !companies) return;

    console.log(`📊 Initial count: ${companies.length}`);

    const seenNames = new Map();
    const toDelete = new Set<string>();

    for (let company of companies) {
        let name = company.name_en.trim();
        
        // 1. Deep Clean Name
        if (name.length > 60 || name.toLowerCase().includes(' a ') || name.toLowerCase().includes(' manufacturer ')) {
            const prompt = `Extract a short, clean professional company name from this text (ignore slogans/descriptions). 
            Text: "${name}"
            Return ONLY the name, no extra characters.`;
            const clean = await callGemini(prompt);
            if (clean && clean.trim().length > 2 && clean.trim().length < name.length) {
                console.log(`  ✨ Cleaned: "${name.substring(0, 20)}..." -> "${clean.trim()}"`);
                name = clean.trim();
                await supabase.from('companies').update({ name_en: name }).eq('id', company.id);
            }
        }

        // 2. Normalize for Dedupe
        const norm = name.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .replace('limited', 'ltd')
            .replace('company', 'co')
            .replace('industrial', 'ind')
            .trim();
        
        if (seenNames.has(norm)) {
            const originalId = seenNames.get(norm);
            console.log(`  🗑️ Duplicate detected: "${name}" (Mapping to existing)`);
            
            // Merge data if missing in original?
            // For now, just mark for deletion to keep it simple and clean
            toDelete.add(company.id);
        } else {
            seenNames.set(norm, company.id);
        }
    }

    if (toDelete.size > 0) {
        console.log(`\n🚮 Deleting ${toDelete.size} duplicates...`);
        const { error: delErr } = await supabase.from('companies').delete().in('id', Array.from(toDelete));
        if (delErr) console.error('Delete error:', delErr);
    }

    // 3. Final Re-sequencing
    const { data: final } = await supabase.from('companies').select('id').order('name_en', { ascending: true });
    if (final) {
        console.log(`\n🔢 Final count: ${final.length}. Re-sequencing IDs...`);
        // Offset
        for (let i = 0; i < final.length; i++) {
           await supabase.from('companies').update({ public_company_id: 8880000 + i }).eq('id', final[i].id);
        }
        // Apply
        for (let i = 0; i < final.length; i++) {
            await supabase.from('companies').update({ public_company_id: 1000001 + i }).eq('id', final[i].id);
        }
    }

    console.log(`\n✅ Deep Clean complete!`);
}

run().catch(console.error);
