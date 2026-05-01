/**
 * Field Extractors
 *
 * Modular extractors for specific company data fields.
 * Each extractor is a small, focused function that can be tested independently.
 *
 * This is better than one giant parser because:
 * - Each field has specific extraction patterns
 * - Easy to add new fields
 * - Easy to test individual extractors
 * - Can combine results from multiple pages
 */

import * as cheerio from 'cheerio';
import { resolveUrl } from '../urlCanonicalizer';

export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
  source: string; // Which page/selector extracted it
}

/**
 * Extract company description from page content.
 * Prioritizes: meta description > about page content > first paragraph
 */
export function extractDescription(html: string, baseUrl: string): ExtractedField<string> {
  const $ = cheerio.load(html);

  // Meta description (highest confidence)
  const metaDesc = $('meta[name="description"]').attr('content')?.trim();
  if (metaDesc && metaDesc.length > 20) {
    return { value: metaDesc, confidence: 0.8, source: 'meta_description' };
  }

  // OpenGraph description
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  if (ogDesc && ogDesc.length > 20) {
    return { value: ogDesc, confidence: 0.7, source: 'og_description' };
  }

  // First substantial paragraph
  const paragraphs = $('p').map((_, el) => $(el).text().trim()).get();
  for (const p of paragraphs) {
    if (p.length > 50 && p.length < 500) {
      return { value: p, confidence: 0.5, source: 'first_paragraph' };
    }
  }

  return { value: null, confidence: 0, source: '' };
}

/**
 * Extract email addresses from page content.
 * Handles mailto: links and text patterns.
 */
export function extractEmails(html: string, baseUrl: string): ExtractedField<string[]> {
  const $ = cheerio.load(html);
  const emails = new Set<string>();
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  // mailto: links (highest confidence)
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/^mailto:([^\s?]+)/);
    if (match) emails.add(match[1]);
  });

  // Text pattern matching
  const text = $('body').text();
  const textMatches = text.match(emailRegex);
  if (textMatches) {
    for (const email of textMatches) {
      emails.add(email);
    }
  }

  // Filter out common false positives
  const validEmails = Array.from(emails).filter(e =>
    !e.includes('saudidex.ae') &&
    !e.includes('placeholder') &&
    e.length > 5
  );

  return {
    value: validEmails.length > 0 ? validEmails : null,
    confidence: validEmails.length > 0 ? 0.8 : 0,
    source: validEmails.length > 0 ? 'mailto_and_text' : ''
  };
}

/**
 * Extract phone numbers from page content.
 * Handles various phone formats.
 */
export function extractPhones(html: string, baseUrl: string): ExtractedField<string[]> {
  const $ = cheerio.load(html);
  const phones = new Set<string>();

  // tel: links (highest confidence)
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/^tel:(.+)/);
    if (match) phones.add(match[1].trim());
  });

  // Pattern matching for phone numbers
  const text = $('body').text();
  const phonePatterns = [
    /(\+[\d\s\-()]{7,20})/g, // International format
    /([\d\s\-()]{7,15})/g // Local format
  ];

  for (const pattern of phonePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const phone = match[1].trim();
      // Filter out non-phone numbers (too short, too long, or invalid chars)
      const cleanPhone = phone.replace(/[\s\-()]/g, '');
      if (cleanPhone.length >= 7 && cleanPhone.length <= 15 && /^\+?\d+$/.test(cleanPhone)) {
        phones.add(phone);
      }
    }
  }

  return {
    value: phones.size > 0 ? Array.from(phones) : null,
    confidence: phones.size > 0 ? 0.7 : 0,
    source: phones.size > 0 ? 'tel_and_pattern' : ''
  };
}

/**
 * Extract social media links from page content.
 */
