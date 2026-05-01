/**
 * Website Resolver
 *
 * Responsible for:
 * - Verifying the extracted company website
 * - Handling redirects
 * - Discarding broken domains
 * - Detecting parked/spam pages
 * - Checking if the extracted link is actually the real company site
 *
 * This module improves enrichment quality significantly by filtering out
 * invalid, parked, or spam domains before they reach the enrichment pipeline.
 */

import * as cheerio from 'cheerio';
import { canFetch } from './robotsPolicy';
import { withRateLimit } from './rateLimiter';

export interface WebsiteResolution {
  url: string;
  finalUrl: string;
  isValid: boolean;
  isReachable: boolean;
  isParked: boolean;
  isSpam: boolean;
  isRedirect: boolean;
  statusCode: number;
  title: string;
  metaDescription: string;
  hasCompanyContent: boolean;
  confidence: number;
  error?: string;
}

// Common parked/spam domain indicators
const PARKED_INDICATORS = [
  'parked page', 'this domain is for sale', 'buy this domain',
  'domain parking', 'registered by domain registrar',
  'privacy protection service', 'whois privacy',
  'page not found', 'under construction', 'coming soon',
  'this website is for sale', 'buy this website'
];

const SPAM_INDICATORS = [
  'casino', 'viagra', 'porn', 'adult content',
  'online pharmacy', 'weight loss', 'replica watch'
];

// Common redirect status codes
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

// Valid content indicators
const VALID_CONTENT_INDICATORS = [
  'about', 'contact', 'products', 'services', 'company',
  'team', 'leadership', 'careers', 'jobs', 'news',
  'solutions', 'portfolio', 'clients', 'partners'
];

/**
 * Resolve and verify a company website URL.
 * Returns a WebsiteResolution with detailed validation results.
 */
