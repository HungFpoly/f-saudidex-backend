/**
 * KSA Directory & SaudiDir Adapter
 *
 * Parses company listings from:
 *   - www.ksa.directory (Saudi business directory)
 *   - saudidir.com (Saudi company directory)
 *
 * These are general Saudi business directories with company profile pages
 * and category-based listings.
 *
 * URLs:
 *   https://www.ksa.directory/...
 *   https://saudidir.com/ksa/...
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, parserRegistry } from './DirectoryParserAdapter';

export class KSADirectoryAdapter extends BaseDirectoryParser {
  readonly id = 'ksa-directory';
  readonly name = 'KSA Directory / SaudiDir';

  matches(url: string): number {
    const lower = url.toLowerCase();
    if (lower.includes('ksa.directory') || lower.includes('saudidir.com')) {
      return 0.95;
    }
    return 0;
  }

  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const companies = this.parseDirectoryListings($, baseUrl);

    if (companies.length > 0) {
      return {
        companies,
        totalFound: companies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    // Try single company profile extraction
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
      warnings: ['No company listings found in KSA directory patterns']
    };
  }

  /**
   * Parse directory listing pages (category/search results).
   */
  private parseDirectoryListings($: cheerio.CheerioAPI, baseUrl: string) {
    const companies = [];

    const cardSelectors = [
      '.company-card', '.business-card', '.listing-card',
      '.company-item', '.business-item', '.listing-item',
      '.result-item', '.search-result',
      '.company-box', '.business-box',
      '.col-md-4 .company', '.col-md-3 .company',
      '[class*="company"][class*="card"]', '[class*="business"][class*="card"]',
      '.company-listing', '.business-listing'
    ];

    for (const selector of cardSelectors) {
      const $cards = $(selector);
      if ($cards.length === 0) continue;

      $cards.each((_, card) => {
        const $card = $(card);

        const nameSelectors = ['h3 a', 'h2 a', 'h4 a', 'h3', 'h2', 'h4', '.company-name a', '.company-name', '.business-name a', '.business-name', '.title a', '.title'];
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

        const descText = $card.find('.description, .company-desc, .business-desc, .summary, .excerpt, p.desc').first().text().trim();
        const phoneText = $card.find('.phone, .tel, [class*="phone"], .contact-number').first().text().trim();
        const emailText = $card.find('.email a, [class*="email"] a').first().text().trim();
        const websiteLink = $card.find('.website a, .company-url a, .business-url a, a.external-link').attr('href');
        const locationText = $card.find('.location, .city, .address, .country, .region').first().text().trim();

        const categories: string[] = [];
        $card.find('.category, .tag, .industry a, .sector a, .category a, .tag a, .label').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length > 1 && text.length < 50) categories.push(text);
        });

        // Extract Saudi city
        let city = '';
        const saudiCities = ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Tabuk', 'Abha', 'Hail', 'Buraydah', 'Taif', 'Yanbu', 'Najran', 'Jazan'];
        for (const saudiCity of saudiCities) {
          if (locationText.includes(saudiCity)) { city = saudiCity; break; }
        }

        companies.push({
          name_en: this.cleanName(nameText),
          website_url: websiteLink ? this.resolveUrl(websiteLink, baseUrl) : (nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined),
          description_en: descText || undefined,
          phone: phoneText || undefined,
          email: emailText || undefined,
          city: city || (locationText ? locationText.substring(0, 50) : undefined),
          categories: categories.length > 0 ? categories : undefined,
          confidence_score: 0.55,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.85,
            name_ar: 0.15,
            website_url: websiteLink ? 0.7 : (nameLink ? 0.4 : 0.2),
            description_en: descText ? 0.5 : 0.2,
            phone: phoneText ? 0.75 : 0.2,
            email: emailText ? 0.8 : 0.15,
            city: city ? 0.7 : (locationText ? 0.4 : 0.2)
          }
        });
      });

      if (companies.length > 0) break;
    }

    return companies;
  }

  /** Logo URL from img, lazy img, SVG object/embed, picture/srcset, or svg image/use. */
  private pickProfileLogoSrc($: cheerio.CheerioAPI): string | undefined {
    const firstSrcsetUrl = (srcset: string | undefined): string | undefined => {
      if (!srcset) return undefined;
      const token = srcset.split(',')[0]?.trim().split(/\s+/)[0];
      return token || undefined;
    };
    const trimAttr = (sel: string, attr: 'src' | 'data' | 'data-src'): string | undefined =>
      $(sel).first().attr(attr)?.trim();

    return (
      trimAttr('.logo img[src]', 'src') ||
      trimAttr('.logo a img[src]', 'src') ||
      trimAttr('header .logo img[src]', 'src') ||
      trimAttr('.logo img[data-src]', 'data-src') ||
      trimAttr('.logo a img[data-src]', 'data-src') ||
      firstSrcsetUrl($('.logo picture source[srcset*=".svg"]').first().attr('srcset')) ||
      firstSrcsetUrl($('.logo picture source').first().attr('srcset')) ||
      firstSrcsetUrl($('header .logo picture source').first().attr('srcset')) ||
      trimAttr('.logo object[data]', 'data') ||
      trimAttr('.logo object[type="image/svg+xml"]', 'data') ||
      trimAttr('header .logo object[data]', 'data') ||
      trimAttr('.logo embed[src]', 'src') ||
      trimAttr('.logo embed[type="image/svg+xml"]', 'src') ||
      (() => {
        const use = $('.logo svg use').first();
        const href = use.attr('href') || use.attr('xlink:href');
        const h = href?.trim();
        if (!h || h.startsWith('#')) return undefined;
        return h;
      })() ||
      (() => {
        const node = $('.logo svg image').first();
        return (node.attr('href') || node.attr('xlink:href'))?.trim();
      })()
    );
  }

  /**
   * Parse a single company profile page.
   * These directories typically have detailed company pages with:
   * - Company name, Arabic name
   * - Description
   * - Contact: phone, email, website
   * - Address/city
   * - Categories/industries
   * - Products/services
   */
  private parseProfilePage($: cheerio.CheerioAPI, baseUrl: string) {
    const nameSelectors = ['h1.company-name', 'h1.business-name', 'h1', '.company-title', '.business-title', '.page-title'];
    let nameText = '';

    for (const sel of nameSelectors) {
      const text = $(sel).first().text().trim();
      if (text && text.length > 2) { nameText = text; break; }
    }

    if (!nameText) return null;

    const descText = $('.company-description, .business-description, .about-company, .description, p.intro, .company-about').first().text().trim();
    const phoneText = $('.phone, .tel, [class*="phone"], .contact-phone, .telephone').first().text().trim();
    const emailText = $('.email a, [class*="email"] a, .contact-email a').first().text().trim();
    const websiteLink = $('.website a, .company-url a, .business-url a, a.company-website').attr('href');
    const addressText = $('.address, .location, .company-address, .business-address, .physical-address').first().text().trim();

    const categories: string[] = [];
    $('.category, .tag, .industry a, .category a, .tag a, .sector a').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 50) categories.push(text);
    });

    const products: string[] = [];
    $('.product, .products a, .services a, [class*="product"] a').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 100) products.push(text);
    });

    // Extract Saudi city
    let city = '';
    const saudiCities = ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Tabuk', 'Abha', 'Hail', 'Buraydah', 'Taif', 'Yanbu', 'Najran', 'Jazan'];
    for (const saudiCity of saudiCities) {
      if (addressText.includes(saudiCity)) { city = saudiCity; break; }
    }

    const logoSrc = this.pickProfileLogoSrc($);
    let logo_url: string | undefined;
    if (logoSrc) {
      try {
        logo_url = this.resolveUrl(logoSrc, baseUrl);
      } catch {
        logo_url = logoSrc.startsWith('http') ? logoSrc : undefined;
      }
    }

    return {
      name_en: this.cleanName(nameText),
      website_url: websiteLink ? this.resolveUrl(websiteLink, baseUrl) : undefined,
      logo_url,
      description_en: descText || undefined,
      phone: phoneText || undefined,
      email: emailText || undefined,
      city: city || (addressText ? addressText.substring(0, 50) : undefined),
      categories: categories.length > 0 ? categories : undefined,
      products: products.length > 0 ? products : undefined,
      confidence_score: 0.65,
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

parserRegistry.register(new KSADirectoryAdapter());
