/**
 * URL Canonicalizer
 *
 * Responsible for:
 * - Cleaning URLs (normalize protocol, www, trailing slashes)
 * - Resolving relative links against base URL
 * - Removing tracking parameters (utm_*, ref, fbclid, gclid, etc.)
 * - Canonical domain normalization
 * - Duplicate URL detection
 * - Extracting clean domain for adapter matching
 *
 * Without this, the same company may appear as:
 *   http://company.com
 *   https://company.com
 *   https://www.company.com/
 *   https://company.com?ref=directory&utm_source=listing
 */

// Tracking parameters to strip from URLs
const TRACKING_PARAMS = new Set([
  // UTM parameters
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_reader', 'utm_place', 'utm_brand',
  // Common tracking
  'ref', 'referer', 'referrer', 'source',
  'fbclid', 'gclid', 'msclkid', '_openstat',
  // Analytics
  'ga_source', 'ga_medium', 'ga_campaign',
  'mc_eid', 'mkt_tok', 'spJobID', 'spMailingID', 'spReportId',
  // Social
  'si', 's', 'fb_action_ids', 'fb_action_types',
  // Misc
  'action_object_map', 'action_type_map', 'action_ref_map',
  'recruitedBy', 'from', 'via'
]);

/**
 * Parse a URL into its components.
 * Returns null if the URL is invalid.
 */
export const parseUrl = (url: string, baseUrl?: string): URL | null => {
  try {
    if (!url) return null;
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://') && !baseUrl) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    return baseUrl ? new URL(normalizedUrl, baseUrl) : new URL(normalizedUrl);
  } catch {
    return null;
  }
};

/**
 * Resolve a relative URL against a base URL.
 * Returns the absolute URL string, or the original if it can't be resolved.
 */
export const resolveUrl = (relative: string, base: string): string => {
  const parsed = parseUrl(relative, base);
  return parsed ? parsed.href : relative;
};

/**
 * Canonicalize a URL:
 * - Normalize protocol to https://
 * - Strip www. from hostname
 * - Remove trailing slashes (except root)
 * - Strip all tracking parameters
 * - Lowercase hostname
 * - Sort remaining query parameters alphabetically
 *
 * Returns null if the URL is invalid.
 */
export const canonicalizeUrl = (url: string, baseUrl?: string): string | null => {
  const parsed = parseUrl(url, baseUrl);
  if (!parsed) return null;

  // Normalize protocol to https://
  parsed.protocol = 'https:';

  // Strip www. from hostname
  if (parsed.hostname?.startsWith('www.')) {
    parsed.hostname = parsed.hostname.slice(4);
  }

  // Lowercase hostname
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove trailing slash from pathname (except root)
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Strip tracking parameters
  const searchParams = new URLSearchParams(parsed.search);
  const cleanParams = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      cleanParams.append(key, value);
    }
  }

  // Sort remaining parameters alphabetically
  const sortedParams = Array.from(cleanParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  parsed.search = new URLSearchParams(sortedParams).toString();

  return parsed.href;
};

/**
 * Extract the clean domain from a URL.
 * E.g., "https://www.company.com/page?ref=test" → "company.com"
 */
export const extractDomain = (url: string, baseUrl?: string): string | null => {
  const parsed = parseUrl(url, baseUrl);
  if (!parsed) return null;

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith('www.')) {
    hostname = hostname.slice(4);
  }
  return hostname;
};

/**
 * Normalize a URL for comparison (same as canonicalize but without protocol forcing).
 * Useful for deduplication where http/https might be meaningful.
 */
export const normalizeUrl = (url: string, baseUrl?: string): string | null => {
  const parsed = parseUrl(url, baseUrl);
  if (!parsed) return null;

  // Strip www.
  if (parsed.hostname?.startsWith('www.')) {
    parsed.hostname = parsed.hostname.slice(4);
  }

  // Lowercase hostname
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove trailing slash (except root)
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Strip tracking parameters
  const searchParams = new URLSearchParams(parsed.search);
  const cleanParams = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      cleanParams.append(key, value);
    }
  }

  parsed.search = cleanParams.toString();
  return parsed.href;
};

/**
 * Check if two URLs point to the same canonical resource.
 */
export const urlsMatch = (url1: string, url2: string, baseUrl?: string): boolean => {
  const canon1 = canonicalizeUrl(url1, baseUrl);
  const canon2 = canonicalizeUrl(url2, baseUrl);
  return canon1 !== null && canon1 === canon2;
};

/**
 * Deduplicate an array of URLs, keeping only canonical versions.
 * Returns unique URLs in their original form (first occurrence kept).
 */
export const deduplicateUrls = (urls: string[], baseUrl?: string): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const url of urls) {
    const canon = canonicalizeUrl(url, baseUrl);
    if (canon && !seen.has(canon)) {
      seen.add(canon);
      unique.push(url);
    }
  }

  return unique;
};

/**
 * Clean a URL for adapter matching.
 * Removes tracking params but keeps the URL otherwise intact.
 */
export const cleanUrlForMatching = (url: string, baseUrl?: string): string => {
  const parsed = parseUrl(url, baseUrl);
  if (!parsed) return url;

  // Strip tracking parameters
  const searchParams = new URLSearchParams(parsed.search);
  const cleanParams = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      cleanParams.append(key, value);
    }
  }

  parsed.search = cleanParams.toString();
  return parsed.href;
};

/**
 * Validate that a URL is a valid HTTP(S) URL.
 */
export const isValidUrl = (url: string): boolean => {
  try {
    if (!url) return false;
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    const parsed = new URL(normalizedUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};
