import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { chromium, Browser } from 'playwright-core';
import { CheerioCrawler } from '@crawlee/cheerio';
import { PlaywrightCrawler } from '@crawlee/playwright';
import { canonicalizeUrl } from "../../lib/urlCanonicalizer";
import { canFetch as canFetchRobots, getCrawlDelay as getRobotsCrawlDelay } from "../../lib/robotsPolicy";
import { waitForSlot, releaseSlot, extractDomainFromUrl } from "../../lib/rateLimiter";
import { recordFetch } from "../../lib/observability";
import { discoverVisuals } from "./visuals";

const turndownService = new TurndownService();
const browserlessToken = process.env.BROWSERLESS_TOKEN;

export interface CapturedNetworkRecord {
  url: string;
  status: number;
  contentType: string | null;
  resourceType: string;
  body: unknown;
}

export interface ScrapedPageResult {
  url: string;
  content: string;
  html: string | null;
  logo_url?: string | null;
  header_url?: string | null;
  tier?: string;
  blocked?: boolean;
  tier_info?: string;
  network_json?: CapturedNetworkRecord[];
  response_code?: number;
  response_headers?: Record<string, string>;
  fetch_method?: string;
  page_type?: string;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Smart fetch with Proxy Escalation:
 * Tier 1: Direct Link (Free)
 * Tier 2: Browser/Rendering (Medium)
 * Tier 3: Elite Proxy with JS Rendering (ScrapingBee/Scrape.do)
 *
 * Now includes robots.txt and rate-limiting compliance.
 */
export async function smartFetch(url: string, timeout = 45000): Promise<{ html: string | null; markdown: string; url: string; tier?: string; blocked: boolean; logo_url?: string | null; header_url?: string | null; tier_info?: string; requestRegionSwap?: boolean; network_json?: CapturedNetworkRecord[]; response_code?: number; response_headers?: Record<string, string>; fetch_method?: string }> {
  const fetchStart = Date.now();
  // 1. Robots.txt check
  const allowed = await canFetchRobots(url);
  if (!allowed) {
    console.log(`[Robots] Blocked by robots.txt: ${url}`);
    recordFetch(url, 'http', 403, Date.now() - fetchStart, false, true);
    return { html: null, markdown: '', url, blocked: true };
  }

  // 2. Rate-limiting check
  const domain = extractDomainFromUrl(url) || url;
  await waitForSlot(domain);

  try {
    // 3. Robots Crawl-Delay
    const delay = await getRobotsCrawlDelay(url);
    if (delay > 0) {
      await new Promise(r => setTimeout(r, delay * 1000));
    }

    const lower = url.toLowerCase();
  
  const isHighIntensity = 
    lower.includes('gov.sa') || 
    lower.includes('mcci.org.sa') || 
    lower.includes('fsc.org.sa') ||
    lower.includes('modon') ||
    lower.includes('eamana') ||
    lower.includes('chamber.org.sa') ||
    lower.includes('.aspx');

  // SharePoint and MCCI sites need extra render time — their tables/cards load via JS
  const isDynamicDirectory = lower.includes('.aspx') || lower.includes('modon') || lower.includes('gov.sa') || lower.includes('mcci.org.sa');
  const finalTimeout = isHighIntensity ? Math.max(timeout, 120000) : timeout;

  // --- TIER 1: Direct Fetch (Free) ---
  // Try direct fetch first for non-government sites
  if (!isHighIntensity) {
    try {
      console.log(`[Scraper] Tier 1 (Direct) attempt: ${url}`);
      const direct = await fetchUrlContent(url, finalTimeout);
      
      // Detection: Did we get a real page or a block/challenge?
      if (direct.html && !isBotChallenge(direct.html)) {
        recordFetch(url, 'http', 200, Date.now() - fetchStart, true);
        const { logo_url, header_url } = discoverVisuals(direct.html, url);
        return { ...direct, tier: 'tier1_direct', blocked: false, logo_url, header_url };
      }
      console.warn(`[Scraper] Tier 1 blocked or challenge detected for ${url}, escalating...`);
    } catch (e: any) {
      console.warn(`[Scraper] Tier 1 failed: ${e.message}, escalating...`);
    }
  }

  // --- TIER 2: Browser / Rendering (Medium) ---
  // Use Playwright (Local or Browserless)
  const browserlessToken = process.env.BROWSERLESS_TOKEN;
  if (isHighIntensity || browserlessToken) {
    try {
      console.log(`[Scraper] Tier 2 (Browser) attempt: ${url}`);
      const browserResult = await fetchWithBrowser(url, finalTimeout, {
        isSharePoint: isDynamicDirectory,
        dismissCookieConsent: isHighIntensity,
        extraWaitMs: isDynamicDirectory ? 8000 : 2000,
      });
      if (browserResult.html && !isBotChallenge(browserResult.html)) {
        recordFetch(url, 'browser', 200, Date.now() - fetchStart, true);
        const { logo_url, header_url } = discoverVisuals(browserResult.html, url);
        return { ...browserResult, tier: 'tier2_browser', blocked: false, logo_url, header_url };
      }
      console.warn(`[Scraper] Tier 2 blocked for ${url}, escalating to Elite...`);
    } catch (e: any) {
      console.warn(`[Scraper] Tier 2 failed: ${e.message}`);
    }
  }

  // --- TIER 3: Elite Proxy (Expensive) ---
  // Only use ScrapingBee as the final "Magic Bullet"
  const scrapingBeeKey = process.env.SCRAPINGBEE_API_KEY;
  if (scrapingBeeKey) {
    try {
      console.log(`[Scraper] Tier 3 (Elite) attempt with ScrapingBee: ${url}`);
      const result = await fetchViaScrapingBee(url, scrapingBeeKey, isHighIntensity, finalTimeout);
      recordFetch(url, 'http', 200, Date.now() - fetchStart, true);
      const { logo_url, header_url } = discoverVisuals(result.html, url);
      return { ...result, tier: 'tier3_elite', blocked: false, logo_url, header_url };
    } catch (e: any) {
      console.error(`[Scraper] ALL TIERS FAILED for ${url}: ${e.message}`);
    }
  }

    // Final fallback
    const fallback = await fetchUrlContent(url, finalTimeout);
    recordFetch(url, 'http', fallback.html ? 200 : 0, Date.now() - fetchStart, !!fallback.html);
    
    // If we are still blocked after all tiers, request a region swap
    const isStillBlocked = !fallback.html || isBotChallenge(fallback.html);
    const { logo_url, header_url } = fallback.html ? discoverVisuals(fallback.html, url) : { logo_url: null, header_url: null };
    return { ...fallback, blocked: isStillBlocked, requestRegionSwap: isStillBlocked, logo_url, header_url };
  } finally {
    releaseSlot(domain);
  }
}

/**
 * Detects common anti-bot challenge pages (Cloudflare, PerimeterX, etc.)
 */
function isBotChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    (lower.includes('cloudflare') && (lower.includes('id="challenge-running"') || lower.includes('id="cf-challenge"') || lower.includes('__cf_chl_opt'))) ||
    lower.includes('wait while we verify your browser') ||
    lower.includes('perimeterx') ||
    lower.includes('incapsula') ||
    lower.includes('distil networks') ||
    (lower.includes('captcha') && !lower.includes('recaptcha-badge')) ||
    lower.includes('<title>403 forbidden</title>') ||
    lower.includes('<title>access denied</title>') ||
    lower.includes('<title>just a moment...</title>') ||
    // Suspiciously empty — but SharePoint shells can legitimately be ~1-3KB
    // before JS injects content; only flag truly empty responses.
    html.length < 200
  );
}


