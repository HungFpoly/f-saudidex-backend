import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import { GoogleGenAI } from "@google/genai";
import * as cheerio from 'cheerio';

// Configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const groqKey = process.env.GROQ_API_KEY || '';
const geminiKey = process.env.GEMINI_API_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

// Multi-provider initialization
const groq = new Groq({ apiKey: groqKey });
const ai = new GoogleGenAI({ apiKey: geminiKey });

async function searchDuckDuckGo(query: string): Promise<string[]> {
    try {
        const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const links: string[] = [];
        $('.result__url').each((i, el) => {
            if (i < 3) {
                const link = $(el).text().trim();
                if (link) links.push(link.startsWith('http') ? link : `https://${link}`);
            }
        });
        return links;
    } catch (e) {
        console.error(`   ⚠️ DuckDuckGo search failed for ${query}`);
    }
    return [];
}

async function findActualUrl(company: any): Promise<string | null> {
    const searchQuery = `${company.name_en} ${company.name_ar || ''} official website Saudi Arabia`;
    console.log(`   🔎 Searching: ${searchQuery}`);
    
    const candidates = await searchDuckDuckGo(searchQuery);
    
    if (candidates.length === 0) return null;

    for (const candidate of candidates) {
        // Skip common directory sites
        if (candidate.includes('mordorintelligence.com') || candidate.includes('edarabia.com') || candidate.includes('linkedin.com') || candidate.includes('facebook.com')) {
            continue;
        }

        const prompt = `The company name is "${company.name_en}" (Arabic: "${company.name_ar || 'N/A'}"). 
        Does the URL "${candidate}" look like their official corporate website or a direct contact page? 
        Consider domain name matches and relevance.
        Return ONLY the absolute URL if it's a likely match, otherwise return "INVALID".`;

        // Try Groq (Llama 3)
        try {
            console.log(`   🧐 Verifying candidate: ${candidate}`);
            const completion = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
            });

            const result = completion.choices[0].message.content?.trim();
            if (result && result.includes('http') && !result.includes('INVALID')) {
                return result.split('\n')[0];
            }
        } catch (e: any) {
            // Fallback to Gemini
            try {
                const verifyResult = await ai.models.generateContent({
                    model: "gemini-1.5-flash",
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                });
                if (verifyResult && verifyResult.text.includes('http') && !verifyResult.text.includes('INVALID')) {
                    return verifyResult.text.trim().split('\n')[0];
                }
            } catch (gemErr) {}
        }
    }
    
    return null;
}

async function run() {
    console.log(`🔍 Fetching companies with placeholder URLs...`);

    const { data: companies, error } = await supabase
        .from('companies')
        .select('id, name_en, name_ar, website_url')
        .like('website_url', '%.example.sa%');

    if (error || !companies) {
        console.error('Error fetching companies:', error);
        return;
    }

    console.log(`🚀 Found ${companies.length} companies to fix.`);

    for (const company of companies) {
        console.log(`🏢 Company: "${company.name_en}"`);
        
        const actualUrl = await findActualUrl(company);

        if (actualUrl && actualUrl !== 'INVALID') {
            console.log(`   ✅ Confirmed: ${actualUrl}`);
            
            const { error: upErr } = await supabase
                .from('companies')
                .update({ 
                    website_url: actualUrl,
                    updated_at: new Date().toISOString(),
                    extraction_method: 'groq_gemini_fix_hybrid_v2'
                })
                .eq('id', company.id);

            if (upErr) console.error(`   ❌ Update failed: ${upErr.message}`);
        } else {
            console.log(`   ⚠️ No verified URL found. Cleaning up placeholder...`);
            // Set to NULL so the directory doesn't show "fake" links
            const { error: upErr } = await supabase
                .from('companies')
                .update({ 
                    website_url: null,
                    updated_at: new Date().toISOString(),
                    extraction_method: 'cleanup_placeholder'
                })
                .eq('id', company.id);
                
            if (upErr) console.error(`   ❌ Cleanup failed: ${upErr.message}`);
        }
        
        await new Promise(r => setTimeout(r, 1000)); 
    }

    console.log('\n✨ Processing complete.');
}

run().catch(console.error);
