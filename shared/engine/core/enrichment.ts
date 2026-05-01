/**
 * Saudidex Enrichment Logic
 * Modularized AI prompting for company classification, normalization, and brand detection.
 */

import { aiInstances } from "../../lib/ai/backendProviders";
import { getProvider, AIProvider, FALLBACK_CHAINS, isProviderEnabled, WorkloadType } from "../../config/aiProviders";
import { safeJsonParse, ENV_KEY_MAP } from "./utils";
import { validator } from "../../lib/validator";
import { recordAIEnrichment, getAITokenUsage } from "../../lib/observability";
import OpenAI from "openai";

/**
 * AI Enrichment Taxonomy
 */
export const ENRICHMENT_TAXONOMY: string[] = [
  'Industrial Automation', 'Electrical Equipment', 'HVAC',
  'Construction & Building Materials', 'Medical Supplies & Healthcare',
  'IT Services & Technology', 'Industrial Equipment & Machinery',
  'Food Manufacturing & Beverage', 'Chemicals & Plastics', 'Automotive',
  'Energy & Utilities', 'Transport & Logistics', 'Low Current Systems',
  'Fire & Safety Systems', 'General Manufacturing', 'Metals & Mining',
  'Agriculture & Farming', 'Textiles & Apparel', 'Oil & Gas Services',
  'Water & Wastewater Treatment', 'Printing & Packaging',
  'Facility Management & Maintenance', 'MEP Contracting',
  'Trading & Distribution', 'Real Estate & Property',
];

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function getOpenRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const siteUrl = process.env.OPENROUTER_SITE_URL || process.env.APP_URL;
  const appTitle = process.env.OPENROUTER_APP_NAME || process.env.APP_NAME;

  if (siteUrl) headers["HTTP-Referer"] = siteUrl;
  if (appTitle) headers["X-Title"] = appTitle;

  return headers;
}

/**
 * Centralized function to call different AI providers
 */