async function fetchViaScrapingBee(url: string, apiKey: string, highIntensity: boolean, timeout: number) {
  const params = new URLSearchParams({
    api_key: apiKey,
    url: url,
    render_js: 'true',
    wait_browser: 'networkidle2',
    premium_proxy: highIntensity ? 'true' : 'false',
    country_code: 'sa'
  });

  const response = await fetch(`https://app.scrapingbee.com/api/v1?${params.toString()}`, { 
    signal: AbortSignal.timeout(timeout) 
  });

  if (!response.ok) throw new Error(`ScrapingBee error: ${response.statusText}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  $("script, style, iframe, noscript, svg, path").remove();
  const body = $("body").html() || "";
  const cleanedHtml = $.html();

  return {
    html: cleanedHtml.slice(0, 500000),
    markdown: turndownService.turndown(body).slice(0, 100000),
    url,
    response_code: response.status,
    response_headers: headersToRecord(response.headers),
    fetch_method: 'scrapingbee'
  };
}

interface BrowserFetchOptions {
  /** If true, wait for SharePoint content selectors before capturing HTML */
  isSharePoint?: boolean;
  /** If true, attempt to dismiss cookie consent modals */
  dismissCookieConsent?: boolean;
  /** Extra milliseconds to wait after networkidle (default 2000) */
  extraWaitMs?: number;
}

/**
 * Fetch with browser rendering (Playwright)
 *
 * Enhanced for SharePoint/gov.sa sites that render content 10-30s after initial load.
 */
export async function fetchWithBrowser(
  url: string,
  timeout = 45000,
  opts: BrowserFetchOptions = {},
): Promise<{ html: string | null; markdown: string; url: string; blocked: boolean; network_json: CapturedNetworkRecord[]; response_code?: number; response_headers?: Record<string, string>; fetch_method: string }> {
  const { isSharePoint = false, dismissCookieConsent = false, extraWaitMs = 2000 } = opts;
  let browser;
  try {
    const playwright = await import('playwright-core');
    const chromium = playwright.chromium;
    
    if (browserlessToken) {
      browser = await chromium.connectOverCDP(`wss://chrome.browserless.io?token=${browserlessToken}`);
    } else {
      browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
    }

    const page = await browser.newPage();
    const networkJson: CapturedNetworkRecord[] = [];
    page.on('response', async response => {
      try {
        const resourceType = response.request().resourceType();
        const contentType = response.headers()['content-type'] || null;
        const isJson =
          !!contentType && contentType.toLowerCase().includes('json');
        const isInterestingResource =
          resourceType === 'xhr' || resourceType === 'fetch';

        if (!isJson || !isInterestingResource || networkJson.length >= 20) {
          return;
        }

        const jsonBody = await response.json();
        networkJson.push({
          url: response.url(),
          status: response.status(),
          contentType,
          resourceType,
          body: jsonBody,
        });
      } catch {
        // Ignore non-JSON or unreadable responses.
      }
    });

    const mainResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    try {
      await page.waitForLoadState('networkidle', { timeout: isSharePoint ? 30000 : 15000 });
    } catch { }

    // Dismiss cookie consent modals that block content on gov.sa / SharePoint sites
    if (dismissCookieConsent) {
      try {
        const acceptBtn = page.locator(
          'button:has-text("Accept"), button:has-text("قبول"), ' +
          'a:has-text("Accept"), [id*="cookie"] button, ' +
          '.cc-btn.cc-allow, .cookie-accept, #onetrust-accept-btn-handler'
        ).first();
        if (await acceptBtn.isVisible({ timeout: 3000 })) {
          await acceptBtn.click();
          console.log(`[Scraper] Dismissed cookie consent on ${url}`);
          await page.waitForTimeout(1000);
        }
      } catch { /* No cookie modal — fine */ }
    }

    // For SharePoint sites, wait for dynamic content to populate
    if (isSharePoint) {
      const spSelectors = [
        'table.ms-listviewtable',
        '.ms-List-cell',
        '#DeltaPlaceHolderMain table',
        '[data-automationid="ListCell"]',
        '.ms-DetailsRow',
        '#WebPartWPQ1 table',
        'table tr td.ms-vb2',
        'table tr td.ms-vb',
      ];
      try {
        await page.waitForSelector(spSelectors.join(', '), { timeout: 25000 });
        console.log(`[Scraper] SharePoint content selector found on ${url}`);
      } catch {
        console.warn(`[Scraper] SharePoint content selectors not found within timeout on ${url}, capturing page as-is`);
      }
    }

    await page.waitForTimeout(extraWaitMs);

    const html = await page.content();
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, iframe, noscript, svg, path").remove();
    const body = $("body").html() || "";
    const markdown = turndownService.turndown(body);

    console.log(`[Scraper] Browser fetch completed for ${url}: ${html.length} bytes raw, ${markdown.length} chars markdown`);

    return {
      html: html.slice(0, 500000),
      markdown: markdown.slice(0, 100000),
      url,
      blocked: false,
      network_json: networkJson,
      response_code: mainResponse?.status(),
      response_headers: mainResponse ? mainResponse.headers() : undefined,
      fetch_method: 'browser'
    };
  } catch (error: any) {
    console.error(`Browser fetch failed for ${url}:`, error.message);
    const fallback = await fetchUrlContent(url, timeout);
    return { ...fallback, blocked: false, network_json: [], fetch_method: fallback.fetch_method || 'http' };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Static HTTP fetch and clean
 */
export async function fetchUrlContent(url: string, timeout = 30000): Promise<{ html: string | null; markdown: string; url: string; response_code?: number; response_headers?: Record<string, string>; fetch_method?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'saudidex-bot (+https://saudidex.ae/bot)'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, iframe, noscript, svg, path").remove();
    const body = $("body").html() || "";
    const markdown = turndownService.turndown(body);

    return {
      html: html.slice(0, 500000),
      markdown: markdown.slice(0, 100000),
      url: response.url,
      response_code: response.status,
      response_headers: headersToRecord(response.headers),
      fetch_method: 'http'
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Timeout (${timeout}ms) exceeded while fetching ${url}`);
    }
    throw error;
  }
}

/**
 * Advanced crawler using Crawlee (Cheerio + Playwright fallback)
 */
export async function advancedScrape(url: string, options: number | { maxPages?: number; concurrency?: number } = 20): Promise<{ results: ScrapedPageResult[]; blocked: boolean }> {
  // 1. Robots check
  const allowed = await canFetchRobots(url);
  if (!allowed) {
    console.log(`[Robots] Entire crawl blocked by robots.txt: ${url}`);
    return { results: [], blocked: true };
  }

  const maxPagesInput = typeof options === 'number' ? options : (options.maxPages || 20);
  const maxPages = Math.min(Math.max(1, maxPagesInput), 200);
  const results: ScrapedPageResult[] = [];

  const lower = url.toLowerCase();

  // --- Tiered Discovery Entry ---
  // ALWAYS use smartFetch for the entry page to ensure results even if crawl fails
  // and to enforce robots/rate-limits consistently.
  console.log(`[Crawler] Fetching entry page: ${url}`);
  const entryPage = await smartFetch(url);
  if (entryPage.html && entryPage.html.length > 200) {
    results.push({
      url: entryPage.url,
      html: entryPage.html,
      content: entryPage.markdown,
      logo_url: entryPage.logo_url as string | null,
      header_url: entryPage.header_url as string | null,
      tier: entryPage.tier,
        blocked: entryPage.blocked || false,
      tier_info: entryPage.tier_info,
      network_json: entryPage.network_json,
      response_code: entryPage.response_code,
      response_headers: entryPage.response_headers,
      fetch_method: entryPage.fetch_method
    } as any);
    console.log(`[Crawler] Entry page successful (${entryPage.html.length} bytes).`);
    if (maxPages <= 1) return { results, blocked: false };
  } else if (entryPage.blocked) {
    console.warn(`[Crawler] Entry page blocked by policy. Skipping crawl.`);
    return { results: [], blocked: true };
  } else {
    console.warn(`[Crawler] Entry page fetch unsatisfactory. Proceeding with crawl anyway.`);
  }

  // --- Pagination Seed: run discoverPagination on the entry page HTML ---
  // This seeds Crawlee (or the high-intensity loop) with known pagination URLs
  // so we don't miss page 2+ when the adapter knows how to find them.
  let paginationSeedUrls: string[] = [];
  if (entryPage.html && maxPages > 1) {
    try {
      const { parserRegistry: reg } = await import('../adapters/index');
      const entryAdapter = await reg.getAdapter(entryPage.url);
      if (entryAdapter?.discoverPagination) {
        const rawLinks = entryAdapter.discoverPagination(entryPage.html, entryPage.url);
        // Filter already-visited URL and respect maxPages budget
        paginationSeedUrls = rawLinks
          .filter(u => u !== entryPage.url)
          .slice(0, maxPages - 1);
        if (paginationSeedUrls.length > 0) {
          console.log(`[Crawler] Entry page pagination discovered ${paginationSeedUrls.length} seed URLs via ${entryAdapter.id}`);
        }
      }
    } catch (e: any) {
      console.warn(`[Crawler] Entry page pagination discovery failed: ${e.message}`);
    }
  }

  try {
    // Only try Cheerio for low-intensity sites to save resources
    const isHighIntensityCrawl = lower.includes('gov.sa') || lower.includes('mcci.org.sa') || lower.includes('chamber.org.sa') || lower.includes('chamber.sa') || lower.includes('.aspx');

    if (isHighIntensityCrawl) {
      // High-intensity sites skip Crawlee entirely.
      // Use smartFetch on pagination seed URLs discovered from the entry page.
      if (paginationSeedUrls.length > 0) {
        console.log(`[Crawler] High-intensity path: fetching ${paginationSeedUrls.length} paginated pages via smartFetch`);
        for (const pageUrl of paginationSeedUrls) {
          if (results.length >= maxPages) break;
          try {
            const page = await smartFetch(pageUrl);
            if (page.html && page.html.length > 200 && !page.blocked) {
              results.push({
                url: page.url,
                html: page.html,
                content: page.markdown,
                logo_url: page.logo_url,
                header_url: page.header_url,
                tier: page.tier,
                network_json: page.network_json,
                response_code: page.response_code,
                response_headers: page.response_headers,
                fetch_method: page.fetch_method
              } as any);
              console.log(`[Crawler] Paginated page OK: ${page.url} (${page.html.length} bytes)`);
            }
          } catch (e: any) {
            console.warn(`[Crawler] Failed to fetch paginated page ${pageUrl}: ${e.message}`);
          }
        }
      }
      return { results, blocked: false };
    }
    const crawlee = (await import('crawlee')) as any;
    const CheerioCrawler = crawlee.CheerioCrawler;
    const cheerioCrawler = new CheerioCrawler({
      maxRequestsPerCrawl: maxPages,
      maxConcurrency: 3, 
      preNavigationHooks: [
        async ({ request }: any) => {
          const allowed = await canFetchRobots(request.url);
          if (!allowed) throw new Error(`Robots block: ${request.url}`);
          
          const domain = extractDomainFromUrl(request.url) || request.url;
          await waitForSlot(domain);
          const delay = await getRobotsCrawlDelay(request.url);
          if (delay > 0) await new Promise(r => setTimeout(r, delay * 1000));
        }
      ],
      postNavigationHooks: [
        async ({ request }: any) => {
          const domain = extractDomainFromUrl(request.url) || request.url;
          releaseSlot(domain);
        }
      ],
      requestHandler: async ({ request, $, log, enqueueLinks }: any) => {
        const rawHtml = $.html();
        
        const { parserRegistry } = await import('../adapters/index');
        const adapter = await parserRegistry.getAdapter(request.url);
        let discoveredLinks: string[] = [];
        if (adapter && adapter.discoverPagination) {
          try {
            discoveredLinks = adapter.discoverPagination(rawHtml, request.url) || [];
          } catch (e) {
            console.error(`Adapter pagination discovery failed for ${request.url}:`, e);
          }
        }
        $("script, style, nav, footer, header, iframe, noscript, svg, path").remove();
        const body = $("body").html() || "";
        const markdown = turndownService.turndown(body);

        const visuals = discoverVisuals(rawHtml, request.url);
        
        results.push({
          url: request.url,
          content: markdown.slice(0, 100000),
          html: rawHtml.slice(0, 500000),
          logo_url: visuals.logo_url,
          header_url: visuals.header_url,
          fetch_method: 'cheerio_crawler'
        });

        if (results.length < maxPages) {
          if (discoveredLinks.length > 0) {
            await enqueueLinks({
              urls: discoveredLinks,
              transformRequestFunction: async (req: any) => {
                const subAllowed = await canFetchRobots(req.url);
                return subAllowed ? req : false;
              }
            });
          } else {
            await enqueueLinks({
              strategy: 'same-domain',
              transformRequestFunction: async (req: any) => {
                if (req.url.match(/\.(jpg|jpeg|png|gif|pdf|zip|docx|xlsx|css|js)$/i)) return false;
                // Check robots for subpages before enqueuing
                const subAllowed = await canFetchRobots(req.url);
                return subAllowed ? req : false;
              }
            });
          }
        }
      },
      failedRequestHandler: ({ request, error }: any) => {
        const domain = extractDomainFromUrl(request.url) || request.url;
        releaseSlot(domain);
        console.error(`Request failed: ${request.url}`, error.message);
      }
    });
 
    const seedUrls = [url, ...paginationSeedUrls.filter(u => u !== url)];
    console.log(`[Crawler] Cheerio crawler seeded with ${seedUrls.length} URLs`);
    await cheerioCrawler.run(seedUrls);
    if (results.length > 0) return { results, blocked: false };
    throw new Error("Cheerio crawler empty result");
  } catch (error: any) {
    console.error("Crawl fallback to Playwright:", error.message);
    
    // Playwright fallback
    try {
      const crawlee = (await import('crawlee')) as any;
      const PlaywrightCrawler = crawlee.PlaywrightCrawler;
      const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: maxPages,
        maxConcurrency: 2, 
        preNavigationHooks: [
          async ({ request }: any) => {
            const allowed = await canFetchRobots(request.url);
            if (!allowed) throw new Error(`Robots block: ${request.url}`);
            
            const domain = extractDomainFromUrl(request.url) || request.url;
            await waitForSlot(domain);
            const delay = await getRobotsCrawlDelay(request.url);
            if (delay > 0) await new Promise(r => setTimeout(r, delay * 1000));
          }
        ],
        postNavigationHooks: [
          async ({ request }: any) => {
            const domain = extractDomainFromUrl(request.url) || request.url;
            releaseSlot(domain);
          }
        ],
        requestHandler: async ({ request, page, log, enqueueLinks }: any) => {
          try {
            await page.waitForLoadState('networkidle', { timeout: 30000 });
          } catch (e) { }

          const html = await page.content();
          let discoveredLinks: string[] = [];
          const { parserRegistry } = await import('../adapters/index');
          const adapter = await parserRegistry.getAdapter(request.url);
          if (adapter && adapter.discoverPagination) {
            try {
              discoveredLinks = adapter.discoverPagination(html, request.url) || [];
            } catch (e) {
              console.error(`Adapter pagination discovery failed for ${request.url}:`, e);
            }
          }
          const $ = cheerio.load(html);
          $("script, style, nav, footer, header, iframe, noscript, svg, path").remove();
          const body = $("body").html() || "";
          const markdown = turndownService.turndown(body);

          results.push({
            url: request.url,
            content: markdown.slice(0, 100000),
            html: html.slice(0, 500000)
            ,
            fetch_method: 'playwright_crawler'
          });

          if (results.length < maxPages) {
            if (discoveredLinks.length > 0) {
              await enqueueLinks({
                urls: discoveredLinks,
                transformRequestFunction: async (req: any) => {
                  const subAllowed = await canFetchRobots(req.url);
                  return subAllowed ? req : false;
                }
              });
            } else {
              await enqueueLinks({
                strategy: 'same-domain',
                transformRequestFunction: async (req: any) => {
                  if (req.url.match(/\.(jpg|jpeg|png|gif|pdf|zip|docx|xlsx|css|js)$/i)) return false;
                  const subAllowed = await canFetchRobots(req.url);
                  return subAllowed ? req : false;
                }
              });
            }
          }
        },
        failedRequestHandler: ({ request, error }: any) => {
          const domain = extractDomainFromUrl(request.url) || request.url;
          releaseSlot(domain);
          console.error(`Playwright request failed: ${request.url}`, error.message);
        },
        launchContext: {
          launchOptions: {
             args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
          },
        },
        browserPoolOptions: {
          useFingerprints: true,
        },
      });

      // Special handling for browserless in Crawlee
      if (browserlessToken) {
        (crawler as any).launchContext.launcher = (await import('playwright-core')).chromium;
        (crawler as any).launchContext.browserWSEndpoint = `wss://chrome.browserless.io?token=${browserlessToken}`;
      }
 
      const seedUrls = [url, ...paginationSeedUrls.filter(u => u !== url)];
      console.log(`[Crawler] Playwright crawler seeded with ${seedUrls.length} URLs`);
      await crawler.run(seedUrls);
      return { results, blocked: false };
    } catch (pwError) {
      const simple = await fetchUrlContent(url, 45000);
      return {
        results: [{
          url: simple.url,
          content: simple.markdown,
          html: simple.html,
          response_code: simple.response_code,
          response_headers: simple.response_headers,
          fetch_method: simple.fetch_method
        }],
        blocked: false
      };
    }
  }
}
