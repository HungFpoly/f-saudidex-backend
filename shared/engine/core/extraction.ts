/**
 * Saudidex Extraction Utilities
 * Helpers for page classification, prioritization, and data validation.
 */

import { validator } from "../../lib/validator";
import { discoverVisuals } from "./visuals";

/**
 * Classify a page by its URL pattern
 */
export function classifyPage(url: string, baseUrl: string) {
  const path = url.toLowerCase().replace(baseUrl.toLowerCase(), "");
  
  if (path === "" || path === "/" || path === "/home" || path === "/index.html") {
    return { pageType: "homepage" as const, confidence: 1.0 };
  }
  
  const patterns = {
    contact: [/contact/i, /reach/i, /get-in-touch/i, /support/i, /location/i, /address/i, /map/i],
    about: [/about/i, /who-we-are/i, /company-profile/i, /our-story/i, /vision/i, /mission/i],
    products: [/product/i, /service/i, /solution/i, /catalog/i, /portfolio/i, /what-we-do/i, /capability/i, /gallery/i],
    industries: [/industr/i, /sector/i, /market/i, /application/i],
    clients: [/client/i, /customer/i, /partner/i, /reference/i, /case-stud/i],
    legal: [/legal/i, /privacy/i, /term/i, /policy/i, /compliance/i, /cr-certificate/i],
    news: [/news/i, /blog/i, /article/i, /press/i, /event/i, /media/i],
  };

  for (const [type, regexes] of Object.entries(patterns)) {
    if (regexes.some(r => r.test(path))) {
      return { pageType: type as any, confidence: 0.85 };
    }
  }

  return { pageType: "other" as const, confidence: 0.1 };
}

/**
 * Prioritize pages for scraping based on value for discovery/enrichment
 */
export function prioritizePages(urls: string[], baseUrl: string, limit: number = 10) {
  const labeled = urls.map(url => ({
    url,
    ...classifyPage(url, baseUrl)
  }));

  // Scoring weights
  const weights: Record<string, number> = {
    homepage: 100,
    contact: 95,
    about: 90,
    products: 85,
    industries: 80,
    legal: 70,
    clients: 60,
    other: 10,
    news: 5
  };

  return labeled
    .sort((a, b) => (weights[b.pageType] || 0) - (weights[a.pageType] || 0))
    .slice(0, limit);
}

/**
 * Extract site logo and header URLs from HTML
 */
export function extractVisuals(html: string, baseUrl: string): { logo: string | null; header: string | null; confidence: number } {
  if (!html) return { logo: null, header: null, confidence: 0 };
  
  const { logo_url, header_url } = discoverVisuals(html, baseUrl);
  
  // Calculate a heuristic confidence based on source type (meta tags are higher confidence)
  let confidence = 0.5;
  if (html.includes('property="og:image"') || html.includes('name="twitter:image"')) {
    confidence = 0.9;
  } else if (html.includes('rel="apple-touch-icon"') || html.includes('rel="icon"')) {
    confidence = 0.8;
  }

  return { 
    logo: logo_url, 
    header: header_url,
    confidence 
  };
}

/**
 * Legacy wrapper for backward compatibility
 */
export function extractLogoUrl(html: string, baseUrl: string) {
  const res = extractVisuals(html, baseUrl);
  return { value: res.logo, confidence: res.confidence };
}

/**
 * Formats a phone number into a clean digits-only string
 */
function formatPhone(phone: string): string {
  if (!phone) return "";
  return phone.replace(/[\s\-\(\)\+\.]/g, '');
}

/**
 * Validates and cleans a list of companies extracted by AI.
 */
export async function validateAndCleanCompanies(companies: any[]) {
  if (!Array.isArray(companies)) return [];

  const results = [];
  for (const raw of companies) {
    const cleaned = { ...raw };
    
    // Basic cleanup
    cleaned.name_en = String(cleaned.name_en || '').trim();
    cleaned.name_ar = String(cleaned.name_ar || '').trim();
    cleaned.phone = formatPhone(cleaned.phone || "");
    
    if (cleaned.website_url) {
      let url = String(cleaned.website_url).trim();
      if (url && !url.startsWith('http')) url = 'https://' + url;
      cleaned.website_url = url.toLowerCase();
    }

    // List cleanup
    const arrays = ['categories', 'products', 'brands', 'services'];
    for (const key of arrays) {
      if (Array.isArray(cleaned[key])) {
        cleaned[key] = cleaned[key].map((item: any) => String(item).trim()).filter(Boolean);
      }
    }

    if (cleaned.name_en || cleaned.name_ar) {
      results.push(cleaned);
    }
  }

  return results;
}
