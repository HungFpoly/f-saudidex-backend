/**
 * B2B Portal Adapter
 *
 * Parses company listings from B2B directory portals.
 * These typically use card-based layouts with company cards containing
 * name, description, contact info, and categories.
 *
 * Example URLs:
 *   - https://www.saudiexporters.com/
 *   - https://www.kompass.com/en/saudi-arabia/
 *   - https://www.alibaba.com/trade/search?SearchText=saudi+arabia
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, parserRegistry } from './DirectoryParserAdapter';

export class B2BPortalAdapter extends BaseDirectoryParser {
  readonly id = 'b2b-portal';
  readonly name = 'B2B Directory Portal';

  /**
   * Match known B2B portal domains and generic directory paths.
   */
  matches(url: string): number {
    const lower = url.toLowerCase();

    // Specific B2B portal domains
    const knownPortals = [
      'saudiexporters.com',
      'saudibusiness.com',
      'sauditraders.com',
      'industry.com.sa',
      'kompass.com',
      'alibaba.com',
      'made-in-china.com',
      'globalsources.com',
      'ec21.com',
      'tradekey.com',
      'exportersindia.com',
      'saudiyellowpages.com',
      'saudibusinessdirectory.com'
    ];

    for (const portal of knownPortals) {
      if (lower.includes(portal)) {
        return 0.9;
      }
    }

    // Generic B2B directory patterns
    if (lower.includes('/companies/') || lower.includes('/suppliers/') ||
      lower.includes('/manufacturers/') || lower.includes('/vendors/') ||
      lower.includes('/business-directory')) {
      return 0.6;
    }

    return 0;
  }

  /**
   * Parse B2B portal HTML and extract company listings.
   * Tries multiple strategies based on common portal patterns.
   */
  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const companies = this.parseCardGrid($, baseUrl);

    if (companies.length > 0) {
      return {
        companies,
        totalFound: companies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    // Fallback: try list-based extraction
    const listCompanies = this.parseListItems($, baseUrl);
    if (listCompanies.length > 0) {
      return {
        companies: listCompanies,
        totalFound: listCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    return {
      companies: [],
      totalFound: 0,
      parseMethod: 'adapter',
      adapterName: this.name,
      warnings: ['No company listings found in B2B portal patterns']
    };
  }

  /**
   * Parse card-grid style listings (most common for B2B portals).
   * Pattern: <div class="company-card"> or similar with nested info.
   */
  private parseCardGrid($: cheerio.CheerioAPI, baseUrl: string) {
    const companies = [];

    // Common B2B portal card selectors
    const cardSelectors = [
      '.company-card', '.supplier-card', '.manufacturer-card',
      '.vendor-card', '.business-card', '.listing-card',
      '.company-item', '.supplier-item', '.manufacturer-item',
      '.company-listing', '.supplier-listing', '.manufacturer-listing',
      '.result-item', '.search-result', '.company-result',
      '.company-box', '.supplier-box', '.manufacturer-box',
      '[class*="company"][class*="card"]', '[class*="supplier"][class*="card"]',
      '.col-company', '.company-col'
    ];

    for (const selector of cardSelectors) {
      const $cards = $(selector);
      if ($cards.length === 0) continue;

      $cards.each((_, card) => {
        const company = this.extractCompanyFromCard($, card, baseUrl);
        if (company) {
          companies.push(company);
        }
      });

      if (companies.length > 0) break; // Found matches with this selector
    }

    return companies;
  }

  /**
   * Extract company data from a single card element.
   */
  private extractCompanyFromCard($: cheerio.CheerioAPI, card: any, baseUrl: string) {
    const $card = $(card);

    // Extract company name
    const nameSelectors = ['h2 a', 'h3 a', 'h2', 'h3', 'h4', '.company-name', '.supplier-name', '.title a', '.title'];
    let nameText = '';
    let nameLink = '';

    for (const selector of nameSelectors) {
      const $el = $card.find(selector).first();
      if ($el.length) {
        nameText = $el.text().trim();
        nameLink = $el.attr('href') || $el.find('a').attr('href') || '';
        if (nameText) break;
      }
    }

    if (!nameText || nameText.length < 2) return null;

    // Extract description
    const descSelectors = ['.description', '.company-desc', '.supplier-desc', '.summary', '.excerpt', 'p.description', '.text-muted'];
    let description = '';
    for (const selector of descSelectors) {
      const text = $card.find(selector).first().text().trim();
      if (text && text.length > 10) {
        description = text;
        break;
      }
    }

    // Extract website URL
    const websiteSelectors = ['.website a', '.company-url a', '.url a', 'a.external-link'];
    let websiteUrl = '';
    for (const selector of websiteSelectors) {
      const href = $card.find(selector).attr('href');
      if (href && href.match(/^https?:\/\//)) {
        websiteUrl = href;
        break;
      }
    }

    // Use name link as fallback for website
    if (!websiteUrl && nameLink) {
      websiteUrl = this.resolveUrl(nameLink, baseUrl);
    }

    // Extract location/city
    const locationSelectors = ['.location', '.city', '.country', '.address', '[class*="location"]', '.place'];
    let city = '';
    for (const selector of locationSelectors) {
      const text = $card.find(selector).first().text().trim();
      if (text) {
        city = text;
        break;
      }
    }

    // Extract categories/tags
    const categories: string[] = [];
    $card.find('.category, .tag, .industry, .sector, [class*="category"] a, [class*="tag"] a').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 50) {
        categories.push(text);
      }
    });

    // Extract products
    const products: string[] = [];
    $card.find('.product, .products a, [class*="product"] a').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 100) {
        products.push(text);
      }
    });

    return {
      name_en: this.cleanName(nameText),
      website_url: websiteUrl || undefined,
      description_en: description || undefined,
      city: city || undefined,
      categories: categories.length > 0 ? categories : undefined,
      products: products.length > 0 ? products : undefined,
      confidence_score: 0.5,
      source_url: baseUrl,
      field_confidence: {
        name_en: 0.8,
        name_ar: 0.1,
        website_url: websiteUrl ? 0.7 : 0.3,
        description_en: description ? 0.6 : 0.2,
        phone: 0.1,
        email: 0.1,
        city: city ? 0.5 : 0.2
      }
    };
  }

  /**
   * Parse list-style listings (alternative pattern for some portals).
   * Pattern: <ul><li>Company info</li></ul> or <div class="list-item">
   */
  private parseListItems($: cheerio.CheerioAPI, baseUrl: string) {
    const companies = [];

    const listSelectors = [
      '.company-list li', '.supplier-list li', '.business-list li',
      '.directory-list li', '.result-list li', '.search-list li',
      '.list-item.company', '.list-item.supplier'
    ];

    for (const selector of listSelectors) {
      const $items = $(selector);
      if ($items.length === 0) continue;

      $items.each((_, item) => {
        const $item = $(item);
        const nameEl = $item.find('a').first();
        const nameText = nameEl.text().trim();
        const nameLink = nameEl.attr('href') || '';

        if (!nameText || nameText.length < 2) return;

        const descText = $item.find('.description, .summary, p').first().text().trim();

        companies.push({
          name_en: this.cleanName(nameText),
          website_url: nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined,
          description_en: descText || undefined,
          confidence_score: 0.4,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.7,
            name_ar: 0.1,
            website_url: nameLink ? 0.5 : 0.2,
            description_en: descText ? 0.5 : 0.2,
            phone: 0.1,
            email: 0.1,
            city: 0.2
          }
        });
      });

      if (companies.length > 0) break;
    }

    return companies;
  }

  /**
   * Discover pagination URLs from B2B portal pages.
   */
  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    // Common B2B portal pagination patterns
    const paginationSelectors = [
      '.pagination a',
      '.pager a',
      '.page-numbers a',
      '.wp-pagenavi a',
      '.pagination-next a',
      '.next-page a',
      'a[rel="next"]',
      '[class*="page"][class*="next"] a',
      '.load-more[data-url]'
    ];

    for (const selector of paginationSelectors) {
      $(selector).each((_, el) => {
        const href = $(el).attr('href');
        const dataUrl = $(el).attr('data-url');
        const url = href || dataUrl;
        if (url) {
          urls.push(this.resolveUrl(url, baseUrl));
        }
      });
    }

    return [...new Set(urls)];
  }
}

// Auto-register
parserRegistry.register(new B2BPortalAdapter());
