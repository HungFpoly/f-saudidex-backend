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
    console.log('🚀 Starting Robust Review, Sort and Fill...');

    // 1. Get Valid Categories
    const { data: categoriesData } = await supabase.from('categories').select('id, name_en');
    const validIds = new Set(categoriesData?.map(c => c.id.toLowerCase()) || []);
    const idToOriginal = Object.fromEntries(categoriesData?.map(c => [c.id.toLowerCase(), c.id]) || []);
    const nameToId = Object.fromEntries(categoriesData?.map(c => [c.name_en.toLowerCase(), c.id]) || []);
    
    console.log(`🏷️ Loaded ${validIds.size} categories.`);

    // 2. Get All Companies
    const { data: companies, error } = await supabase
        .from('companies')
        .select('*');

    if (error) {
        console.error('Error fetching companies:', error);
        return;
    }

    // Sort companies by name for ID assignment
    companies.sort((a, b) => (a.name_en || '').localeCompare(b.name_en || ''));

    console.log(`📊 Processing ${companies.length} records...`);

    let updatedCount = 0;

    for (let i = 0; i < companies.length; i++) {
        const company = companies[i];
        const updates: any = {};
        let needsUpdate = false;

        // A. Clean Name if it's very long or looks like a description
        if (company.name_en.length > 70 || company.name_en.toLowerCase().includes(' a ')) {
            const prompt = `Extract a short, professional business name from this title: "${company.name_en}". Return ONLY the name.`;
            const clean = await callGemini(prompt);
            if (clean && clean.trim().length < company.name_en.length && clean.trim().length > 2) {
                updates.name_en = clean.trim();
                needsUpdate = true;
            }
        }

        // B. Re-categorization (Strict)
        const currentCats = Array.isArray(company.categories) ? company.categories : [];
        const hasInvalid = currentCats.length === 0 || currentCats.some(c => !validIds.has(c.toLowerCase()));

        if (hasInvalid) {
            console.log(`  🏷️ Re-classifying [${i+1}/${companies.length}]: ${company.name_en}`);
            const prompt = `Select 1-3 appropriate category IDs for this company. Return ONLY the comma-separated IDs.
            
            Company: ${updates.name_en || company.name_en}
            Description: ${company.description_en || ''}
            
            Valid Category IDs:
            ${categoriesData?.map(c => c.id).join(', ')}
            `;

            const resp = await callGemini(prompt);
            const suggested = resp.split(/[\s,]+/)
                .map(s => s.trim().toLowerCase().replace(/^['"]|['"]$/g, ''))
                .filter(s => s.length > 0);
            
            let matched: string[] = [];
            suggested.forEach(s => {
                if (validIds.has(s)) matched.push(idToOriginal[s]);
                else if (nameToId[s]) matched.push(nameToId[s]);
            });

            if (matched.length > 0) {
                updates.categories = matched;
                needsUpdate = true;
            } else {
                 // Try one more time with a simpler list
                 const simpleMatched = categoriesData?.filter(cat => 
                    company.name_en.toLowerCase().includes(cat.name_en.toLowerCase()) || 
                    (company.description_en && company.description_en.toLowerCase().includes(cat.name_en.toLowerCase()))
                 ).map(cat => cat.id).slice(0, 3);
                 
                 if (simpleMatched && simpleMatched.length > 0) {
                     updates.categories = simpleMatched;
                     needsUpdate = true;
                 }
            }
        }

        // C. Logo Filling
        if (!company.logo_url && company.website_url) {
            try {
                const domain = new URL(company.website_url).hostname.replace('www.', '');
                updates.logo_url = `https://logo.clearbit.com/${domain}`;
                needsUpdate = true;
            } catch (e) {}
        }

        // D. Translation
        if (!company.description_ar && company.description_en) {
            const prompt = `Translate to professional Arabic: "${company.description_en}". Return ONLY the Arabic text.`;
            const ar = await callGemini(prompt);
            if (ar) {
                updates.description_ar = ar.trim();
                needsUpdate = true;
            }
        }

        // E. Confidence Score
        const finalObj = { ...company, ...updates };
        let score = 0;
        if (finalObj.name_en) score += 0.2;
        if (finalObj.description_en) score += 0.1;
        if (finalObj.description_ar) score += 0.1;
        if (finalObj.logo_url) score += 0.1;
        if (finalObj.website_url) score += 0.1;
        if (finalObj.email || finalObj.contact_email) score += 0.1;
        if (finalObj.phone) score += 0.1;
        if (Array.isArray(finalObj.categories) && finalObj.categories.length > 0 && finalObj.categories.every((c: any) => validIds.has(c.toLowerCase()))) score += 0.2;
        
        if (score !== company.confidence_score) {
            updates.confidence_score = Math.min(1, score);
            needsUpdate = true;
        }

        // We skip public_company_id in the main loop to avoid constraint violations during multi-process execution.
        // It will be fixed in a separate pass.

        if (needsUpdate) {
            const { error: upErr } = await supabase
                .from('companies')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', company.id);
            
            if (!upErr) {
                updatedCount++;
                process.stdout.write(`.`);
            } else {
                console.error(`\n❌ Failed update for ${company.name_en}: ${upErr.message}`);
            }
        }
    }

    console.log(`\n\n✅ Enrichment complete. Running sorting pass...`);

    // II. Sorting Pass (Re-sequencing IDs)
    // 1. Assign temporary large IDs to avoid conflicts
    const { data: latest } = await supabase.from('companies').select('id').order('name_en', { ascending: true });
    if (latest) {
        for (let i = 0; i < latest.length; i++) {
            await supabase.from('companies').update({ public_company_id: 9990000 + i }).eq('id', latest[i].id);
        }
        // 2. Assign final IDs
        for (let i = 0; i < latest.length; i++) {
            await supabase.from('companies').update({ public_company_id: 1000001 + i }).eq('id', latest[i].id);
            process.stdout.write(`|`);
        }
    }

    console.log(`\n\n🎯 Process fully complete!`);
}

run().catch(console.error);
