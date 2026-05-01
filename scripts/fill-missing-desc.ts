import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

async function callLlama(prompt: string): Promise<string> {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1
            })
        });
        const data: any = await response.json();
        return data.choices?.[0]?.message?.content || '';
    } catch (e) {
        console.error('Groq Error:', e);
        return '';
    }
}

async function run() {
    console.log('🌍 Filling missing Arabic descriptions...');

    const { data: companies, error } = await supabase
        .from('companies')
        .select('id, name_en, description_en, description_ar')
        .or('description_ar.is.null,description_ar.eq.""');

    if (error || !companies) {
        console.error('Error fetching companies:', error);
        return;
    }

    console.log(`🔍 Found ${companies.length} companies with missing Arabic description.`);

    let updatedCount = 0;

    for (const company of companies) {
        const nameEn = company.name_en;
        const descEn = company.description_en || `A business operating in Saudi Arabia.`;
        
        console.log(`  🌐 Translating description for: "${nameEn}"`);
        const prompt = `Translate this business description to professional Arabic: "${descEn}". Company Name: ${nameEn}. Return ONLY the translated Arabic text.`;
        const translated = await callLlama(prompt);
        
        if (translated && translated.trim() !== '') {
            const { error: upErr } = await supabase
                .from('companies')
                .update({ 
                    description_ar: translated.trim(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', company.id);

            if (!upErr) {
                updatedCount++;
                console.log(`    ✅ Success`);
            } else {
                console.error(`    ❌ Failed: ${upErr.message}`);
            }
        }
    }

    console.log(`\n✅ Done! Updated ${updatedCount} descriptions.`);
}

run().catch(console.error);
