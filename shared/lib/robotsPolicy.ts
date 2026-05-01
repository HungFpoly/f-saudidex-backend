/**
 * Robots.txt Policy Module
 *
 * Responsible for:
 * - Fetching and parsing robots.txt for each domain
 * - Checking whether a URL path is allowed for our user-agent
 * - Caching policies to avoid repeated fetches
 * - Respecting Crawl-delay directives
 *
 * This module MUST be consulted before any HTTP fetch or browser crawl.
 * Without it, the platform risks violating website terms of service
 * and getting IPs banned.
 */

import { supabaseAdmin } from './supabase';

export interface RobotsRule {
  userAgent: string;
  disallow: string[];
  allow: string[];
  crawlDelay?: number;
}

export interface RobotsPolicy {
  domain: string;
  rules: RobotsRule[];
  fetchedAt: number;
  rawText?: string;
  isCacheable: boolean;
}

// Our crawler's user-agent identifier
const CRAWLER_USER_AGENT = 'saudidex-bot';

// Cache TTL: 1 hour (3600000ms)
const ROBOTS_CACHE_TTL = parseInt(process.env.ROBOTS_CACHE_TTL_MS || '3600000', 10);

// In-memory cache: domain -> policy
const robotsCache = new Map<string, RobotsPolicy>();

// Pre-warm cache for high-priority domains on startup
if (typeof window === 'undefined') {
  // Server-side only
  const highPriorityDomains = [
    'https://mim.gov.sa',
    'https://mcci.org.sa',
    'https://fsc.org.sa',
    'https://modon.gov.sa',
    'https://eamana.gov.sa'
  ];
  
  // Warm cache asynchronously without blocking startup
  warmRobotsCache(highPriorityDomains).catch(console.error);
}

/**
 * Check whether a URL can be fetched given our user-agent.
 * Fetches and caches robots.txt for the domain if not already cached.
 * Returns true if allowed, false if disallowed.
 */
export async function canFetch(url: string, userAgent: string = CRAWLER_USER_AGENT): Promise<boolean> {
  let domain: string;
  try {
    domain = new URL(url).origin;
  } catch {
    return true; // Invalid URL, let downstream handle the error
  }

  const policy = await getRobotsPolicy(domain);
  return isPathAllowed(url, policy, userAgent);
}

/**
 * Get the crawl delay (in seconds) for a domain.
 * Returns 0 if no delay specified.
 */
export async function getCrawlDelay(url: string, userAgent: string = CRAWLER_USER_AGENT): Promise<number> {
  let domain: string;
  try {
    domain = new URL(url).origin;
  } catch {
    return 0;
  }

  const policy = await getRobotsPolicy(domain);

  // Find matching rules for our user-agent
  for (const rule of policy.rules) {
    if (rule.userAgent.toLowerCase() === userAgent.toLowerCase()) {
      return rule.crawlDelay || 0;
    }
  }

  // Fall back to '*' rules
  for (const rule of policy.rules) {
    if (rule.userAgent === '*') {
      return rule.crawlDelay || 0;
    }
  }

  return 0;
}

/**
 * Get the cached or freshly fetched robots policy for a domain.
 */
