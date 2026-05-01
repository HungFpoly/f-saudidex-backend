import '../adapters';

import { parserRegistry } from '../adapters/DirectoryParserAdapter';
import { advancedScrape } from './scraper';
import {
  callProviderWithFallback,
  ai_verifyVisuals,
} from './enrichment';
import { validateAndCleanCompanies, classifyPage, prioritizePages, extractVisuals } from './extraction';
import { safeJsonParse } from './utils';
import { downloadImageAsBase64 } from './visuals';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import { validator } from '../../lib/validator';
import {
  storeFieldEvidence,
  storeRawHtml,
  ensureScrapeSource,
  createScrapeRun,
  finalizeScrapeRun,
  logScrapeError,
  storeSourcePages,
  syncCompanyContacts,
  type SourcePageEvidenceRef,
} from '../../lib/dataLayer';
import { harvestStructuralData } from '../../lib/extractors/structural';
import { normalizeForMatch } from '../../lib/companyNormalization';
import { canonicalizeUrl } from '../../lib/urlCanonicalizer';
import type { AIProvider } from '../../config/aiProviders';
import type { ScrapedPageResult } from './scraper';

function getSourceDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function computeScrapeStatus(company: Record<string, any>): 'success' | 'partial' | 'failed_parse' {
  const hasName = !!(company.name_en || company.name_ar);
  const hasSupportingField = !!(company.website_url || company.phone || company.email || company.logo_url);
  if (!hasName) return 'failed_parse';
  return hasSupportingField ? 'success' : 'partial';
}

function computeDataQualityScore(company: Record<string, any>): number {
  const fields = [
    company.name_en || company.name_ar,
    company.website_url,
    company.phone,
    company.email,
    company.logo_url,
    company.description_en || company.description_ar,
  ];
  const populated = fields.filter(Boolean).length;
  return Number((populated / fields.length).toFixed(2));
}

function buildCompanyRawJson(company: Record<string, any>, page?: ScrapedPageResult | null) {
  return {
    extracted_fields: company,
    source_page: page ? {
      url: page.url,
      fetch_method: page.fetch_method || null,
      response_code: page.response_code || null,
      captured_network_json: page.network_json || [],
    } : null,
    captured_at: new Date().toISOString(),
  };
}

function normalizeComparableUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = String(url).trim();
  return canonicalizeUrl(trimmed) || trimmed.toLowerCase();
}

function getCompanyIdentityKey(company: Record<string, any>, fallbackSourceUrl: string): string {
  const websiteKey = normalizeComparableUrl(company.website_url);
  if (websiteKey) return `website:${websiteKey}`;

  const nameKey = normalizeForMatch(company.name_en || company.name_ar);
  const sourceKey = normalizeComparableUrl(company.source_url || fallbackSourceUrl);
  if (nameKey) return `name:${nameKey}|source:${sourceKey}`;

  return sourceKey ? `source:${sourceKey}` : '';
}

function findExistingRecord(
  company: Record<string, any>,
  fallbackSourceUrl: string,
  existingByWebsite: Map<string, any>,
  existingBySource: Map<string, any>,
  existingByName: Map<string, any>,
) {
  const websiteKey = normalizeComparableUrl(company.website_url);
  if (websiteKey && existingByWebsite.has(websiteKey)) {
    return existingByWebsite.get(websiteKey);
  }

  const sourceKey = normalizeComparableUrl(company.source_url || fallbackSourceUrl);
  const nameKey = normalizeForMatch(company.name_en || company.name_ar);

  if (sourceKey && nameKey) {
    const sourceMatch = existingBySource.get(sourceKey);
    if (sourceMatch && normalizeForMatch(sourceMatch.name_en || sourceMatch.name_ar) === nameKey) {
      return sourceMatch;
    }
  }

  if (nameKey && existingByName.has(nameKey)) {
    return existingByName.get(nameKey);
  }

  if (!nameKey && sourceKey && existingBySource.has(sourceKey)) {
    return existingBySource.get(sourceKey);
  }

  return null;
}

