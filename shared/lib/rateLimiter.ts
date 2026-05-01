/**
 * Rate Limiter for Crawling
 *
 * Responsible for:
 * - Enforcing per-domain delays between requests
 * - Preventing IP bans from aggressive crawling
 * - Respecting robots.txt Crawl-delay directives
 * - Supporting configurable rate limits per domain
 *
 * This module MUST be consulted before any HTTP fetch or browser crawl.
 */

export interface RateLimitConfig {
  /** Minimum delay between requests to the same domain (ms) */
  minDelayMs?: number;
  /** Maximum delay between requests to the same domain (ms) */
  maxDelayMs?: number;
  /** Whether to use random jitter within the delay range */
  useJitter?: boolean;
  /** Maximum concurrent requests per domain */
  maxConcurrentPerDomain?: number;
  /** Global maximum concurrent requests */
  maxConcurrentGlobal?: number;
}

const DEFAULT_CONFIG: Required<RateLimitConfig> = {
  minDelayMs: 2000,
  maxDelayMs: 5000,
  useJitter: true,
  maxConcurrentPerDomain: 1,
  maxConcurrentGlobal: 3,
};

interface DomainState {
  lastRequestAt: number;
  activeRequests: number;
  customDelayMs?: number;
}

// Per-domain rate limit state
const domainStates = new Map<string, DomainState>();

// Global concurrency counter
let globalActiveRequests = 0;

// Configuration
let config: Required<RateLimitConfig>;

/**
 * Initialize the rate limiter with custom configuration.
 * Should be called once at application startup.
 */
export function initRateLimiter(userConfig: RateLimitConfig = {}): void {
  config = { ...DEFAULT_CONFIG, ...userConfig };
}

// Initialize with defaults on module load
initRateLimiter();

/**
 * Wait until it's safe to make a request to the given domain.
 * Respects the minimum delay and any custom delay set for the domain.
 *
 * Call this BEFORE every fetch/crawl request.
 */
export async function waitForSlot(domain: string): Promise<void> {
  const state = getOrCreateDomainState(domain);

  // Wait for domain-specific delay
  const now = Date.now();
  const delayMs = state.customDelayMs || config.minDelayMs;
  const elapsed = now - state.lastRequestAt;

  if (elapsed < delayMs) {
    const waitTime = delayMs - elapsed;
    await sleep(waitTime);
  }

  // Check domain concurrency limit
  while (state.activeRequests >= config.maxConcurrentPerDomain) {
    await sleep(100);
  }

  // Check global concurrency limit
  while (globalActiveRequests >= config.maxConcurrentGlobal) {
    await sleep(100);
  }

  // Reserve the slot
  state.activeRequests++;
  globalActiveRequests++;
  state.lastRequestAt = Date.now();
}

/**
 * Release a slot after a request completes (success or failure).
 * Call this AFTER every fetch/crawl request.
 */
export function releaseSlot(domain: string): void {
  const state = domainStates.get(domain);
  if (state && state.activeRequests > 0) {
    state.activeRequests--;
  }
  if (globalActiveRequests > 0) {
    globalActiveRequests--;
  }
}

/**
 * Convenience wrapper that handles slot reservation and release automatically.
 *
 * Usage:
 *   await withRateLimit('example.com', async () => {
 *     return fetch('https://example.com/page');
 *   });
 */
export async function withRateLimit<T>(
  domain: string,
  fn: () => Promise<T>
): Promise<T> {
  await waitForSlot(domain);
  try {
    return await fn();
  } finally {
    releaseSlot(domain);
  }
}

/**
 * Set a custom delay for a specific domain.
 * Useful for sites that are sensitive to crawling or have strict rate limits.
 */
export function setDomainDelay(domain: string, delayMs: number): void {
  const state = getOrCreateDomainState(domain);
  state.customDelayMs = delayMs;
}

/**
 * Set a custom delay based on a robots.txt Crawl-delay directive.
 */
export function setRobotsCrawlDelay(domain: string, delaySeconds: number): void {
  setDomainDelay(domain, delaySeconds * 1000);
}

/**
 * Get the current effective delay for a domain.
 */
export function getDomainDelay(domain: string): number {
  const state = domainStates.get(domain);
  if (state?.customDelayMs) return state.customDelayMs;
  return config.minDelayMs;
}

/**
 * Get rate limiter statistics.
 */
export function getRateLimiterStats(): {
  totalDomains: number;
  globalActiveRequests: number;
  domains: Record<string, { activeRequests: number; lastRequestAt: number; delayMs: number }>;
} {
  const domains: Record<string, { activeRequests: number; lastRequestAt: number; delayMs: number }> = {};

  for (const [domain, state] of domainStates.entries()) {
    domains[domain] = {
      activeRequests: state.activeRequests,
      lastRequestAt: state.lastRequestAt,
      delayMs: state.customDelayMs || config.minDelayMs,
    };
  }

  return {
    totalDomains: domainStates.size,
    globalActiveRequests,
    domains,
  };
}

/**
 * Reset all rate limiter state.
 * Useful for testing or after a major configuration change.
 */
export function resetRateLimiter(): void {
  domainStates.clear();
  globalActiveRequests = 0;
}

/**
 * Exponential backoff calculation for retries.
 * Returns the delay in milliseconds for a given retry attempt.
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 60000
): number {
  // Exponential backoff with jitter
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * exponential * 0.5;
  return Math.min(exponential + jitter, maxDelayMs);
}

/**
 * Method-level rate limiter HOF.
 * 
 * Usage:
 *   const throttledFn = rateLimiter({ windowMs: 60000, max: 5 })(async () => { ... });
 */
export function rateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
}) {
  const hits = new Map<string, { count: number; expiresAt: number }>();

  return <T extends (...args: any[]) => Promise<any>>(fn: T): T => {
    return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      const now = Date.now();
      const key = 'global'; // In browser, we use a global key since we don't have per-IP tracking easily
      
      const state = hits.get(key);
      if (state && state.expiresAt > now) {
        if (state.count >= options.max) {
          throw new Error(options.message || 'Too many requests, please try again later');
        }
        state.count++;
      } else {
        hits.set(key, { count: 1, expiresAt: now + options.windowMs });
      }

      return fn(...args);
    }) as any;
  };
}

// ─── Internal helpers ─────────────────────────────────────────────

function getOrCreateDomainState(domain: string): DomainState {
  if (!domainStates.has(domain)) {
    domainStates.set(domain, {
      lastRequestAt: 0,
      activeRequests: 0,
    });
  }
  return domainStates.get(domain)!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract domain from a URL string.
 */
export function extractDomainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
