/**
 * BizMideast Adapter
 *
 * Parses company listings from bizmideast.com
 * A Middle East B2B directory with company profile pages and category listings.
 *
 * URL: https://www.bizmideast.com/SA/...
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, parserRegistry } from './DirectoryParserAdapter';

export class BizMideastAdapter extends BaseDirectoryParser {
  readonly id = 'bizmideast';
  readonly name = 'BizMideast B2B Directory';

  matches(url: string): number {
    return url.includes('bizmideast.com') ? 0.95 : 0;
  }

  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const companies = this.parseListings($, baseUrl);

    if (companies.length > 0) {
      return {
        companies,
        totalFound: companies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    // Try profile page extraction (single company page)
    const profileCompany = this.parseProfilePage($, baseUrl);
    if (profileCompany) {
      return {
        companies: [profileCompany],
        totalFound: 1,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    return {
      companies: [],
      totalFound: 0,
      parseMethod: 'adapter',
      adapterName: this.name,
      warnings: ['No company listings found on BizMideast']
    };
  }

  /**
   * Parse category/listing pages with multiple companies.
   */
  private parseListings($: cheerio.CheerioAPI, baseUrl: string) {
    const companies = [];

    const cardSelectors = [
      '.company-card', '.business-card', '.company-listing',
      '.business-listing', '.company-item', '.business-item',
      '.listing-item', '.search-result', '.result-item',
      '.col-company', '.company-col',
      '[class*="company"][class*="card"]', '[class*="business"][class*="card"]'
    ];

    for (const selector of cardSelectors) {
      const $cards = $(selector);
      if ($cards.length === 0) continue;

      $cards.each((_, card) => {
        const $card = $(card);

        const nameSelectors = ['h3 a', 'h2 a', 'h4 a', 'h3', 'h2', 'h4', '.company-name a', '.company-name', '.title a', '.title'];
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

        const descText = $card.find('.description, .company-desc, .summary, .excerpt, p').first().text().trim();
        const phoneText = $card.find('.phone, .tel, [class*="phone"]').first().text().trim();
        const websiteLink = $card.find('.website a, .company-url a, a.external-link').attr('href');
        const locationText = $card.find('.location, .city, .address, .country').first().text().trim();

        const categories: string[] = [];
        $card.find('.category, .tag, .industry a, .sector a, .category a, .tag a').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length > 1 && text.length < 50) categories.push(text);
        });

        companies.push({
          name_en: this.cleanName(nameText),
          website_url: websiteLink ? this.resolveUrl(websiteLink, baseUrl) : (nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined),
          description_en: descText || undefined,
          phone: phoneText || undefined,
          city: locationText || undefined,
          categories: categories.length > 0 ? categories : undefined,
          confidence_score: 0.55,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.85,
            name_ar: 0.15,
            website_url: websiteLink ? 0.7 : (nameLink ? 0.4 : 0.2),
            description_en: descText ? 0.5 : 0.2,
            phone: phoneText ? 0.75 : 0.2,
            email: 0.15,
            city: locationText ? 0.5 : 0.2
          }
        });
      });

      if (companies.length > 0) break;
    }

    return companies;
  }

  /**
   * Parse a single company profile page.
   */
  private parseProfilePage($: cheerio.CheerioAPI, baseUrl: string) {
    // Look for company name in page header
    const nameSelectors = ['h1.company-name', 'h1.business-name', 'h1', '.company-title', '.business-title'];
    let nameText = '';

    for (const sel of nameSelectors) {
      const text = $(sel).first().text().trim();
      if (text && text.length > 2) {
        nameText = text;
        break;
      }
    }

    if (!nameText) return null;

    const descText = $('.company-description, .business-description, .about, .description, p.intro').first().text().trim();
    const phoneText = $('.phone, .tel, [class*="phone"], .contact-phone').first().text().trim();
    const emailText = $('.email, [class*="email"] a, .contact-email a').first().text().trim();
    const websiteLink = $('.website a, .company-url a, .business-url a').attr('href');
    const addressText = $('.address, .location, .company-address, .business-address').first().text().trim();

    const categories: string[] = [];
    $('.category, .tag, .industry a, .category a, .tag a').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 50) categories.push(text);
    });

    // Extract Saudi city from address
    let city = '';
    const saudiCities = ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Tabuk', 'Abha', 'Hail', 'Buraydah', 'Taif', 'Yanbu', 'Najran', 'Jazan'];
    for (const saudiCity of saudiCities) {
      if (addressText.includes(saudiCity)) { city = saudiCity; break; }
    }

    return {
      name_en: this.cleanName(nameText),
      website_url: websiteLink ? this.resolveUrl(websiteLink, baseUrl) : undefined,
      description_en: descText || undefined,
      phone: phoneText || undefined,
      email: emailText || undefined,
      city: city || (addressText ? addressText.substring(0, 50) : undefined),
      categories: categories.length > 0 ? categories : undefined,
      confidence_score: 0.7,
      source_url: baseUrl,
      field_confidence: {
        name_en: 0.9,
        name_ar: 0.15,
        website_url: websiteLink ? 0.7 : 0.2,
        description_en: descText ? 0.6 : 0.2,
        phone: phoneText ? 0.8 : 0.2,
        email: emailText ? 0.85 : 0.15,
        city: city ? 0.7 : (addressText ? 0.4 : 0.2)
      }
    };
  }

  /**
   * Discover pagination URLs.
   */
  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    $('.pagination a, .pager a, .page-numbers a, .next a, a[rel="next"], .next-page a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) urls.push(this.resolveUrl(href, baseUrl));
    });

    return [...new Set(urls)];
  }
}

parserRegistry.register(new BizMideastAdapter());