export function extractSocialLinks(html: string, baseUrl: string): ExtractedField<Record<string, string>> {
  const $ = cheerio.load(html);
  const social: Record<string, string> = {};

  const socialPatterns: Record<string, RegExp> = {
    linkedin: /linkedin\.com\/company\/[^"'\s]+/i,
    twitter: /twitter\.com\/[^"'\s]+/i,
    facebook: /facebook\.com\/[^"'\s]+/i,
    instagram: /instagram\.com\/[^"'\s]+/i,
    youtube: /youtube\.com\/[^"'\s]+/i,
    tiktok: /tiktok\.com\/@[^"'\s]+/i
  };

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    for (const [platform, pattern] of Object.entries(socialPatterns)) {
      if (!social[platform]) {
        const match = href.match(pattern);
        if (match) {
          social[platform] = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
        }
      }
    }
  });

  return {
    value: Object.keys(social).length > 0 ? social : null,
    confidence: Object.keys(social).length > 0 ? 0.85 : 0,
    source: Object.keys(social).length > 0 ? 'social_links' : ''
  };
}

/**
 * Extract address/location from page content.
 */
export function extractAddress(html: string, baseUrl: string): ExtractedField<string> {
  const $ = cheerio.load(html);

  // <address> tag (highest confidence)
  const addressTag = $('address').first().text().trim();
  if (addressTag && addressTag.length > 5) {
    return { value: addressTag, confidence: 0.9, source: 'address_tag' };
  }

  // Structured data
  const jsonLd = $('script[type="application/ld+json"]').html();
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd);
      const address = data.address?.streetAddress || data.address?.addressLocality;
      if (address) {
        return { value: address, confidence: 0.85, source: 'json_ld' };
      }
    } catch {
      // Skip invalid JSON
    }
  }

  // Meta geo tags
  const geoRegion = $('meta[name="geo.region"]').attr('content');
  const geoPlacename = $('meta[name="geo.placename"]').attr('content');
  if (geoPlacename) {
    return { value: geoPlacename + (geoRegion ? `, ${geoRegion}` : ''), confidence: 0.7, source: 'geo_meta' };
  }

  return { value: null, confidence: 0, source: '' };
}

/**
 * Extract company name from page content.
 * Prioritizes: JSON-LD > meta title > h1 > title tag
 */
export function extractCompanyName(html: string, baseUrl: string): ExtractedField<string> {
  const $ = cheerio.load(html);

  // JSON-LD Organization name
  const jsonLd = $('script[type="application/ld+json"]').html();
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd);
      const name = data.name || data.legalName || data.alternateName;
      if (name && typeof name === 'string' && name.length > 2) {
        return { value: name.trim(), confidence: 0.95, source: 'json_ld' };
      }
    } catch {
      // Skip invalid JSON
    }
  }

  // OpenGraph site name
  const ogName = $('meta[property="og:site_name"]').attr('content')?.trim();
  if (ogName && ogName.length > 2) {
    return { value: ogName, confidence: 0.8, source: 'og_site_name' };
  }

  // First h1
  const h1 = $('h1').first().text().trim();
  if (h1 && h1.length > 2 && h1.length < 100) {
    return { value: h1, confidence: 0.7, source: 'h1' };
  }

  // Title tag (lowest confidence)
  const title = $('title').text().trim();
  if (title && title.length > 2) {
    // Clean common suffixes
    const cleaned = title.replace(/\s*[-|—–]\s*.*$/, '').trim();
    return { value: cleaned, confidence: 0.5, source: 'title_tag' };
  }

  return { value: null, confidence: 0, source: '' };
}

/**
 * Best-effort site logo from HTML (DOM beats AI guesses).
 * Prioritises header/site logo selectors, then JSON-LD Organization logo, og:image, favicon.
 */