function buildEvidenceRefs(
  pages: ScrapedPageResult[],
  storedPages: Array<{ id: string; url: string; canonical_url?: string | null }>
): SourcePageEvidenceRef[] {
  const storedByUrl = new Map<string, { id: string; url: string; canonical_url?: string | null }>();
  for (const row of storedPages) {
    const key = normalizeComparableUrl(row.canonical_url || row.url);
    if (key && !storedByUrl.has(key)) {
      storedByUrl.set(key, row);
    }
  }

  return pages.map((page) => {
    const stored = storedByUrl.get(normalizeComparableUrl(page.url));
    return {
      id: stored?.id ?? null,
      url: page.url,
      canonical_url: stored?.canonical_url || page.url,
      html: page.html || null,
      text_content: page.content || null,
      page_type: page.page_type || null,
    };
  });
}

async function startScrapeTracking(targetUrl: string, kind: string) {
  if (!supabase) return { sourceId: null, runId: null };
  const sourceId = await ensureScrapeSource(targetUrl, `${kind}:${getSourceDomain(targetUrl) || targetUrl}`, kind);
  const runId = await createScrapeRun(sourceId);
  return { sourceId, runId };
}

export interface PersistedDiscoveryCompany {
  id: string;
  name_en: string | null;
  website_url: string | null;
  source_url: string;
  action: 'created' | 'updated';
}

export interface PersistedDiscoveryResult {
  status: 'completed' | 'partial' | 'failed' | 'blocked';
  blocked: boolean;
  totalPages: number;
  savedCount: number;
  failedCount: number;
  companies: PersistedDiscoveryCompany[];
  autoEnrich: {
    requested: number;
    completed: number;
    failed: number;
  };
}

