import 'dotenv/config';
/**
 * Saudidex Scraper Engine Main Entry Point
 * Designed for Cloud Run Jobs batch processing.
 */

import './adapters';

import { parserRegistry } from './adapters/DirectoryParserAdapter';
import { callProviderWithFallback } from './core/enrichment';
import { validateAndCleanCompanies } from './core/extraction';
import { smartFetch } from './core/scraper';
import { runPersistedDiscovery, runPersistedEnrichment } from './core/pipeline';
import { safeJsonParse } from './core/utils';
import { harvestStructuralData } from '../lib/extractors/structural';
import type { AIProvider } from '../config/aiProviders';

async function runJob() {
  const jobType = process.env.JOB_TYPE || 'discovery';
  const targetUrl = process.env.TARGET_URL;
  const jobId = process.env.JOB_ID;
  const maxPages = Number(process.env.MAX_PAGES || 0);

  if (!targetUrl && !['reprocess', 'batch-enrich'].includes(jobType)) {
    console.error('No TARGET_URL provided for job type:', jobType);
    process.exit(1);
  }

  console.log(`[Job] Starting ${jobType} for ${targetUrl} (ID: ${jobId})`);

  try {
    const { supabaseAdmin: supabase } = await import('../lib/supabase');
    if (jobId && supabase) {
      await supabase
        .from('job_status')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', jobId);
    }

    switch (jobType) {
      case 'discovery':
        await runPersistedDiscovery({
          url: targetUrl!,
          jobId,
          maxPages: maxPages > 0 ? maxPages : 30,
        });
        break;
      case 'single-scrape':
        await handleSingleScrape(targetUrl!);
        break;
      case 'enrichment':
        await runPersistedEnrichment({
          url: targetUrl!,
          companyId: String(process.env.COMPANY_ID || ''),
          jobId,
          provider: (process.env.AI_PROVIDER || 'gemini') as AIProvider,
          maxPages: maxPages > 0 ? maxPages : 15,
        });
        break;
      default:
        console.error('Unknown job type:', jobType);
    }

    if (jobId && supabase) {
      await supabase
        .from('job_status')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId);
    }

    console.log('[Job] Finished successfully');
    process.exit(0);
  } catch (error: any) {
    console.error('[Job] Failed:', error);
    const { supabaseAdmin: supabase } = await import('../lib/supabase');
    if (jobId && supabase) {
      await supabase
        .from('job_status')
        .update({ status: 'failed', error: error.message })
        .eq('id', jobId);
    }
    process.exit(1);
  }
}

async function handleSingleScrape(url: string) {
  console.log(`[SingleScrape] Executing full discovery pipeline for: ${url}`);
  const result = await smartFetch(url);

  if (result.blocked) {
    console.error(`[SingleScrape] URL blocked by target: ${url}`);
    return;
  }

  const adapter = await parserRegistry.getAdapter(url);
  let companies: any[] = [];

  if (adapter) {
    console.log(`[SingleScrape] Using adapter: ${adapter.name}`);
    const parseRes = await adapter.parse(result.html || '', url);
    companies = parseRes.companies;
  } else {
    console.log('[SingleScrape] No adapter found. Using AI fallback...');
    const structural = result.html ? harvestStructuralData(result.html) : null;
    const structuralStr = structural ? `[METADATA FOUND]: ${JSON.stringify(structural)}\n` : '';
    const content = `URL: ${url}\n${structuralStr}\n${result.markdown}`;
    const provider = (process.env.AI_PROVIDER || 'gemini') as AIProvider;
    const aiResult = await callProviderWithFallback(
      provider,
      content,
      'Extract companies found on this page as a JSON array.',
      'discovery'
    );
    companies = safeJsonParse(aiResult.content, []);
  }

  console.log(`[SingleScrape] Extracted ${companies.length} potential companies.`);
  const validated = await validateAndCleanCompanies(companies);
  console.log(`[SingleScrape] ${validated.length} companies passed validation.`);

  for (const company of validated) {
    console.log(` -> Found: ${company.name_en || company.name_ar} (${company.website_url || 'No URL'})`);
  }
}

runJob();
