import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

async function callGemini(prompt: string): Promise<string> {
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
    console.log('🌍 Translating company names to Arabic...');

    const { data: companies, error } = await supabase.from('companies').select('id, name_en, name_ar');
    if (error || !companies) {
        console.error('Error fetching companies:', error);
        return;
    }

    let updatedCount = 0;

    for (const company of companies) {
        const nameAr = (company.name_ar || '').trim();
        const nameEn = (company.name_en || '').trim();
        
        // Check if name_ar is empty OR contains English letters OR is equal to name_en
        const isEnglish = /[a-zA-Z]/.test(nameAr);
        const isEmpty = nameAr.length === 0;

        if (isEmpty || isEnglish) {
            console.log(`  🌐 Translating: "${nameEn}"`);
            const prompt = `Translate this company name to professional Arabic (Official Saudi business format): "${nameEn}". Return ONLY the Arabic name.`;
            const translated = await callGemini(prompt);
            console.log(`    📝 Gemini Result: "${translated}"`);
            
            if (translated && translated.trim() !== nameEn && translated.trim() !== '') {
                const { error: upErr } = await supabase
                    .from('companies')
                    .update({ 
                        name_ar: translated.trim(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', company.id);

                if (!upErr) {
                    updatedCount++;
                    console.log(`    ✅ Success`);
                } else {
                    console.error(`\n❌ Failed to update ${nameEn}: ${upErr.message}`);
                }
            } else {
                console.log(`    ⚠️ No valid translation returned or matches English`);
            }
        }
    }

    console.log(`\n\n✅ Done! Updated ${updatedCount} company names.`);
}

run().catch(console.error);