export async function runPersistedDiscovery(options: {
  url: string;
  jobId?: string | null;
  maxPages?: number;
  autoEnrich?: boolean;
  enrichmentProvider?: AIProvider;
}): Promise<PersistedDiscoveryResult> {
  const {
    url,
    jobId = null,
    maxPages = 30,
    autoEnrich = false,
    enrichmentProvider = 'gemini',
  } = options;
  const tracking = await startScrapeTracking(url, 'discovery');

  try {
    const { results, blocked } = await advancedScrape(url, maxPages);

    if (results) {
      results.forEach((page) => {
        page.page_type = classifyPage(page.url, url).pageType;
      });
    }

    const totalPages = results?.length || 0;
    if (!results || results.length === 0) {
      await logScrapeError({
        runId: tracking.runId,
        sourceUrl: url,
        errorType: blocked ? 'blocked' : 'failed_request',
        errorMessage: blocked ? 'Target blocked the request or robots policy denied access.' : 'No pages were returned by the scrape pipeline.',
      });
      await finalizeScrapeRun(tracking.runId, {
        status: blocked ? 'blocked' : 'failed',
        total_pages: 0,
        total_success: 0,
        total_failed: 1,
        error_message: blocked ? 'Blocked' : 'No results found',
      });
      return {
        status: blocked ? 'blocked' : 'failed',
        blocked,
        totalPages: 0,
        savedCount: 0,
        failedCount: 1,
        companies: [],
        autoEnrich: { requested: 0, completed: 0, failed: 0 },
      };
    }

    await storeSourcePages(results, {
      crawlJobId: tracking.runId || jobId,
      seedId: url,
      defaultStatus: 'parsed',
    });

    const allFoundCompanies: any[] = [];
    const pagesWithoutAdapters: typeof results = [];

    for (const page of results) {
      const adapter = await parserRegistry.getAdapter(page.url);
      if (adapter) {
        try {
          const parseResult = await adapter.parse(page.html || page.content, page.url);
          if (parseResult.companies.length > 0) {
            allFoundCompanies.push(...parseResult.companies);
            continue;
          }
        } catch (err) {
          console.error(`[Discovery] Adapter ${adapter.id} failed:`, err);
        }
      }
      pagesWithoutAdapters.push(page);
    }

    if (pagesWithoutAdapters.length > 0) {
      const provider = enrichmentProvider;
      const chunkSize = 5;

      for (let i = 0; i < pagesWithoutAdapters.length; i += chunkSize) {
        const chunk = pagesWithoutAdapters.slice(i, i + chunkSize);
        const structuralBaselines = chunk.map((page) => ({
          url: page.url,
          baseline: page.html ? harvestStructuralData(page.html) : null,
        }));

        const combinedContent = chunk.map((page, idx) => {
          const structuralStr = structuralBaselines[idx].baseline
            ? `[METADATA FOUND]: ${JSON.stringify(structuralBaselines[idx].baseline)}\n`
            : '';
          return `URL: ${page.url}\n${structuralStr}\n${page.content}`;
        }).join('\n\n---\n\n');

        try {
          const aiResult = await callProviderWithFallback(
            provider,
            combinedContent,
            'Extract companies as JSON array with visuals.',
            'discovery'
          );
          const parsed = safeJsonParse(aiResult.content, []);
          if (Array.isArray(parsed)) {
            allFoundCompanies.push(...parsed);
          }
        } catch (err: any) {
          await logScrapeError({
            runId: tracking.runId,
            sourceUrl: url,
            errorType: 'failed_parse',
            errorMessage: err?.message || `AI fallback failed for chunk ${i}`,
          });
        }
      }
    }

    const validated = await validateAndCleanCompanies(allFoundCompanies);
    if (!supabase) {
      await finalizeScrapeRun(tracking.runId, {
        status: 'failed',
        total_pages: totalPages,
        total_success: 0,
        total_failed: validated.length || 1,
        error_message: 'Supabase admin client is not configured.',
      });
      throw new Error('Supabase admin client is not configured.');
    }

    const uniqueValidated: any[] = [];
    const internalSeen = new Set<string>();
    for (const company of validated) {
      const identityKey = getCompanyIdentityKey(company, url);
      if (identityKey && !internalSeen.has(identityKey)) {
        uniqueValidated.push(company);
        internalSeen.add(identityKey);
      }
    }

    const { data: existingRows } = await supabase
      .from('companies')
      .select('id, name_en, name_ar, source_url, website_url, first_seen_at');

    const existingByName = new Map<string, any>(
      (existingRows || [])
        .map((row) => [normalizeForMatch(row.name_en || row.name_ar), row] as const)
        .filter(([key]) => !!key)
    );
    const existingBySource = new Map<string, any>(
      (existingRows || [])
        .filter((row) => !!row.source_url)
        .map((row) => [normalizeComparableUrl(String(row.source_url)), row] as const)
    );
    const existingByWebsite = new Map<string, any>(
      (existingRows || [])
        .filter((row) => !!row.website_url)
        .map((row) => [normalizeComparableUrl(String(row.website_url)), row] as const)
    );

    const newCompanies = uniqueValidated.filter((company) => {
      const existingRecord = findExistingRecord(company, url, existingByWebsite, existingBySource, existingByName);
      return !existingRecord;
    });

    let nextIds: number[] = [];
    if (newCompanies.length > 0) {
      const { data: startId, error: seqErr } = await supabase.rpc('get_next_company_ids', { count: newCompanies.length });
      if (seqErr) {
        console.error('[Discovery] Failed to reserve IDs:', seqErr.message);
      } else {
        nextIds = Array.from({ length: newCompanies.length }, (_, idx) => (startId as number) + idx);
      }
    }

    const companies: PersistedDiscoveryCompany[] = [];
    let savedCount = 0;
    let failedCount = 0;
    let newIdx = 0;

    for (const company of uniqueValidated) {
      const sourceUrl = String(company.source_url || url).trim();
      const normalizedSourceUrl = normalizeComparableUrl(sourceUrl);
      const matchKey = normalizeForMatch(company.name_en || company.name_ar);
      const websiteUrl = typeof company.website_url === 'string' ? company.website_url.trim() : null;
      const existingRecord = findExistingRecord(company, url, existingByWebsite, existingBySource, existingByName);
      const matchedPage = results.find((page) => normalizeComparableUrl(page.url) === normalizedSourceUrl) || results[0];
      const now = new Date().toISOString();

      try {
        const payload: any = {
          name_en: company.name_en || company.name_ar,
          name_ar: company.name_ar,
          website_url: websiteUrl,
          logo_url: company.logo_url,
          cover_image_url: company.header_url,
          source_url: sourceUrl,
          source_domain: getSourceDomain(sourceUrl),
          source_links: Array.from(new Set(results.map((page) => page.url))).slice(0, 20),
          raw_text: matchedPage?.content?.slice(0, 20000) || null,
          raw_json: buildCompanyRawJson(company, matchedPage),
          scrape_status: computeScrapeStatus(company),
          data_quality_score: computeDataQualityScore(company),
          last_scraped_at: now,
          last_seen_at: now,
          first_seen_at: existingRecord?.first_seen_at || now,
        };

        if (existingRecord?.id) {
          payload.id = existingRecord.id;
        } else if (nextIds[newIdx]) {
          payload.id = String(nextIds[newIdx++]);
        }

        if (!payload.id) {
          failedCount++;
          await logScrapeError({
            runId: tracking.runId,
            sourceUrl,
            errorType: 'failed_parse',
            errorMessage: `Unable to allocate company id for ${payload.name_en || payload.name_ar || sourceUrl}`,
            htmlSnapshot: matchedPage?.html || null,
          });
          continue;
        }

        const { error } = await supabase.from('companies').upsert(payload, { onConflict: 'id' });
        if (error) {
          failedCount++;
          await logScrapeError({
            runId: tracking.runId,
            sourceUrl,
            errorType: 'db_upsert',
            errorMessage: error.message,
            htmlSnapshot: matchedPage?.html || null,
          });
          continue;
        }

        savedCount++;
        await syncCompanyContacts(payload.id, payload, sourceUrl);

        if (websiteUrl) {
          existingByWebsite.set(normalizeComparableUrl(websiteUrl), { ...payload, name_ar: payload.name_ar });
        }
        if (sourceUrl) {
          existingBySource.set(normalizeComparableUrl(sourceUrl), { ...payload, name_ar: payload.name_ar });
        }
        if (matchKey) {
          existingByName.set(matchKey, { ...payload, name_ar: payload.name_ar });
        }

        companies.push({
          id: String(payload.id),
          name_en: payload.name_en || null,
          website_url: payload.website_url || null,
          source_url: payload.source_url,
          action: existingRecord?.id ? 'updated' : 'created',
        });
      } catch (err: any) {
        failedCount++;
        await logScrapeError({
          runId: tracking.runId,
          sourceUrl,
          errorType: 'exception',
          errorMessage: err.message,
          htmlSnapshot: matchedPage?.html || null,
        });
      }
    }

    await finalizeScrapeRun(tracking.runId, {
      status: failedCount > 0 ? 'partial' : 'completed',
      total_pages: totalPages,
      total_success: savedCount,
      total_failed: failedCount,
    });

    const autoEnrichStatus = {
      requested: 0,
      completed: 0,
      failed: 0,
    };

    if (autoEnrich) {
      for (const company of companies) {
        if (!company.website_url) continue;
        autoEnrichStatus.requested++;
        try {
          const enrichment = await runPersistedEnrichment({
            url: company.website_url,
            companyId: company.id,
            jobId,
            provider: enrichmentProvider,
          });
          if (enrichment.status === 'completed' && enrichment.updated) {
            autoEnrichStatus.completed++;
          } else {
            autoEnrichStatus.failed++;
          }
        } catch (error) {
          autoEnrichStatus.failed++;
        }
      }
    }

    return {
      status: failedCount > 0 ? 'partial' : 'completed',
      blocked: false,
      totalPages,
      savedCount,
      failedCount,
      companies,
      autoEnrich: autoEnrichStatus,
    };
  } catch (error: any) {
    await logScrapeError({
      runId: tracking.runId,
      sourceUrl: url,
      errorType: 'exception',
      errorMessage: error.message,
    });
    await finalizeScrapeRun(tracking.runId, {
      status: 'failed',
      total_pages: 0,
      total_success: 0,
      total_failed: 1,
      error_message: error.message,
    });
    throw error;
  }
}