export async function resolveWebsite(url: string, baseUrl?: string): Promise<WebsiteResolution> {
  const result: WebsiteResolution = {
    url,
    finalUrl: url,
    isValid: false,
    isReachable: false,
    isParked: false,
    isSpam: false,
    isRedirect: false,
    statusCode: 0,
    title: '',
    metaDescription: '',
    hasCompanyContent: false,
    confidence: 0
  };

  try {
    // Parse and validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = baseUrl ? new URL(url, baseUrl) : new URL(url);
    } catch {
      result.error = 'Invalid URL format';
      return result;
    }

    // Only allow HTTP/HTTPS
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      result.error = 'Unsupported protocol';
      return result;
    }

    // Robots.txt compliance check
    const allowed = await canFetch(parsedUrl.href);
    if (!allowed) {
      result.error = 'Blocked by robots.txt';
      return result;
    }

    // Fetch the page
    const domain = parsedUrl.hostname.replace(/^www\./, '');
    const response = await withRateLimit(domain, async () => {
      return await fetch(parsedUrl.href, {
        method: 'GET',
        redirect: 'manual', // Handle redirects manually
        headers: {
          'User-Agent': 'saudidex-bot (+https://saudidex.ae/bot)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
    });

    result.statusCode = response.status;

    // Handle redirects
    if (REDIRECT_CODES.has(response.status)) {
      result.isRedirect = true;
      const location = response.headers.get('location');
      if (location) {
        result.finalUrl = new URL(location, parsedUrl.href).href;
        // Follow redirect recursively
        const redirectResult = await resolveWebsite(result.finalUrl);
        return {
          ...redirectResult,
          url,
          isRedirect: true,
          finalUrl: redirectResult.finalUrl
        };
      }
    }

    // Check for HTTP errors
    if (response.status >= 400) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    result.isReachable = true;

    // Parse HTML
    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract title and meta description
    result.title = $('title').text().trim();
    result.metaDescription = $('meta[name="description"]').attr('content') || '';

    // Check for parked domain indicators
    const pageText = $('body').text().toLowerCase();
    for (const indicator of PARKED_INDICATORS) {
      if (pageText.includes(indicator.toLowerCase())) {
        result.isParked = true;
        result.confidence = 0.1;
        return result;
      }
    }

    // Check for spam indicators
    for (const indicator of SPAM_INDICATORS) {
      if (pageText.includes(indicator.toLowerCase())) {
        result.isSpam = true;
        result.confidence = 0.1;
        return result;
      }
    }

    // Check for valid company content indicators
    for (const indicator of VALID_CONTENT_INDICATORS) {
      if (pageText.includes(indicator)) {
        result.hasCompanyContent = true;
        break;
      }
    }

    // Calculate confidence score
    let confidence = 0.5; // Base confidence for reachable page

    if (result.hasCompanyContent) confidence += 0.2;
    if (result.title.length > 5) confidence += 0.1;
    if (result.metaDescription.length > 10) confidence += 0.1;
    if (result.isRedirect) confidence -= 0.1; // Slight penalty for redirects

    // Check for common company page patterns
    if ($('nav').length > 0) confidence += 0.05;
    if ($('footer').length > 0) confidence += 0.05;
    if ($('.contact').length > 0 || $('#contact').length > 0) confidence += 0.05;
    if ($('.about').length > 0 || $('#about').length > 0) confidence += 0.05;

    result.confidence = Math.min(1.0, confidence);
    result.isValid = result.confidence > 0.4 && !result.isParked && !result.isSpam;

  } catch (error: any) {
    result.error = error.message || 'Unknown error';
    result.confidence = 0;
  }

  return result;
}

/**
 * Quick check if a domain is likely parked or spam.
 * Does not fetch the page — only checks the domain name.
 */
export function isLikelyParkedDomain(domain: string): boolean {
  const lower = domain.toLowerCase();

  // Known parked domain patterns
  const parkedPatterns = [
    /parked/, /for.?sale/, /buy.?domain/, /buy.?website/,
    /domain.?name.?search/, /whois/
  ];

  for (const pattern of parkedPatterns) {
    if (pattern.test(lower)) return true;
  }

  return false;
}

/**
 * Batch resolve multiple website URLs.
 */
export async function resolveWebsites(urls: string[], baseUrl?: string): Promise<WebsiteResolution[]> {
  const results: WebsiteResolution[] = [];

  for (const url of urls) {
    const result = await resolveWebsite(url, baseUrl);
    results.push(result);
  }

  return results;
}

/**
 * Filter a list of company websites, keeping only valid ones.
 * Returns { valid, invalid } split.
 */
export async function filterValidWebsites(
  companies: Array<{ name_en?: string; name_ar?: string; website_url?: string }>,
  baseUrl?: string
): Promise<{
  valid: Array<{ name: string; website_url: string; resolution: WebsiteResolution }>;
  invalid: Array<{ name: string; website_url: string; resolution: WebsiteResolution }>;
}> {
  const valid: Array<{ name: string; website_url: string; resolution: WebsiteResolution }> = [];
  const invalid: Array<{ name: string; website_url: string; resolution: WebsiteResolution }> = [];

  for (const company of companies) {
    if (!company.website_url) continue;

    const displayName = company.name_en || company.name_ar || 'Unknown Company';

    // Quick check first
    if (isLikelyParkedDomain(company.website_url)) {
      invalid.push({
        name: displayName,
        website_url: company.website_url,
        resolution: {
          url: company.website_url,
          finalUrl: company.website_url,
          isValid: false,
          isReachable: false,
          isParked: true,
          isSpam: false,
          isRedirect: false,
          statusCode: 0,
          title: '',
          metaDescription: '',
          hasCompanyContent: false,
          confidence: 0,
          error: 'Likely parked domain'
        }
      });
      continue;
    }

    const resolution = await resolveWebsite(company.website_url, baseUrl);

    if (resolution.isValid) {
      valid.push({ name: displayName, website_url: company.website_url, resolution });
    } else {
      invalid.push({ name: displayName, website_url: company.website_url, resolution });
    }
  }

  return { valid, invalid };
}
