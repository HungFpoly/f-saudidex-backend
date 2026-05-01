/**
 * Saudi Industry Guide Adapter
 *
 * Parses company listings from saudiindustryguide.com
 * An industry-focused directory with categorized company listings.
 *
 * URL: https://saudiindustryguide.com/
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, parserRegistry } from './DirectoryParserAdapter';

export class SaudiIndustryGuideAdapter extends BaseDirectoryParser {
  readonly id = 'saudi-industry-guide';
  readonly name = 'Saudi Industry Guide';

  matches(url: string): number {
    return url.includes('saudiindustryguide.com') ? 0.95 : 0;
  }

  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const companies = this.parseCompanyListings($, baseUrl);

    if (companies.length > 0) {
      return {
        companies,
        totalFound: companies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    return {
      companies: [],
      totalFound: 0,
      parseMethod: 'adapter',
      adapterName: this.name,
      warnings: ['No company listings found in Saudi Industry Guide patterns']
    };
  }

  /**
   * Parse company listings from the industry guide.
   * Typically uses a grid of company cards with category tags.
   */
  private parseCompanyListings($: cheerio.CheerioAPI, baseUrl: string) {
    const companies = [];

    // Common selectors for industry guide company cards
    const cardSelectors = [
      '.company-card', '.industry-card', '.manufacturer-card',
      '.supplier-card', '.business-listing', '.company-listing',
      '.company-item', '.listing-item', '.result-item',
      '.company-box', '.business-box',
      '.col-md-4 .company', '.col-md-3 .company',
      '[class*="company"][class*="card"]', '[class*="industry"][class*="card"]'
    ];

    for (const selector of cardSelectors) {
      const $cards = $(selector);
      if ($cards.length === 0) continue;

      $cards.each((_, card) => {
        const $card = $(card);

        // Extract company name
        const nameSelectors = ['h3 a', 'h2 a', 'h4 a', 'h3', 'h2', 'h4', '.company-name', '.title a', '.title'];
        let nameText = '';
        let nameLink = '';

        for (const sel of nameSelectors) {
          const $el = $card.find(sel).first();
          if ($el.length) {
            nameText = $el.text().trim();
            nameLink = $el.attr('href') || $el.find('a').attr('href') || '';
            if (nameText) break;
          }
        }

        if (!nameText || nameText.length < 2) return;

        // Extract description
        const descText = $card.find('.description, .company-desc, .summary, .excerpt, p').first().text().trim();

        // Extract website/contact
        const websiteLink = $card.find('.website a, .company-url a, a.external-link').attr('href');

        // Extract category/industry tags
        const categories: string[] = [];
        $card.find('.category, .tag, .industry, .sector a, .category a, .tag a, .industry a').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length > 1 && text.length < 50) {
            categories.push(text);
          }
        });

        // Extract location
        const locationText = $card.find('.location, .city, .address, .country').first().text().trim();

        // Extract products
        const products: string[] = [];
        $card.find('.product, .products a, [class*="product"] a').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length > 1 && text.length < 100) {
            products.push(text);
          }
        });

        companies.push({
          name_en: this.cleanName(nameText),
          website_url: websiteLink ? this.resolveUrl(websiteLink, baseUrl) : (nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined),
          description_en: descText || undefined,
          city: locationText || undefined,
          categories: categories.length > 0 ? categories : undefined,
          products: products.length > 0 ? products : undefined,
          confidence_score: 0.6,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.85,
            name_ar: 0.2,
            website_url: websiteLink ? 0.7 : (nameLink ? 0.4 : 0.2),
            description_en: descText ? 0.6 : 0.2,
            phone: 0.2,
            email: 0.2,
            city: locationText ? 0.5 : 0.2
          }
        });
      });

      if (companies.length > 0) break;
    }

    // Fallback: try table-based listings
    if (companies.length === 0) {
      $('table').each((_, table) => {
        const $table = $(table);
        const tableId = $table.attr('id') || '';
        const tableClass = $table.attr('class') || '';

        if (!tableId.includes('company') && !tableId.includes('industry') &&
            !tableId.includes('manufacturer') && !tableClass.includes('company') &&
            !tableClass.includes('industry')) {
          return;
        }

        $table.find('tr').each((i, row) => {
          if (i === 0) return; // Skip header
          const $cells = $(row).find('td');
          if ($cells.length < 2) return;

          const nameText = $cells.eq(0).text().trim();
          if (!nameText) return;

          const nameLink = $cells.eq(0).find('a').attr('href');

          companies.push({
            name_en: this.cleanName(nameText),
            website_url: nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined,
            confidence_score: 0.5,
            source_url: baseUrl,
            field_confidence: {
              name_en: 0.8,
              name_ar: 0.2,
              website_url: nameLink ? 0.6 : 0.2,
              description_en: 0.2,
              phone: 0.2,
              email: 0.2,
              city: 0.2
            }
          });
        });
      });
    }

    return companies;
  }

  /**
   * Discover pagination URLs.
   */
  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    $('.pagination a, .pager a, .page-numbers a, .next a, a[rel="next"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) urls.push(this.resolveUrl(href, baseUrl));
    });

    return [...new Set(urls)];
  }
}

parserRegistry.register(new SaudiIndustryGuideAdapter());
