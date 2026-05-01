import { BaseDirectoryParser, ParseResult, parserRegistry } from './DirectoryParserAdapter';

/**
 * Universal AI Parser — Default Fallback Adapter
 *
 * This adapter uses AI to parse any directory page.
 * It's the fallback when no source-specific adapter matches.
 *
 * To create a source-specific adapter:
 * 1. Extend BaseDirectoryParser
 * 2. Implement matches() with URL patterns for your directory
 * 3. Implement parse() with Cheerio selectors for your directory's HTML structure
 * 4. Register with parserRegistry.register(new YourAdapter())
 */
export class UniversalAIParser extends BaseDirectoryParser {
  readonly id = 'universal-ai';
  readonly name = 'Universal AI Parser (Fallback)';

  /**
   * This adapter matches any HTTP/HTTPS URL — but with the LOWEST confidence.
   * It is the absolute last resort AFTER all deterministic parsers have failed.
   *
   * Match priority:
   *   - Specific adapters (SaudiChamber, B2BPortal, etc.): 0.7 - 0.95
   *   - GenericDirectoryParser (deterministic HTML patterns): 0.05
   *   - UniversalAIParser (AI extraction): 0.02 — BELOW deterministic
   *
   * This ensures deterministic parsing is ALWAYS attempted before AI.
   */
  matches(url: string): number {
    // Only match http/https URLs — not local files or data URIs
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return 0.02; // BELOW GenericDirectoryParser (0.05) — AI is absolute last resort
    }
    return 0;
  }

  /**
   * Parse using AI extraction.
   * The actual AI parsing happens server-side via /api/discover.
   * This adapter serves as a marker that AI parsing should be used.
   */
  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    // This adapter doesn't do client-side parsing — it signals
    // that the server-side AI pipeline should handle extraction.
    return {
      companies: [],
      totalFound: 0,
      parseMethod: 'ai-fallback',
      adapterName: this.name,
      warnings: ['No source-specific adapter found — using AI extraction']
    };
  }

  /**
   * Discover pagination links from the directory page.
   * Looks for common pagination patterns: "Next", page numbers, etc.
   */
  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];

    // Match common pagination patterns
    const patterns = [
      /href=["']([^"']*page[=/]?\d+)["']/gi,
      /href=["']([^"']*\?page=\d+)["']/gi,
      /href=["']([^"']*\/p\/\d+)["']/gi,
      /href=["']([^"']*\?offset=\d+)["']/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        urls.push(this.resolveUrl(match[1], baseUrl));
      }
    }

    return [...new Set(urls)]; // Deduplicate
  }
}

// Register the universal adapter as the default fallback
parserRegistry.register(new UniversalAIParser());
