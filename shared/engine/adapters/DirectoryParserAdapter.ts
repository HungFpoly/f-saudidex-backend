/**
 * Directory Parser Adapter Interface
 *
 * Each directory site should have its own parser adapter.
 * This is much better than one universal AI prompt because:
 * - Different directories have different HTML structures
 * - Some have structured data (JSON-LD, microdata)
 * - Some have predictable URL patterns
 * - Some require authentication or special headers
 *
 * Usage:
 *   1. Create a new adapter implementing DirectoryParserAdapter
 *   2. Register it in the parser registry
 *   3. The discovery pipeline will use the best-matching adapter
 */

import { resolveUrl as resolveUrlUtil, canonicalizeUrl, cleanUrlForMatching } from '../../lib/urlCanonicalizer';

export interface ParsedCompany {
  name_en: string;
  name_ar?: string;
  website_url?: string;
  description_en?: string;
  description_ar?: string;
  logo_url?: string | null;
  cr_number?: string | null;
  phone?: string;
  email?: string;
  city?: string;
  categories?: string[];
  products?: string[];
  confidence_score: number;
  source_url: string;
  field_confidence?: Record<string, number>;
}

export interface ParseResult {
  companies: ParsedCompany[];
  totalFound: number;
  parseMethod: 'adapter' | 'ai-fallback';
  adapterName: string;
  warnings?: string[];
}

export interface DirectoryParserAdapter {
  /** Unique identifier for this adapter */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /**
   * Check if this adapter can handle the given directory URL.
   * Returns a confidence score (0-1). Return 0 if this adapter cannot handle it.
   * The URL is cleaned before matching (tracking params stripped).
   */
  matches(url: string): number;

  /**
   * Parse the directory page and extract companies.
   * @param html Raw HTML of the directory page
   * @param baseUrl The URL that was fetched
   * @returns ParseResult with extracted companies
   */
  parse(html: string, baseUrl: string): Promise<ParseResult>;

  /**
   * Optional: Extract additional pages to crawl for this directory.
   * Returns URLs that the adapter knows contain company listings.
   */
  discoverPagination?(html: string, baseUrl: string): string[];
}

/**
 * Parser Registry — manages all registered adapters.
 * Adapters are checked in priority order (highest match score wins).
 * URLs are cleaned before matching (tracking params stripped).
 */
export interface LazyAdapterMapping {
  id: string;
  name: string;
  pattern: RegExp;
  loader: () => Promise<any>;
}

class ParserRegistry {
  private adapters: DirectoryParserAdapter[] = [];
  private lazyAdapters: LazyAdapterMapping[] = [];

  register(adapter: DirectoryParserAdapter): void {
    // Prevent duplicate registrations
    if (this.adapters.find(a => a.id === adapter.id)) {
      console.warn(`Parser adapter "${adapter.id}" already registered, skipping.`);
      return;
    }
    this.adapters.push(adapter);
    console.log(`Registered parser adapter: ${adapter.name} (${adapter.id})`);
  }

  registerLazy(mapping: LazyAdapterMapping): void {
    this.lazyAdapters.push(mapping);
  }

  /**
   * Find the best-matching adapter for a given URL.
   * The URL is cleaned (tracking params stripped, www normalized) before matching.
   * Returns the adapter with highest match score, or null if none match.
   */
  async getAdapter(url: string): Promise<DirectoryParserAdapter | null> {
    // Clean URL before matching — strips tracking params, normalizes www
    const cleanUrl = cleanUrlForMatching(url);
    
    // Load any lazy adapters that match this URL's pattern
    const matchingLazy = this.lazyAdapters.filter(m => m.pattern.test(cleanUrl));
    for (const mapping of matchingLazy) {
      try {
        await mapping.loader();
        // Remove from lazy array so we don't load it twice
        this.lazyAdapters = this.lazyAdapters.filter(m => m.id !== mapping.id);
      } catch (e) {
        console.error(`Failed to load lazy adapter "${mapping.id}":`, e);
      }
    }

    let bestAdapter: DirectoryParserAdapter | null = null;
    let bestScore = 0;

    for (const adapter of this.adapters) {
      const score = adapter.matches(cleanUrl);
      if (score > bestScore) {
        bestScore = score;
        bestAdapter = adapter;
      }
    }

    return bestAdapter;
  }

  /** Get all registered adapters (for admin/debug purposes) */
  listAdapters(): { id: string; name: string }[] {
    const loaded = this.adapters.map(a => ({ id: a.id, name: a.name }));
    const lazy = this.lazyAdapters.map(a => ({ id: a.id, name: `${a.name} (lazy)` }));
    return [...loaded, ...lazy];
  }
}

export const parserRegistry = new ParserRegistry();

/**
 * Base adapter with common utilities.
 * Extend this class to create a new directory parser.
 */
export abstract class BaseDirectoryParser implements DirectoryParserAdapter {
  abstract readonly id: string;
  abstract readonly name: string;

  abstract matches(url: string): number;
  abstract parse(html: string, baseUrl: string): Promise<ParseResult>;

  /**
   * Helper: Resolve a relative URL against a base URL.
   * Returns the canonical (cleaned) absolute URL.
   */
  protected resolveUrl(relative: string, base: string): string {
    return resolveUrlUtil(relative, base);
  }

  /**
   * Helper: Clean and normalize a company name.
   */
  protected cleanName(name: string): string {
    return name
      .replace(/\s+/g, ' ')
      .replace(/[™®©]/g, '')
      .trim();
  }
}
