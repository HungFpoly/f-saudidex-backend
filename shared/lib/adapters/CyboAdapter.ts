/**
 * Cybo Business Directory Adapter
 *
 * Parses company listings from cybo.com/saudi-arabia/
 * Cybo uses a card-based layout with business categories and contact info.
 *
 * URL: https://www.cybo.com/saudi-arabia/
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, parserRegistry } from './DirectoryParserAdapter';

export class CyboAdapter extends BaseDirectoryParser {
  readonly id = 'cybo';
  readonly name = 'Cybo Business Directory';

  matches(url: string): number {
    return url.includes('cybo.com') ? 0.95 : 0;
  }

  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const companies = this.parseBusinessListings($, baseUrl);

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
      warnings: ['No business listings found on Cybo directory']
    };
  }

  /**
   * Parse Cybo business listings.
   * Cybo uses a structured layout with business cards containing:
   * - Business name (linked)
   * - Category tags
   * - Address/location
   * - Phone numbers
   * - Rating stars
   */
  private parseBusinessListings($: cheerio.CheerioAPI, baseUrl: string) {
    const companies = [];

    // Cybo-specific selectors for business cards
    const cardSelectors = [
      '.cb-biz-card', '.business-card', '.biz-card',
      '.listing-card', '.result-card', '.search-result',
      '.cb-listing', '.cb-business', '.cb-item',
      '[class*="biz"][class*="card"]', '[class*="listing"][class*="card"]',
      'article.listing', '.cb-search-result'
    ];

    for (const selector of cardSelectors) {
      const $cards = $(selector);
      if ($cards.length === 0) continue;

      $cards.each((_, card) => {
        const $card = $(card);

        // Extract business name
        const nameSelectors = ['h3 a', 'h2 a', 'h4 a', 'h3', 'h2', 'h4', '.biz-name', '.business-name', '.listing-title a', '.listing-title'];
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

        // Extract description/snippet
        const descText = $card.find('.description, .biz-desc, .business-desc, .snippet, .excerpt, p.summary').first().text().trim();

        // Extract address
        const addressText = $card.find('.address, .location, .biz-address, .business-address, .geo').first().text().trim();

        // Extract phone
        const phoneText = $card.find('.phone, .tel, .biz-phone, .business-phone, [class*="phone"]').first().text().trim();

        // Extract website URL
        const websiteLink = $card.find('.website a, .biz-url a, .business-url a, a.biz-website').attr('href');

        // Extract category tags
        const categories: string[] = [];
        $card.find('.category, .tag, .biz-category, .business-category, .biz-tag, .listing-tag, .label').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length > 1 && text.length < 50) {
            categories.push(text);
          }
        });

        // Determine city from address
        let city = '';
        const saudiCities = ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Tabuk', 'Abha', 'Hail', 'Buraydah', 'Taif', 'Yanbu', 'Najran', 'Jazan'];
        for (const saudiCity of saudiCities) {
          if (addressText.includes(saudiCity)) {
            city = saudiCity;
            break;
          }
        }

        companies.push({
          name_en: this.cleanName(nameText),
          website_url: websiteLink ? this.resolveUrl(websiteLink, baseUrl) : (nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined),
          description_en: descText || undefined,
          phone: phoneText || undefined,
          city: city || (addressText ? addressText.substring(0, 50) : undefined),
          categories: categories.length > 0 ? categories : undefined,
          confidence_score: 0.65,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.9,
            name_ar: 0.1,
            website_url: websiteLink ? 0.7 : (nameLink ? 0.4 : 0.2),
            description_en: descText ? 0.6 : 0.2,
            phone: phoneText ? 0.8 : 0.2,
            email: 0.1,
            city: city ? 0.7 : (addressText ? 0.4 : 0.2)
          }
        });
      });

      if (companies.length > 0) break;
    }

    return companies;
  }

  /**
   * Discover pagination URLs from Cybo directory.
   */
  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    // Cybo pagination patterns
    $('.pagination a, .pager a, .page-numbers a, .next-page a, a[rel="next"], .cb-next a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) urls.push(this.resolveUrl(href, baseUrl));
    });

    // Also look for "Load more" or AJAX pagination
    $('.load-more[data-url], .cb-load-more[data-url]').each((_, el) => {
      const dataUrl = $(el).attr('data-url');
      if (dataUrl) urls.push(this.resolveUrl(dataUrl, baseUrl));
    });

    return [...new Set(urls)];
  }
}

parserRegistry.register(new CyboAdapter());