async function getRobotsPolicy(domain: string): Promise<RobotsPolicy> {
  const cached = robotsCache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL) {
    return cached;
  }

  try {
    const resp = await fetch(`${domain}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': CRAWLER_USER_AGENT,
      }
    });

    if (!resp.ok) {
      // No robots.txt or error — allow by default
      const emptyPolicy: RobotsPolicy = {
        domain,
        rules: [],
        fetchedAt: Date.now(),
        isCacheable: true,
      };
      robotsCache.set(domain, emptyPolicy);
      return emptyPolicy;
    }

    const text = await resp.text();
    const rules = parseRobotsTxt(text);

    const policy: RobotsPolicy = {
      domain,
      rules,
      fetchedAt: Date.now(),
      rawText: text,
      isCacheable: true,
    };

    robotsCache.set(domain, policy);
    return policy;
  } catch (error) {
    console.warn(`[RobotsPolicy] Failed to fetch robots.txt for ${domain}:`, (error as Error).message);
    // If unreachable, allow by default (but don't cache — retry next time)
    return {
      domain,
      rules: [],
      fetchedAt: Date.now(),
      isCacheable: false,
    };
  }
}

/**
 * Check if a specific URL path is allowed by the robots policy.
 */
function isPathAllowed(url: string, policy: RobotsPolicy, userAgent: string): boolean {
  const pathname = new URL(url).pathname;

  // Find rules matching our user-agent (case-insensitive)
  const matchedRules = policy.rules.filter(
    r => r.userAgent.toLowerCase() === userAgent.toLowerCase() || r.userAgent === '*'
  );

  if (matchedRules.length === 0) {
    return true; // No rules = everything allowed
  }

  // Sort by specificity: exact user-agent first, then '*'
  const specificRules = matchedRules.filter(r => r.userAgent.toLowerCase() === userAgent.toLowerCase());
  const wildcardRules = matchedRules.filter(r => r.userAgent === '*');
  const rulesToCheck = specificRules.length > 0 ? specificRules : wildcardRules;

  for (const rule of rulesToCheck) {
    // Check allow rules first (most specific wins)
    for (const allowed of rule.allow) {
      if (pathMatches(pathname, allowed)) return true;
    }

    // Check disallow rules
    for (const disallowed of rule.disallow) {
      if (pathMatches(pathname, disallowed)) return false;
    }
  }

  return true; // Default allow
}

/**
 * Check if a path matches a robots.txt pattern.
 * Supports * wildcard matching.
 */
function pathMatches(path: string, pattern: string): boolean {
  if (!pattern || pattern === '/') return true;

  // Convert robots.txt glob pattern to regex
  // * matches any sequence of characters
  // $ at end means end-of-URL
  let regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/\*/g, '.*'); // * -> .*

  // If pattern ends with $, match exact end
  if (regexStr.endsWith('$')) {
    regexStr = regexStr.slice(0, -1);
    return new RegExp(`^${regexStr}$`).test(path);
  }

  // Otherwise, match as prefix
  return new RegExp(`^${regexStr}`).test(path);
}

/**
 * Parse robots.txt text into structured rules.
 */
function parseRobotsTxt(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let currentRule: RobotsRule | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Remove inline comments
    const cleanLine = trimmed.split('#')[0].trim();
    const colonIndex = cleanLine.indexOf(':');
    if (colonIndex === -1) continue;

    const directive = cleanLine.substring(0, colonIndex).trim().toLowerCase();
    const value = cleanLine.substring(colonIndex + 1).trim();

    switch (directive) {
      case 'user-agent':
        // Start a new rule block
        currentRule = {
          userAgent: value,
          disallow: [],
          allow: [],
        };
        rules.push(currentRule);
        break;

      case 'disallow':
        if (currentRule && value) {
          currentRule.disallow.push(value.toLowerCase());
        }
        break;

      case 'allow':
        if (currentRule && value) {
          currentRule.allow.push(value.toLowerCase());
        }
        break;

      case 'crawl-delay':
        if (currentRule) {
          const delay = parseInt(value, 10);
          if (!isNaN(delay)) {
            currentRule.crawlDelay = delay;
          }
        }
        break;

      case 'sitemap':
        // We don't process sitemaps here, but could be added later
        break;

      case 'host':
        // Preferred host — informational only
        break;
    }
  }

  return rules;
}

/**
 * Clear the robots.txt cache (useful for testing or forced refresh).
 */
export function clearRobotsCache(): void {
  robotsCache.clear();
}

/**
 * Clear the cache for a specific domain.
 */
export function clearRobotsCacheForDomain(domain: string): void {
  try {
    const origin = new URL(domain).origin;
    robotsCache.delete(origin);
  } catch {
    robotsCache.delete(domain);
  }
}

/**
 * Get cache statistics (for monitoring).
 */
export function getRobotsCacheStats(): { size: number; domains: string[] } {
  return {
    size: robotsCache.size,
    domains: Array.from(robotsCache.keys()),
  };
}

/**
 * Get cache hit/miss statistics (for monitoring).
 */
export function getRobotsCacheHitRate(): { hits: number; misses: number; hitRate: number } {
  // Since we don't track hits/misses globally, simulate based on cache size vs total lookups
  // In practice, this would be tracked via incrementing counters
  // For now, return placeholder values that can be enhanced later
  return {
    hits: 0,
    misses: 0,
    hitRate: 0
  };
}

/**
 * Pre-fetch robots.txt for a list of domains (warm the cache).
 */
export async function warmRobotsCache(domains: string[]): Promise<void> {
  await Promise.all(domains.map(d => getRobotsPolicy(d)));
}

/**
 * Check if the robots cache is empty.
 */
export function isRobotsCacheEmpty(): boolean {
  return robotsCache.size === 0;
}

/**
 * Get the current size of the robots cache.
 */
export function getRobotsCacheSize(): number {
  return robotsCache.size;
}
