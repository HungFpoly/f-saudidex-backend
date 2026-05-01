/**
 * Generic Directory HTML Parser — Deterministic Fallback
 *
 * Parses company listings from unknown directory sites using common HTML patterns.
 * This is a DETERMINISTIC parser — no AI calls needed.
 *
 * Strategies (tried in order):
 * 1. JSON-LD structured data (Organization listings)
 * 2. Common card grid patterns (.card, .listing, .company-item)
 * 3. Table-based directory listings
 * 4. List items with links (ul/ol > li > a)
 * 5. Definition lists (dl/dt/dd patterns)
 *
 * This parser is registered with LOW priority (0.05) — below all site-specific adapters
 * but ABOVE UniversalAIParser (0.02). This ensures deterministic parsing is always
 * attempted BEFORE falling back to AI.
 *
 * Usage: Automatically selected by parserRegistry when no other adapter matches.
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, ParsedCompany, parserRegistry } from './DirectoryParserAdapter';

export class GenericDirectoryParser extends BaseDirectoryParser {
  readonly id = 'generic-directory';
  readonly name = 'Generic Directory HTML Parser (Deterministic Fallback)';

  /**
   * Match any HTTP/HTTPS URL but with the LOWEST confidence.
   * This ensures it's tried after all real adapters but BEFORE UniversalAIParser.
   */
  matches(url: string): number {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return 0.05; // ABOVE UniversalAIParser (0.02) — deterministic first, AI later
    }
    return 0;
  }

  /**
   * Parse using deterministic HTML pattern matching.
   * No AI calls — pure Cheerio DOM extraction.
   */
  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const companies: ParsedCompany[] = [];
    const warnings: string[] = [];

    // Strategy 1: JSON-LD structured data (highest confidence)
    const jsonLdCompanies = this.parseJsonLd($, baseUrl);
    if (jsonLdCompanies.length > 0) {
      return {
        companies: jsonLdCompanies,
        totalFound: jsonLdCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name,
      };
    }

    // Strategy 2: Common card grid patterns
    const cardCompanies = this.parseCardGrid($, baseUrl);
    if (cardCompanies.length > 0) {
      return {
        companies: cardCompanies,
        totalFound: cardCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name,
      };
    }

    // Strategy 3: Table-based directory listings
    const tableCompanies = this.parseTableListings($, baseUrl);
    if (tableCompanies.length > 0) {
      return {
        companies: tableCompanies,
        totalFound: tableCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name,
      };
    }

    // Strategy 4: List items with links
    const listCompanies = this.parseListItems($, baseUrl);
    if (listCompanies.length > 0) {
      return {
        companies: listCompanies,
        totalFound: listCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name,
      };
    }

    // Strategy 5: Definition list patterns (dl/dt/dd)
    const dlCompanies = this.parseDefinitionLists($, baseUrl);
    if (dlCompanies.length > 0) {
      return {
        companies: dlCompanies,
        totalFound: dlCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name,
      };
    }

    // No companies found with any strategy
    warnings.push('No directory listing patterns detected (cards, tables, lists, JSON-LD, definition lists)');

    return {
      companies: [],
      totalFound: 0,
      parseMethod: 'adapter',
      adapterName: this.name,
      warnings,
    };
  }

  // ─── Strategy 1: JSON-LD ──────────────────────────────────────

  private parseJsonLd($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).html();
        if (!raw) return;

        // Could be a single object or an array (or an array wrapped in @graph)
        const data = JSON.parse(raw);

        const items = Array.isArray(data)
          ? data
          : data['@graph'] && Array.isArray(data['@graph'])
            ? data['@graph']
            : [data];

        for (const item of items) {
          const type = item['@type'] || '';
          if (!type.toLowerCase().includes('organization') && !type.toLowerCase().includes('business')) continue;

          const name = item.name || item.legalName || item.alternateName;
          if (!name || typeof name !== 'string') continue;

          const url = item.url || '';
          companies.push({
            name_en: this.cleanName(name),
            website_url: url ? this.resolveUrl(url, baseUrl) : undefined,
            description_en: item.description || undefined,
            phone: item.telephone || undefined,
            email: item.email || undefined,
            confidence_score: 0.85,
            source_url: baseUrl,
            field_confidence: {
              name_en: 0.95,
              website_url: url ? 0.9 : 0,
              description_en: item.description ? 0.8 : 0,
              phone: item.telephone ? 0.9 : 0,
              email: item.email ? 0.9 : 0,
            },
          });
        }
      } catch {
        // Skip invalid JSON
      }
    });

    return companies;
  }

  // ─── Strategy 2: Card Grid ─────────────────────────────────────

  private parseCardGrid($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    // Common card selectors for directory listings
    const cardSelectors = [
      '.card', '.listing', '.company-item', '.company-card', '.result',
      '.entry', '.directory-item', '.business-card', '.vendor-card',
      '.supplier-card', '.partner-card', '.item-card', '.listing-card',
      '[class*="company"]', '[class*="listing"]', '[class*="vendor"]',
      '[class*="supplier"]', '[class*="business"]', '[class*="directory"]',
    ];

    for (const selector of cardSelectors) {
      if (companies.length > 0) break;

      $(selector).each((_, el) => {
        const $el = $(el);

        // Try to find company name in heading or named element
        const nameEl = $el.find('h1, h2, h3, h4, .name, .title, .company-name, .business-name, [class*="name"]').first();
        let name = nameEl.text().trim();

        // If no heading found, try the card's text content (first non-empty line)
        if (!name) {
          name = $el.text().trim().split('\n').map(l => l.trim()).find(l => l.length > 2) || '';
        }

        if (!name || name.length < 2 || name.length > 200) return;

        // Skip if it looks like navigation (Home, Contact, About, etc.)
        const skipWords = ['home', 'about', 'contact', 'login', 'register', 'signup', 'sign up', 'search', 'cart', 'menu', 'footer', 'header', 'privacy', 'terms'];
        if (skipWords.includes(name.toLowerCase())) return;

        // Find link to company page
        const linkEl = $el.find('a[href]').first();
        const href = linkEl.attr('href') || '';
        const websiteUrl = href ? this.resolveUrl(href, baseUrl) : undefined;

        // Try to find contact info within the card
        const phone = this.extractPhoneFromText($el.text());
        const email = this.extractEmailFromText($el.text());

        companies.push({
          name_en: this.cleanName(name),
          website_url: websiteUrl,
          phone,
          email,
          confidence_score: 0.5,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.6,
            website_url: websiteUrl ? 0.5 : 0,
            phone: phone ? 0.6 : 0,
            email: email ? 0.6 : 0,
          },
        });
      });
    }

    return companies;
  }

  // ─── Strategy 3: Table Listings ────────────────────────────────

  private parseTableListings($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    $('table').each((_, table) => {
      const $table = $(table);

      // Skip tables that look like navigation or layout
      const tableText = $table.text().trim().toLowerCase();
      if (tableText.includes('navigation') || tableText.includes('footer')) return;

      // Check if table has meaningful data (more than just headers)
      const dataRows = $table.find('tbody tr, tr');
      if (dataRows.length < 2) return;

      dataRows.each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td, th');

        if (cells.length === 0) return;

        // First cell is typically the company name
        const firstCell = cells.first();
        let name = firstCell.text().trim();

        if (!name || name.length < 2 || name.length > 200) return;

        // Skip header-like content
        const skipWords = ['company', 'name', 'sr.', 'no.', '#', 'id', 'action'];
        if (skipWords.includes(name.toLowerCase())) return;

        // Find link in first cell
        const link = firstCell.find('a[href]').first();
        const href = link.attr('href') || '';
        const websiteUrl = href ? this.resolveUrl(href, baseUrl) : undefined;

        // If no link text but cell has text, use cell text
        const linkText = link.text().trim();
        if (linkText && linkText.length > 1) {
          name = linkText;
        }

        companies.push({
          name_en: this.cleanName(name),
          website_url: websiteUrl,
          confidence_score: 0.4,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.5,
            website_url: websiteUrl ? 0.5 : 0,
          },
        });
      });
    });

    return companies;
  }

  // ─── Strategy 4: List Items ────────────────────────────────────

  private parseListItems($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    // Look for ul/ol with multiple li > a elements
    $('ul, ol').each((_, list) => {
      const $list = $(list);
      const items = $list.find('li');

      // Need at least 3 items to be a directory list (not nav menu)
      if (items.length < 3) return;

      // Check if majority of items have links
      const linkedItems = items.filter((_, li) => $(li).find('a[href]').length > 0);
      if (linkedItems.length < items.length * 0.5) return;

      items.each((_, li) => {
        const $li = $(li);
        const link = $li.find('a[href]').first();
        const name = link.text().trim();
        const href = link.attr('href') || '';

        if (!name || name.length < 2 || name.length > 200) return;

        // Skip nav-like words
        const skipWords = ['home', 'about', 'contact', 'login', 'register', 'search', 'sitemap', 'privacy', 'terms'];
        if (skipWords.includes(name.toLowerCase())) return;

        companies.push({
          name_en: this.cleanName(name),
          website_url: href ? this.resolveUrl(href, baseUrl) : undefined,
          confidence_score: 0.35,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.5,
            website_url: href ? 0.4 : 0,
          },
        });
      });
    });

    return companies;
  }

  // ─── Strategy 5: Definition Lists ──────────────────────────────

  private parseDefinitionLists($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    $('dl').each((_, dl) => {
      const $dl = $(dl);
      const terms = $dl.find('dt');

      if (terms.length < 2) return;

      terms.each((_, dt) => {
        const $dt = $(dt);
        const link = $dt.find('a[href]').first();
        const name = (link.length ? link.text() : $dt.text()).trim();

        if (!name || name.length < 2 || name.length > 200) return;

        const href = link.attr('href') || '';
        const websiteUrl = href ? this.resolveUrl(href, baseUrl) : undefined;

        companies.push({
          name_en: this.cleanName(name),
          website_url: websiteUrl,
          confidence_score: 0.3,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.4,
            website_url: websiteUrl ? 0.4 : 0,
          },
        });
      });
    });

    return companies;
  }

  // ─── Utility Extractors ────────────────────────────────────────

  private extractPhoneFromText(text: string): string | undefined {
    // Match common phone patterns
    const phonePatterns = [
      /(\+[\d\s\-()]{7,20})/,       // International format
      /([\d\s\-()]{7,15})/,          // Local format
    ];

    for (const pattern of phonePatterns) {
      const match = text.match(pattern);
      if (match) {
        const phone = match[1].trim();
        const cleanPhone = phone.replace(/[\s\-()]/g, '');
        if (cleanPhone.length >= 7 && cleanPhone.length <= 15 && /^\+?\d+$/.test(cleanPhone)) {
          return phone;
        }
      }
    }

    return undefined;
  }

  private extractEmailFromText(text: string): string | undefined {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(emailRegex);

    if (matches && matches.length > 0) {
      // Filter out common false positives
      const valid = matches.find(e =>
        !e.includes('placeholder') &&
        !e.includes('example.com') &&
        e.length > 5
      );
      return valid || undefined;
    }

    return undefined;
  }
}

// Register with LOW priority — below all site-specific adapters but ABOVE UniversalAIParser (0.02)
// This ensures deterministic parsing is always attempted before AI
parserRegistry.register(new GenericDirectoryParser());
