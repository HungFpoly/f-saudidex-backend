/**
 * Seed Manager
 *
 * Responsible for:
 * - Loading directory URLs from various sources
 * - Handling pagination seeds
 * - Tagging source type (chamber, b2b-portal, gov-registry, etc.)
 * - Avoiding duplicate seed runs
 * - Tracking seed processing status
 */

import { extractDomain, canonicalizeUrl, isValidUrl } from './urlCanonicalizer';

export type SeedSourceType =
  | 'manual'
  | 'adapter-discovered'
  | 'admin-added'
  | 'imported'
  | 'auto-discovered';

export type SeedStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface SeedEntry {
  id: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  sourceType: SeedSourceType;
  status: SeedStatus;
  tags: string[];
  depth: number;
  maxDepth: number;
  addedAt: string;
  processedAt?: string;
  error?: string;
  companiesFound?: number;
  pagesScraped?: number;
  metadata?: Record<string, unknown>;
}

export interface SeedConfig {
  defaultMaxDepth?: number;
  allowDuplicates?: boolean;
  autoTagByDomain?: boolean;
}

const DEFAULT_CONFIG: SeedConfig = {
  defaultMaxDepth: 2,
  allowDuplicates: false,
  autoTagByDomain: true
};

export class SeedManager {
  private seeds: Map<string, SeedEntry> = new Map();
  private config: SeedConfig;

  constructor(config: SeedConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a single URL seed.
   */
  addSeed(
    url: string,
    sourceType: SeedSourceType = 'manual',
    options: { tags?: string[]; depth?: number; maxDepth?: number; metadata?: Record<string, unknown> } = {}
  ): SeedEntry | null {
    if (!isValidUrl(url)) {
      console.warn(`Invalid URL, skipping: ${url}`);
      return null;
    }

    const canonicalUrl = canonicalizeUrl(url) || url;
    const domain = extractDomain(canonicalUrl) || '';

    // Check for duplicates
    if (!this.config.allowDuplicates && this.seeds.has(canonicalUrl)) {
      return this.seeds.get(canonicalUrl) || null;
    }

    // Auto-tag by domain if enabled
    const tags = options.tags || [];
    if (this.config.autoTagByDomain && domain) {
      // Tag by source type
      if (domain.includes('chamber')) tags.push('chamber');
      if (domain.includes('gov.sa')) tags.push('government');
      if (domain.includes('mcci')) tags.push('chamber');
      if (domain.includes('cybo')) tags.push('b2b-portal');
      if (domain.includes('bizmideast')) tags.push('b2b-portal');
      if (domain.includes('ksa.directory') || domain.includes('saudidir')) tags.push('saudi-directory');
      if (domain.includes('saudiindustryguide')) tags.push('industry-guide');
    }

    const entry: SeedEntry = {
      id: `seed-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      url,
      canonicalUrl,
      domain,
      sourceType,
      status: 'pending',
      tags: [...new Set(tags)],
      depth: options.depth || 0,
      maxDepth: options.maxDepth || this.config.defaultMaxDepth || 2,
      addedAt: new Date().toISOString(),
      metadata: options.metadata
    };

    this.seeds.set(canonicalUrl, entry);
    return entry;
  }

  /**
   * Add multiple URLs at once.
   */
  addSeeds(
    urls: string[],
    sourceType: SeedSourceType = 'manual',
    options: { tags?: string[]; depth?: number; maxDepth?: number } = {}
  ): SeedEntry[] {
    const entries: SeedEntry[] = [];
    for (const url of urls) {
      const entry = this.addSeed(url, sourceType, options);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /**
   * Get all pending seeds.
   */
  getPendingSeeds(): SeedEntry[] {
    return Array.from(this.seeds.values()).filter(s => s.status === 'pending');
  }

  /**
   * Get seeds by status.
   */
  getSeedsByStatus(status: SeedStatus): SeedEntry[] {
    return Array.from(this.seeds.values()).filter(s => s.status === status);
  }

  /**
   * Get all seeds.
   */
  getAllSeeds(): SeedEntry[] {
    return Array.from(this.seeds.values());
  }

  /**
   * Mark a seed as processing.
   */
  startProcessing(canonicalUrl: string): SeedEntry | null {
    const seed = this.seeds.get(canonicalUrl);
    if (seed) {
      seed.status = 'processing';
    }
    return seed || null;
  }

  /**
   * Mark a seed as completed with results.
   */
  completeProcessing(canonicalUrl: string, results: { companiesFound?: number; pagesScraped?: number }): SeedEntry | null {
    const seed = this.seeds.get(canonicalUrl);
    if (seed) {
      seed.status = 'completed';
      seed.processedAt = new Date().toISOString();
      seed.companiesFound = results.companiesFound;
      seed.pagesScraped = results.pagesScraped;
    }
    return seed || null;
  }

  /**
   * Mark a seed as failed.
   */
  markFailed(canonicalUrl: string, error: string): SeedEntry | null {
    const seed = this.seeds.get(canonicalUrl);
    if (seed) {
      seed.status = 'failed';
      seed.error = error;
      seed.processedAt = new Date().toISOString();
    }
    return seed || null;
  }

  /**
   * Check if a URL is already in the seed list.
   */
  hasSeed(url: string): boolean {
    const canonical = canonicalizeUrl(url);
    return canonical ? this.seeds.has(canonical) : false;
  }

  /**
   * Get seed by URL.
   */
  getSeed(url: string): SeedEntry | null {
    const canonical = canonicalizeUrl(url);
    return canonical ? this.seeds.get(canonical) || null : null;
  }

  /**
   * Remove a seed.
   */
  removeSeed(canonicalUrl: string): boolean {
    return this.seeds.delete(canonicalUrl);
  }

  /**
   * Clear all seeds.
   */
  clear(): void {
    this.seeds.clear();
  }

  /**
   * Get statistics about the seed list.
   */
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    skipped: number;
    totalCompaniesFound: number;
    totalPagesScraped: number;
    uniqueDomains: number;
  } {
    const allSeeds = this.getAllSeeds();
    const completed = this.getSeedsByStatus('completed');

    return {
      total: allSeeds.length,
      pending: this.getSeedsByStatus('pending').length,
      processing: this.getSeedsByStatus('processing').length,
      completed: completed.length,
      failed: this.getSeedsByStatus('failed').length,
      skipped: this.getSeedsByStatus('skipped').length,
      totalCompaniesFound: completed.reduce((sum, s) => sum + (s.companiesFound || 0), 0),
      totalPagesScraped: completed.reduce((sum, s) => sum + (s.pagesScraped || 0), 0),
      uniqueDomains: new Set(allSeeds.map(s => s.domain)).size
    };
  }

  /**
   * Export seeds as JSON-serializable array.
   */
  export(): Record<string, unknown>[] {
    return this.getAllSeeds().map(s => ({ ...s }));
  }

  /**
   * Import seeds from a JSON array.
   */
  import(seeds: Record<string, unknown>[]): void {
    for (const data of seeds) {
      if (data.url && data.canonicalUrl) {
        this.seeds.set(data.canonicalUrl as string, data as unknown as SeedEntry);
      }
    }
  }
}