export async function callProvider(
  provider: AIProvider, 
  prompt: string, 
  instructions: string, 
  model?: string,
  media?: { mimeType: string; data: string }[]
) {
  const baseConfig = getProvider(provider);
  if (!baseConfig) throw new Error(`Unsupported AI provider: ${provider}`);
  if (!baseConfig.enabled) throw new Error(`AI Provider ${provider} is disabled via configuration.`);

  const envKey = ENV_KEY_MAP[provider];
  const apiKey = process.env[envKey] || (provider === 'gemini' ? process.env.VITE_GEMINI_API_KEY : undefined);
  
  // Model Tiering Logic: Choose best price/performance if no specific model requested
  let targetModel = model;
  if (!targetModel) {
    const isEnrichment = instructions.toLowerCase().includes('extract') || instructions.toLowerCase().includes('complex');
    targetModel = isEnrichment ? baseConfig.enrichmentModel : baseConfig.discoveryModel;
  }
  
  const config = {
    ...baseConfig,
    apiKey,
    defaultModel: targetModel
  };

  if (provider !== 'webllm' && !config.apiKey) {
    throw new Error(`API key for ${provider} (${envKey}) is not configured.`);
  }

  if (provider === 'webllm') {
    throw new Error('webllm is a browser-only provider and is not available in backend enrichment.');
  }

  const startTime = Date.now();
  let result: any = null;
  let usage: any = null;
  let modelUsed: string | null = null;

  try {
    if (provider === 'groq') {
      const groq = aiInstances.getGroq(config.apiKey);
      const completion = await groq.chat.completions.create({
        messages: [{ role: "system", content: instructions }, { role: "user", content: prompt }],
        model: model || config.defaultModel,
      });
      result = completion.choices[0]?.message;
      usage = completion.usage;
      modelUsed = completion.model;
    } else if (provider === 'mistral') {
      const mistral = aiInstances.getMistral(config.apiKey);
      const chatResponse = await mistral.chat.complete({
        model: model || config.defaultModel,
        messages: [{ role: "system", content: instructions }, { role: "user", content: prompt }]
      });
      result = chatResponse.choices[0]?.message;
      usage = chatResponse.usage;
      modelUsed = chatResponse.model;
    } else if (provider === 'openrouter') {
      const defaultHeaders = getOpenRouterHeaders();
      const openRouter = new OpenAI({
        apiKey: config.apiKey,
        baseURL: OPENROUTER_BASE_URL,
        ...(Object.keys(defaultHeaders).length > 0 ? { defaultHeaders } : {}),
      });

      const completion = await openRouter.chat.completions.create({
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: prompt },
        ],
        model: model || config.defaultModel,
      });

      result = completion.choices[0]?.message;
      usage = completion.usage;
      modelUsed = completion.model;
    } else if (provider === 'huggingface') {
      const hf = aiInstances.getHf(config.apiKey);
      const inferenceResult = await hf.textGeneration({
        model: model || config.defaultModel,
        inputs: `System: ${instructions}\n\nUser: ${prompt}`,
        parameters: { max_new_tokens: 2048 },
      });
      result = { content: inferenceResult.generated_text };
      usage = { total_tokens: Math.round((prompt.length + result.content.length) / 4) };
    } else if (provider === 'gemini') {
      const parts: any[] = [{ text: `${instructions}\n\n${prompt}` }];
      
      if (media && media.length > 0) {
        media.forEach(m => {
          parts.push({
            inline_data: {
              mime_type: m.mimeType,
              data: m.data
            }
          });
        });
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || config.defaultModel}:generateContent?key=${config.apiKey}`;
      const appUrl = process.env.APP_URL || "https://saudidex.onrender.com";

      const geminiResponse = await fetch(url, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Referer": appUrl,
            "Origin": new URL(appUrl).origin
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseMimeType: "application/json" }
          }),
        }
      );

      if (!geminiResponse.ok) {
        const errorBody = await geminiResponse.text().catch(() => "");
        let errorMessage = `Gemini API error (${geminiResponse.status}): ${geminiResponse.statusText}`;
        try {
          const parsedError = JSON.parse(errorBody);
          errorMessage = `Gemini API error (${geminiResponse.status}): ${parsedError.error?.message || geminiResponse.statusText}`;
        } catch {
          if (errorBody) errorMessage += ` - ${errorBody}`;
        }
        throw new Error(errorMessage);
      }

      const geminiData = await geminiResponse.json();
      const content = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      result = { content };
      usage = geminiData.usageMetadata;
    } else {
      throw new Error(`Backend AI provider is not implemented: ${provider}`);
    }

    // Telemetry (Simplified)
    const durationMs = Date.now() - startTime;
    console.log(`[AI] ${provider} took ${durationMs}ms`);
    recordAIEnrichment(provider, targetModel || 'unknown', durationMs, true, usage?.totalTokens || usage?.total_tokens);

    return result;
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error(`AI provider ${provider} error:`, error);
    recordAIEnrichment(provider, targetModel || 'unknown', durationMs, false);
    throw error;
  }
}

/**
 * Audit result quality to decide if escalation is needed.
 */
function isQualitySufficient(data: any, type: 'discovery' | 'enrichment'): boolean {
  if (!data) return false;

  // For discovery, we need at least a name and a source URL
  if (type === 'discovery') {
    if (Array.isArray(data)) {
      return data.length > 0 && data.every(item => item.name_en || item.name_ar);
    }
  }

  // For enrichment, check for depth and critical fields
  if (type === 'enrichment') {
    const criticalFields = ['name_en', 'description_en', 'categories'];
    const filledCount = criticalFields.filter(f => {
      const val = data[f];
      return val && (Array.isArray(val) ? val.length > 0 : String(val).length > 10);
    }).length;
    
    // If we have less than 2 critical fields properly filled, quality is low
    return filledCount >= 2;
  }

  return true;
}

/**
 * Hybrid Caller: Tries Cheap (Flash) first, escalates to Premium (Pro) on failure.
 */
export async function callProviderHybrid(
  provider: AIProvider, 
  prompt: string, 
  instructions: string, 
  workload: WorkloadType = 'enrichment',
  media?: { mimeType: string; data: string }[]
) {
  const baseConfig = getProvider(provider);
  if (!baseConfig) throw new Error(`Unsupported AI provider: ${provider}`);

  // Tier 1: Try Cheap Model (research treated as enrichment-quality)
  const isDiscovery = workload === 'discovery';
  console.log(`[AI Hybrid] Tier 1 Attempt (${baseConfig.discoveryModel}) for ${workload}`);
  const tier1Result = await callProvider(provider, prompt, instructions, baseConfig.discoveryModel, media);
  const parsed = safeJsonParse(tier1Result.content, isDiscovery ? [] : null);

  if (isQualitySufficient(parsed, isDiscovery ? 'discovery' : 'enrichment')) {
    console.log(`[AI Hybrid] Tier 1 Sufficient. Moving on.`);
    return { ...tier1Result, tier: 'cheap' };
  }

  // Tier 2: Escalate to Premium Model
  // Budget Protection: Skip premium escalation if token limit exceeded
  const DAILY_TOKEN_LIMIT = 5000000; // 5M tokens per provider/day
  const currentUsage = getAITokenUsage(provider);
  
  if (currentUsage > DAILY_TOKEN_LIMIT) {
    console.warn(`[AI Hybrid] Tier 2 SKIPPED for ${provider} — Daily Budget Exceeded (${currentUsage} tokens)`);
    return { ...tier1Result, tier: 'cheap-limit-enforced' };
  }

  console.log(`[AI Hybrid] Tier 1 Quality Low. Escalating to Tier 2 (${baseConfig.enrichmentModel})...`);
  const tier2Result = await callProvider(provider, prompt, instructions, baseConfig.enrichmentModel, media);
  return { ...tier2Result, tier: 'premium' };
}

/**
 * Throws a combined diagnostic error only when all providers are exhausted.
 */
export async function callProviderWithFallback(
  preferredProvider: AIProvider | undefined,
  prompt: string,
  instructions: string,
  workload: WorkloadType = 'discovery',
  media?: { mimeType: string; data: string }[]
): Promise<{ content: string; usage?: any; tier?: string; provider: string }> {
  const chain = FALLBACK_CHAINS[workload];

  // Build ordered list: preferred first (if in chain), then rest of chain
  const orderedProviders: AIProvider[] = [];
  if (preferredProvider && chain.includes(preferredProvider)) {
    orderedProviders.push(preferredProvider);
  }
  for (const p of chain) {
    if (!orderedProviders.includes(p)) orderedProviders.push(p);
  }

  const backendProviders = orderedProviders.filter((p) => {
    if (p === 'webllm') {
      console.log('[AI Fallback] Skipping webllm — browser-only provider is not available in backend jobs');
      return false;
    }
    return true;
  });

  const errors: string[] = [];

  for (const p of backendProviders) {
    // Skip disabled providers (missing API key or explicitly disabled)
    if (!isProviderEnabled(p)) {
      console.log(`[AI Fallback] Skipping ${p} — disabled or not configured`);
      continue;
    }

    try {
      console.log(`[AI Fallback] Attempting provider: ${p} (workload: ${workload})`);
      const result = await callProviderHybrid(p, prompt, instructions, workload, media);

      // Treat empty content as a soft failure — try next provider
      const parsed = safeJsonParse(result.content, null);
      const isEmpty =
        parsed === null ||
        (Array.isArray(parsed) && parsed.length === 0) ||
        (typeof parsed === 'object' && Object.keys(parsed).length === 0);

      if (isEmpty) {
        console.warn(`[AI Fallback] Provider ${p} returned empty result — trying next`);
        errors.push(`${p}: empty result`);
        continue;
      }

      console.log(`[AI Fallback] Provider ${p} succeeded`);
      return { ...result, provider: p };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn(`[AI Fallback] Provider ${p} failed: ${msg}`);
      errors.push(`${p}: ${msg}`);
    }
  }

  if (errors.length === 0) {
    throw new Error(
      `[AI Fallback] No enabled backend providers were available for workload "${workload}".`
    );
  }

  throw new Error(
    `[AI Fallback] All providers exhausted for workload "${workload}". Errors:\n${errors.join('\n')}`
  );
}

// Extraction Helpers with Hybrid Escalation
export async function ai_classifyCompany(company: any, provider: AIProvider) {
  const evidence = [company.name_en, company.description_en, company.scope_en].filter(Boolean).join('\n');
  const prompt = `Classify this Saudi company into these categories: ${ENRICHMENT_TAXONOMY.join(', ')}\n\nEvidence:\n${evidence}`;
  
  const result = await callProviderWithFallback(provider, prompt, "SIMPLE_CLASSIFICATION: Return JSON with 'categories', 'primary_category', 'confidence', 'reasoning'.", 'enrichment');
  const parsed = safeJsonParse(result.content, { categories: [], primary_category: null, confidence: 0, reasoning: "Failed" });
  const { score, clamped } = validator.sanitizeConfidenceWithReport(parsed.confidence, `ai_classifyCompany.confidence.${result.provider}`);
  parsed.confidence = score;

  return { ...parsed, was_clamped: clamped };
}

export async function ai_normalizeCompany(company: any, provider: AIProvider) {
  const evidence = [company.description_en, company.scope_en].filter(Boolean).join('\n');
  const prompt = `Extract products/services from: ${evidence}`;
  
  const result = await callProviderWithFallback(provider, prompt, "SIMPLE_NORMALIZATION: Return JSON with 'products', 'services', 'scope_summary_en', 'scope_summary_ar', 'tags'.", 'enrichment');
  return safeJsonParse(result.content, { products: [], services: [], scope_summary_en: "", scope_summary_ar: "", tags: [] });
}

export async function ai_detectBrands(company: any, provider: AIProvider) {
  const evidence = [company.description_en, company.scope_en].filter(Boolean).join('\n');
  const prompt = `Detect brand relationships from: ${evidence}`;
  
  // Brand detection intentionally stays on the premium single-provider path.
  // Cheap models fail at inferring Relationship Type — no cross-provider fallback here.
  const baseConfig = getProvider(provider);
  const result = await callProvider(provider, prompt, "COMPLEX_EXTRACTION: Return JSON with 'brand_relationships' (brand, relationship, confidence, evidence).", baseConfig?.enrichmentModel);
  return safeJsonParse(result.content, { brand_relationships: [], raw_brands_detected: [] });
}

export function ai_scoreCompleteness(company: any): any {
  const s = (v: any): number => {
    if (v == null) return 0;
    if (Array.isArray(v)) return v.length > 0 ? 1 : 0;
    if (typeof v === 'string') return v.trim().length > 0 ? 1 : 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return 1;
  };

  const contact = (s(company.email) + s(company.phone) + s(company.website_url) + s(company.linkedin_url) + s(company.whatsapp)) / 5;
  const service = (s(company.products) * 2 + s(company.categories) * 2 + s(company.description_en) + s(company.scope_en)) / 6;
  const brand = s(company.brands);
  const social = (s(company.linkedin_url) + s(company.instagram_url) + s(company.twitter_url) + s(company.facebook_url)) / 4;
  const location = (s(company.full_address) + s(company.city_id) + s(company.region_id)) / 3;
  const evidence = (s(company.logo_url) + s(company.is_verified) + s(company.source_url)) / 3;
  const bilingual = (s(company.name_ar) + s(company.description_ar) + s(company.seo_title_ar)) / 3;
  const overall = (contact + service + brand + social + location + evidence + bilingual) / 7;

  const recommendations: string[] = [];
  if (contact < 0.4) recommendations.push('Add contact details');
  if (service < 0.4) recommendations.push('Add product/service descriptions');
  if (brand < 0.5) recommendations.push('Add represented brands');
  if (location < 0.5) recommendations.push('Complete location fields');
  if (bilingual < 0.5) recommendations.push('Add Arabic translations');

  return {
    scores: {
      contact: Math.round(contact * 100),
      service: Math.round(service * 100),
      brand: Math.round(brand * 100),
      social: Math.round(social * 100),
      location: Math.round(location * 100),
      evidence: Math.round(evidence * 100),
      bilingual: Math.round(bilingual * 100),
      overall: Math.round(overall * 100),
    },
    grade: overall >= 0.8 ? 'A' : overall >= 0.6 ? 'B' : overall >= 0.4 ? 'C' : 'D',
    recommendations,
  };
}

export async function ai_translateTechnical(text: string, toLang: 'ar' | 'en', provider: AIProvider) {
  const instructions = toLang === 'ar' 
    ? "TECHNICAL_TRANSLATOR_AR: Translate industrial/B2B content from English to Professional Arabic. Use formal Saudi business terminology. Preserve technical specs, units, and brand names in English where appropriate. Return clean string."
    : "TECHNICAL_TRANSLATOR_EN: Translate industrial/B2B content from Arabic to Professional English. Use standard international business terminology. Preserve technical specs and units. Return clean string.";
    
  const result = await callProviderWithFallback(provider, text, instructions, 'enrichment');
  return result.content.trim();
}

export async function ai_summarizeEvidence(company: any, summaryType: string, provider: AIProvider) {
  const content = Array.isArray(company.pages) 
    ? company.pages.map((p: any) => p.content).join('\n\n---\n\n').substring(0, 15000)
    : JSON.stringify(company).substring(0, 15000);
    
  const prompt = `Consolidate this content into a ${summaryType} factual summary about the company.\n\nContent:\n${content}`;
  
  const result = await callProviderWithFallback(provider, prompt, "CONSOLIDATION_MODE: Return clean, factual JSON with 'summary_en', 'summary_ar', 'key_facts_en' (array). Ensure 'summary_ar' uses formal Saudi business Arabic.", 'enrichment');
  return safeJsonParse(result.content, { summary_en: "", summary_ar: "", key_facts_en: [] });
}

export async function ai_improveProfile(company: any, provider: AIProvider) {
  const prompt = `Critique and improve this company profile for B2B searchability.

Company: ${JSON.stringify(company)}`;

  const result = await callProviderWithFallback(
    provider,
    prompt,
    "IMPROVE_PROFILE_MODE: Return JSON with 'improved_description_en', 'improved_description_ar', 'seo_keywords', 'business_model_clarification'. Ensure descriptions are professionally translated.",
    'enrichment'
  );
  
  return safeJsonParse(result.content, { 
    improved_description_en: "", 
    improved_description_ar: "", 
    seo_keywords: [], 
    business_model_clarification: "" 
  });
}

export async function ai_mergeCompanies(master: any, duplicate: any, provider: AIProvider) {
  const data = JSON.stringify({
    master: { name: master.name_en, desc: master.description_en },
    duplicate: { name: duplicate.name_en, desc: duplicate.description_en }
  });
  const prompt = `Determine if these two records refer to the same company. If yes, specify how to merge them.\n\nData:\n${data}`;
  
  const result = await callProviderWithFallback(provider, prompt, "MERGE_MODE: Return JSON with 'isMatch' (boolean), 'merge_instructions', 'confidence' (0-1).", 'enrichment');
  const parsed = safeJsonParse(result.content, { isMatch: false, merge_instructions: "", confidence: 0 });
  const { score, clamped } = validator.sanitizeConfidenceWithReport(parsed.confidence, `ai_mergeCompanies.confidence.${result.provider}`);
  parsed.confidence = score;

  return { ...parsed, was_clamped: clamped };
}

export async function ai_suggestMissingFields(company: any, provider: AIProvider) {
  const prompt = `Identify missing or weak fields for this Saudi company profile.

Company: ${JSON.stringify(company)}`;

  const result = await callProviderWithFallback(
    provider,
    prompt,
    "SUGGEST_FIELDS_MODE: Return JSON with 'missing_fields' (array of strings), 'action_plan' (array of strings).",
    'enrichment'
  );
  
  return safeJsonParse(result.content, { 
    missing_fields: [], 
    action_plan: [] 
  });
}

/**
 * Visual Verification: Validates logos or storefronts using Vision models.
 */
export async function ai_verifyVisuals(
  companyName: string, 
  images: { mimeType: string; data: string }[], 
  provider: AIProvider
) {
  const prompt = `Verify if the following images belong to the company: "${companyName}". 
  Check for company logos, signage, or contextual evidence (e.g., industry-specific equipment).`;

  const instructions = "VISUAL_VERIFIER: Return JSON with 'match' (boolean), 'score' (0-1), 'evidence_found' (string), 'is_storefront' (boolean).";
  
  const result = await callProviderWithFallback(provider, prompt, instructions, 'enrichment', images);
  return safeJsonParse(result.content, { match: false, score: 0, evidence_found: "", is_storefront: false });
}