export function extractLogoUrl(html: string, baseUrl: string): ExtractedField<string> {
  if (!html?.trim() || !baseUrl?.trim()) {
    return { value: null, confidence: 0, source: '' };
  }

  const $ = cheerio.load(html);
  const candidates: { url: string; confidence: number; source: string }[] = [];

  const push = (raw: string | undefined, confidence: number, source: string) => {
    const src = raw?.trim();
    if (!src || src.startsWith('data:')) return;
    if (/pixel|tracker|spacer|blank|1x1|analytics/i.test(src)) return;
    try {
      const abs = resolveUrl(src, baseUrl);
      if (!/^https?:\/\//i.test(abs)) return;
      candidates.push({ url: abs, confidence, source });
    } catch {
      /* ignore bad URLs */
    }
  };

  $('.logo img[src], .logo a img[src], header .logo img[src], nav .logo img[src], .site-logo img[src], #logo img[src]').each(
    (_, el) => {
      push($(el).attr('src'), 0.95, 'dom_site_logo');
    },
  );

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw?.trim()) return;
    try {
      const data = JSON.parse(raw);
      const roots = Array.isArray(data) ? data : [data];
      const nodes: unknown[] = [];
      for (const r of roots) {
        const graph =
          r && typeof r === 'object' ? (r as Record<string, unknown>)['@graph'] : undefined;
        if (Array.isArray(graph)) {
          nodes.push(...graph);
        } else if (r) nodes.push(r);
      }
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const rawType = (node as { '@type'?: string | string[] })['@type'];
        const types = Array.isArray(rawType) ? rawType : rawType ? [String(rawType)] : [];
        if (types.length && !types.some((x) => /Organization|Corporation|LocalBusiness|Store/i.test(x))) continue;
        const logo = (node as { logo?: unknown; image?: unknown }).logo ?? (node as { image?: unknown }).image;
        if (typeof logo === 'string') push(logo, 0.9, 'json_ld_logo');
        else if (logo && typeof logo === 'object' && typeof (logo as { url?: string }).url === 'string') {
          push((logo as { url: string }).url, 0.9, 'json_ld_logo');
        }
      }
    } catch {
      /* skip */
    }
  });

  push($('meta[property="og:image"]').attr('content'), 0.55, 'og_image');
  $('link[rel="apple-touch-icon"], link[rel="icon"], link[rel="shortcut icon"]').each((_, el) => {
    push($(el).attr('href'), 0.45, 'favicon');
  });

  if (candidates.length === 0) {
    return { value: null, confidence: 0, source: '' };
  }

  const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
  return { value: best.url, confidence: best.confidence, source: best.source };
}

/**
 * Extract canonical website URL from page.
 * Useful when crawling directory pages where company website appears in outbound links.
 */
export function extractWebsiteUrl(html: string, baseUrl: string): ExtractedField<string> {
  if (!html?.trim()) {
    return { value: null, confidence: 0, source: '' };
  }

  const $ = cheerio.load(html);
  const candidates: Array<{ url: string; confidence: number; source: string }> = [];

  const pushCandidate = (raw: string | undefined, confidence: number, source: string) => {
    const href = raw?.trim();
    if (!href) return;
    try {
      const abs = resolveUrl(href, baseUrl);
      if (!/^https?:\/\//i.test(abs)) return;
      const host = new URL(abs).hostname.toLowerCase();
      if (/localhost|127\.0\.0\.1|facebook\.com|linkedin\.com|instagram\.com|twitter\.com|youtube\.com|tiktok\.com/.test(host)) {
        return;
      }
      candidates.push({ url: abs, confidence, source });
    } catch {
      /* ignore invalid URL */
    }
  };

  // Strong signal: links explicitly marked as website/homepage.
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().toLowerCase();
    const rel = ($(el).attr('rel') || '').toLowerCase();
    if (/website|homepage|visit site|official/i.test(text) || rel.includes('external')) {
      pushCandidate(href, 0.9, 'anchor_website_text');
    }
  });

  // Fallback: canonical link or og:url.
  pushCandidate($('link[rel="canonical"]').attr('href'), 0.7, 'canonical_link');
  pushCandidate($('meta[property="og:url"]').attr('content'), 0.65, 'og_url');

  if (candidates.length === 0) {
    return { value: null, confidence: 0, source: '' };
  }

  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  return { value: best.url, confidence: best.confidence, source: best.source };
}

/**
 * Extract team/leadership information from page content.
 */
export function extractTeam(html: string, baseUrl: string): ExtractedField<Array<{ name: string; role?: string }>> {
  const $ = cheerio.load(html);
  const team: Array<{ name: string; role?: string }> = [];

  // Common team member patterns
  $('.team-member, .team-member-name, .person, .leader, .executive, .board-member').each((_, el) => {
    const nameEl = $(el).find('h1, h2, h3, h4, h5, .name, .member-name').first();
    const name = nameEl.text().trim();
    if (name && name.length > 2 && name.length < 50) {
      const roleEl = $(el).find('.role, .title, .position, .designation').first();
      const role = roleEl.text().trim() || undefined;
      team.push({ name, role });
    }
  });

  return {
    value: team.length > 0 ? team : null,
    confidence: team.length > 0 ? 0.6 : 0,
    source: team.length > 0 ? 'team_elements' : ''
  };
}
