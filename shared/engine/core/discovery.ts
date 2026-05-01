import { isAIEnabled } from "@/config/runtime";
import { advancedScrape, smartFetch } from "@/engine/core/scraper";
import { callProviderWithFallback } from "@/engine/core/enrichment";
import { validateAndCleanCompanies } from "@/engine/core/extraction";
import { safeJsonParse } from "@/engine/core/utils";
import { parserRegistry } from "@/engine/adapters/DirectoryParserAdapter";
import { trackAdapterUsage } from "@/lib/observability";
import "@/engine/adapters"; // Ensure registered
import { harvestStructuralData } from "@/lib/extractors/structural";
import { AIProvider } from "@/config/aiProviders";
import { filterValidWebsites } from "@/lib/websiteResolver";

export interface DiscoverOptions {
  provider?: string;
  baseUrl: string;
  useAdvanced?: boolean;
  maxPages?: number;
  contentOnly?: boolean;
}

export type DiscoveryResult = 
  | { content: string; url: string; logo_url: string | null; header_url?: string | null; html: string | null; blocked: boolean }
  | { data: any[]; usage: any; blocked: boolean };

export async function runDiscovery(options: DiscoverOptions): Promise<DiscoveryResult> {
  const { provider, baseUrl, useAdvanced = false, maxPages: rawMaxPages = 200, contentOnly = false } = options;
  const maxPages = Math.min(Math.max(1, rawMaxPages), 200);
  
  const aiEnabled = isAIEnabled();
  const effectiveUseAdvanced = (contentOnly || !aiEnabled) ? false : useAdvanced;
  
  let results: any[] = [];
  let blocked = false;

  if (effectiveUseAdvanced) {
    console.log(`[Discovery] Strategy: advanced-multi-page, AI Enabled: ${aiEnabled}, MaxPages: ${maxPages}`);
    const scrapeResult = await advancedScrape(baseUrl, maxPages);
    results = scrapeResult.results;
    blocked = scrapeResult.blocked;
  } else {
    console.log(`[Discovery] Strategy: simple-single-page, AI Enabled: ${aiEnabled}`);
    const page = await smartFetch(baseUrl);
    blocked = page.blocked;
    if (page.html) {
      results = [{
        url: page.url,
        html: page.html,
        content: page.markdown,
        logo_url: page.logo_url || null,
        header_url: page.header_url || null,
        tier: page.tier
      }];
    }
  }

  if (contentOnly || !aiEnabled) {
    const first = results[0];
    if (!first) return { content: "", url: baseUrl, logo_url: null, header_url: null, html: null, blocked };
    
    return {
      content: first.content,
      url: first.url,
      logo_url: (first as any).logo_url || null,
      header_url: (first as any).header_url || null,
      html: first.html,
      blocked
    };
  }
  
  const allFoundCompanies: any[] = [];
  const pagesWithoutAdapters: any[] = [];

  // Wave 1: Deterministic Adapters
  for (const page of results) {
    const adapter = await parserRegistry.getAdapter(page.url);
    if (adapter) {
      const adapterStart = Date.now();
      try {
        const parseResult = await adapter.parse(page.html || '', page.url);
        trackAdapterUsage(adapter.id || 'unknown', true, Date.now() - adapterStart);
        if (parseResult.companies.length > 0) {
          allFoundCompanies.push(...parseResult.companies);
          continue;
        }
      } catch (e) { 
        console.error(`[Discovery] Adapter failed for ${page.url}:`, e); 
        trackAdapterUsage(adapter.id || 'unknown', false, Date.now() - adapterStart);
      }
    }
    pagesWithoutAdapters.push(page);
  }

  // Wave 2: AI Fallback for remaining pages
  let usage: any = null;
  if (pagesWithoutAdapters.length > 0) {
    const combinedContent = pagesWithoutAdapters.map(d => {
        const structural = d.html ? harvestStructuralData(d.html) : null;
        const metaStr = structural ? `[METADATA]: ${JSON.stringify(structural)}\n` : '';
        return `URL: ${d.url}\n${metaStr}\n${d.content}`;
    }).join("\n\n---\n\n");

    const extractionPrompt = `Extract company details from these pages: \n${combinedContent}`;
    const instructions = "Return a JSON array of objects with keys: name_en, name_ar, website_url, phone, logo_url, header_url. CRITICAL: Only use [METADATA] for visuals if it specifically describes the company. DO NOT use the host site's logo (the directory's logo) as the company logo.";

    
    const aiResult = await callProviderWithFallback(provider as AIProvider | undefined, extractionPrompt, instructions, 'discovery');
    const aiCompanies = safeJsonParse(aiResult.content, []);
    allFoundCompanies.push(...aiCompanies);
    usage = { ...aiResult.usage, provider: aiResult.provider };
  }

  const validated = await validateAndCleanCompanies(allFoundCompanies);

  // Wave 3: Website Verification
  // Verify websites and discard parked/spam links
  console.log(`[Discovery] Verifying websites for ${validated.length} candidates...`);
  const { valid, invalid } = await filterValidWebsites(validated);
  
  if (invalid.length > 0) {
    console.log(`[Discovery] Filtered out ${invalid.length} invalid/parked websites.`);
  }

  // Return the data with verified websites
  // Ensure we merge back all extracted data (including AI-extracted descriptions, visuals, etc.)
  return { 
    data: valid.map(v => {
      const match = validated.find(c => 
        (c.name_en && c.name_en === v.name) || 
        (c.name_ar && c.name_ar === v.name)
      );
      return {
        ...(match || {}),
        name: v.name,
        website_url: v.website_url,
        logo_url: (match as any)?.logo_url || null,
        header_url: (match as any)?.header_url || null,
        is_verified: v.resolution.isValid,
        confidence: v.resolution.confidence,
        confidence_score: v.resolution.confidence,
      };
    }),
    usage, 
    blocked 
  };
}