export interface PersistedEnrichmentResult {
  status: 'completed' | 'failed' | 'blocked';
  blocked: boolean;
  companyId: string;
  updated: boolean;
  wasClamped: boolean;
  payload: Record<string, unknown> | null;
}

export async function runPersistedEnrichment(options: {
  url: string;
  companyId: string;
  jobId?: string | null;
  provider?: AIProvider;
  maxPages?: number;
}): Promise<PersistedEnrichmentResult> {
  const {
    url,
    companyId,
    jobId = null,
    provider = 'gemini',
    maxPages = 15,
  } = options;
  if (!url || !companyId) {
    throw new Error('Missing url or companyId for enrichment run.');
  }
  const tracking = await startScrapeTracking(url, 'enrichment');

  try {
    const { results: allPages, blocked } = await advancedScrape(url, maxPages);
    allPages.forEach((page) => {
      page.page_type = classifyPage(page.url, url).pageType;
    });

    if (!allPages.length) {
      await logScrapeError({
        runId: tracking.runId,
        sourceUrl: url,
        errorType: blocked ? 'blocked' : 'failed_request',
        errorMessage: blocked ? 'Target blocked the request or robots policy denied access.' : 'No pages found during enrichment scrape.',
      });
      await finalizeScrapeRun(tracking.runId, {
        status: blocked ? 'blocked' : 'failed',
        total_pages: 0,
        total_success: 0,
        total_failed: 1,
        error_message: blocked ? 'Blocked' : 'No pages found',
      });
      return {
        status: blocked ? 'blocked' : 'failed',
        blocked,
        companyId,
        updated: false,
        wasClamped: false,
        payload: null,
      };
    }

    const prioritized = prioritizePages(allPages.map((page) => page.url), url, Math.min(maxPages, 6));
    const finalPages = allPages.filter((page) => prioritized.some((entry) => entry.url === page.url));
    const storedPages = await storeSourcePages(finalPages, {
      crawlJobId: tracking.runId || jobId,
      seedId: url,
      defaultStatus: 'parsed',
    });
    const evidenceRefs = buildEvidenceRefs(finalPages, storedPages);

    const combinedContent = finalPages
      .map((page) => `[${classifyPage(page.url, url).pageType.toUpperCase()}] ${page.url}\n\n${page.content}`)
      .join('\n\n---\n\n');

    const structuralBaseline = finalPages
      .map((page) => page.html ? harvestStructuralData(page.html) : null)
      .filter(Boolean);

    const enrichmentPrompt = `Extract company details from these pages: \n${combinedContent}
    
    [STRUCTURAL METADATA BASELINE (HIGH CONFIDENCE)]:
    ${JSON.stringify(structuralBaseline, null, 2)}
    `;
    const instructions = `Return a JSON object with:
    1. All company details (name, description, contact, etc).
    2. A 'field_evidence' object mapping each field name to the EXACT snippet of text or HTML from the source where the information was found.
    3. A 'field_confidence' object mapping each field name to a 0.0-1.0 score.
    
    ALWAYS prioritize [STRUCTURAL METADATA BASELINE] for field accuracy.`;

    const result = await callProviderWithFallback(provider, enrichmentPrompt, instructions, 'enrichment');
    const parsed = safeJsonParse(result.content, null);
    const sanitizedParsedResult =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? validator.sanitizeCompanyConfidencePayload(parsed as Record<string, unknown>)
        : null;
    const sanitizedParsed = sanitizedParsedResult?.sanitized ?? null;
    const wasClamped = sanitizedParsedResult?.clamped ?? false;

    if (!sanitizedParsed || !supabase) {
      await finalizeScrapeRun(tracking.runId, {
        status: 'failed',
        total_pages: finalPages.length,
        total_success: 0,
        total_failed: 1,
        error_message: !supabase ? 'Supabase admin client is not configured.' : 'AI returned an invalid enrichment payload.',
      });
      return {
        status: 'failed',
        blocked: false,
        companyId,
        updated: false,
        wasClamped,
        payload: null,
      };
    }

    if (structuralBaseline.length > 0) {
      const best = structuralBaseline[0];
      if (best.name) sanitizedParsed.name_en = best.name;
      if (best.legalName) sanitizedParsed.name_en = best.legalName;
      if (best.description && (!sanitizedParsed.description_en || String(sanitizedParsed.description_en).length < 50)) {
        sanitizedParsed.description_en = best.description;
      }
      if (best.phone && best.phone.length > 0 && !sanitizedParsed.phone) sanitizedParsed.phone = best.phone[0];
      if (best.crNumber) sanitizedParsed.cr_number = best.crNumber;
    }

    let bestLogo: string | null = typeof sanitizedParsed.logo_url === 'string' ? sanitizedParsed.logo_url : null;
    let bestHeader: string | null = typeof sanitizedParsed.cover_image_url === 'string' ? sanitizedParsed.cover_image_url : null;

    for (const page of finalPages) {
      if (!page.html) continue;
      const visuals = extractVisuals(page.html, url);
      if (visuals.logo && !bestLogo) bestLogo = visuals.logo;
      if (visuals.header && !bestHeader) bestHeader = visuals.header;
    }

    if (bestLogo && provider === 'gemini') {
      const imgData = await downloadImageAsBase64(bestLogo);
      if (imgData) {
        try {
          const verify = await ai_verifyVisuals(String(sanitizedParsed.name_en || ''), [imgData], provider);
          if (!verify.match) {
            bestLogo = null;
          }
        } catch (err) {
          console.error('[Enrichment] Visual verification error:', err);
        }
      }
    }

    sanitizedParsed.logo_url = bestLogo;
    sanitizedParsed.cover_image_url = bestHeader;

    const capturedNetworkJson = finalPages.flatMap((page) => page.network_json || []).slice(0, 20);
    const companyUpdate = validator.sanitizeCompanyPersistencePayload({
      ...sanitizedParsed,
      source_url: url,
      source_domain: getSourceDomain(url),
      raw_text: combinedContent.slice(0, 20000),
      raw_json: {
        structural_baseline: structuralBaseline,
        source_pages: finalPages.map((page) => ({
          url: page.url,
          response_code: page.response_code || null,
          fetch_method: page.fetch_method || null,
        })),
        captured_network_json: capturedNetworkJson,
      },
      scrape_status: computeScrapeStatus(sanitizedParsed),
      data_quality_score: computeDataQualityScore(sanitizedParsed),
      last_seen_at: new Date().toISOString(),
      last_enriched_at: new Date().toISOString(),
    });

    const { error } = await supabase.from('companies').update(companyUpdate).eq('id', companyId);
    if (error) throw error;

    await storeFieldEvidence(companyId, {
      ...sanitizedParsed,
      field_evidence: sanitizedParsed.field_evidence || {},
    }, evidenceRefs);
    await storeRawHtml(companyId, finalPages.map((page) => ({
      url: page.url,
      html: page.html || '',
      page_type: classifyPage(page.url, url).pageType,
    })));
    await syncCompanyContacts(companyId, companyUpdate, url);

    await finalizeScrapeRun(tracking.runId, {
      status: 'completed',
      total_pages: finalPages.length,
      total_success: 1,
      total_failed: 0,
    });

    return {
      status: 'completed',
      blocked: false,
      companyId,
      updated: true,
      wasClamped,
      payload: {
        ...sanitizedParsed,
        ...companyUpdate,
      },
    };
  } catch (error: any) {
    await logScrapeError({
      runId: tracking.runId,
      sourceUrl: url,
      errorType: 'exception',
      errorMessage: error.message,
    });
    await finalizeScrapeRun(tracking.runId, {
      status: 'failed',
      total_pages: 0,
      total_success: 0,
      total_failed: 1,
      error_message: error.message,
    });
    throw error;
  }
}
