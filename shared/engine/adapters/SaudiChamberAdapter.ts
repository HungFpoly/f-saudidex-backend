/**
 * Saudi Chamber of Commerce Directory Adapter
 *
 * Parses company listings from Saudi Chamber of Commerce websites.
 * These typically use structured tables with predictable CSS selectors.
 *
 * Example URLs:
 *   - https://jeddahchamber.org.sa/en/members
 *   - https://riyadhchamber.org.sa/en/business-directory
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, ParsedCompany, parserRegistry } from './DirectoryParserAdapter';

export class SaudiChamberAdapter extends BaseDirectoryParser {
  readonly id = 'saudi-chamber';
  readonly name = 'Saudi Chamber of Commerce Directory';

  /**
   * Match URLs containing chamber domains or /members, /business-directory paths.
   */
  matches(url: string): number {
    const lower = url.toLowerCase();

    // Specific chamber domains — highest confidence
    if (lower.includes('chamber') || lower.includes('chamber.sa') ||
      lower.includes('mcci') || lower.includes('chamber.org.sa') ||
      lower.includes('fsc.org.sa')) {
      return 0.95;
    }

    // Generic member/directory paths on .sa domains
    if (lower.includes('.sa') && (
      lower.includes('/member') ||
      lower.includes('/directory') ||
      lower.includes('/business') ||
      lower.includes('/companies') ||
      lower.includes('/factories')
    )) {
      return 0.7;
    }

    return 0;
  }

  /**
   * Parse chamber directory HTML and extract company listings.
   * Tries multiple strategies: JSON-LD, structured tables, card-based layouts.
   */
  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const companies: ParsedCompany[] = [];
    const warnings: string[] = [];

    // Strategy 1: Try JSON-LD structured data first (most reliable)
    const jsonLdCompanies = this.parseJsonLd($, baseUrl);
    if (jsonLdCompanies.length > 0) {
      return {
        companies: jsonLdCompanies,
        totalFound: jsonLdCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    // Strategy 2: Try table-based listings (common for chamber sites)
    const tableCompanies = this.parseTableListings($, baseUrl);
    if (tableCompanies.length > 0) {
      return {
        companies: tableCompanies,
        totalFound: tableCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    // Strategy 3: Try card-based listings
    const cardCompanies = this.parseCardListings($, baseUrl);
    if (cardCompanies.length > 0) {
      return {
        companies: cardCompanies,
        totalFound: cardCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    warnings.push('No company listings found using chamber directory patterns');

    return {
      companies: [],
      totalFound: 0,
      parseMethod: 'adapter',
      adapterName: this.name,
      warnings
    };
  }

  /**
   * Extract companies from JSON-LD structured data.
   */
  private parseJsonLd($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '{}');
        const items = data['@graph'] || (data['@type'] === 'ItemList' ? data.itemListElement : []);

        for (const item of items) {
          const org = item.item || item;
          if (org['@type'] === 'Organization' || org['@type'] === 'LocalBusiness') {
            companies.push({
              name_en: org.name || '',
              name_ar: org.nameAr || org.alternateName || '',
              website_url: org.url ? this.resolveUrl(org.url, baseUrl) : undefined,
              description_en: org.description || '',
              phone: org.telephone || '',
              email: org.email || '',
              city: org.address?.addressLocality || org.address?.addressCountry === 'SA' ? org.address?.streetAddress : '',
              categories: org.knowsAbout || [],
              confidence_score: 0.9,
              source_url: baseUrl,
              field_confidence: {
                name_en: 0.95,
                name_ar: org.nameAr ? 0.9 : 0.3,
                website_url: org.url ? 0.95 : 0.2,
                description_en: org.description ? 0.8 : 0.2,
                phone: org.telephone ? 0.95 : 0.2,
                email: org.email ? 0.95 : 0.2,
                city: org.address?.addressLocality ? 0.9 : 0.3
              }
            });
          }
        }
      } catch {
        // Skip invalid JSON-LD blocks
      }
    });

    return companies;
  }

  /**
   * Extract companies from table-based directory listings.
   * Common pattern: <table><tr><td>Company Name</td><td>Phone</td>...</tr></table>
   */
  private parseTableListings($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    // Look for tables with company-related class or id
    $('table').each((_, table) => {
      const $table = $(table);
      const tableId = $table.attr('id') || '';
      const tableClass = $table.attr('class') || '';

      // Skip tables that don't look like company listings
      if (!tableId.includes('company') && !tableId.includes('member') &&
        !tableId.includes('business') && !tableClass.includes('company') &&
        !tableClass.includes('member') && !tableClass.includes('directory')) {
        return;
      }

      // Process each row (skip header)
      $table.find('tr').each((i, row) => {
        if (i === 0) return; // Skip header row

        const $cells = $(row).find('td');
        if ($cells.length < 2) return; // Need at least name + one other field

        const nameText = $cells.eq(0).text().trim();
        if (!nameText || nameText.length < 2) return;

        const company: ParsedCompany = {
          name_en: this.cleanName(nameText),
          confidence_score: 0.7,
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.8,
            name_ar: 0.2,
            website_url: 0.2,
            description_en: 0.2,
            phone: 0.3,
            email: 0.2,
            city: 0.3
          }
        };

        // Try to extract phone, email, website from remaining cells
        $cells.each((j, cell) => {
          if (j === 0) return; // Skip name cell
          const text = $(cell).text().trim();
          const link = $(cell).find('a').attr('href');

          if (text.match(/^[+]?[\d\s\-()]{7,}$/)) {
            company.phone = text;
            company.field_confidence!.phone = 0.7;
          } else if (text.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            company.email = text;
            company.field_confidence!.email = 0.7;
          } else if (text.match(/^https?:\/\//) || (link && link.match(/^https?:\/\//))) {
            company.website_url = text.match(/^https?:\/\//) ? text : (link ? this.resolveUrl(link, baseUrl) : undefined);
            company.field_confidence!.website_url = 0.7;
          } else if (text.length > 3 && !company.description_en) {
            company.description_en = text;
            company.field_confidence!.description_en = 0.5;
          }
        });

        // Try to find company link in first cell
        const nameLink = $cells.eq(0).find('a').attr('href');
        if (nameLink) {
          company.website_url = this.resolveUrl(nameLink, baseUrl);
          company.field_confidence!.website_url = 0.6;
        }

        companies.push(company);
      });
    });

    return companies;
  }

  /**
   * Extract companies from card-based directory listings.
   * Common pattern: <div class="company-card"><h3>Name</h3><p>Description</p>...</div>
   */
  private parseCardListings($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    // Look for company card elements
    $('.company-card, .member-card, .business-card, .company-item, .member-item, .listing-item, .card-pro, .blog_post').each((_, card) => {
      const $card = $(card);

      // MCCI / card-pro specific extraction
      let nameText = '';
      let crNumber = '';
      let activity = '';
      
      // Pattern 1: Structured title classes
      const titleEl = $card.find('.card-pro__title .card-pro__value, .company-name, .member-name, h1, h2, h3, h4').first();
      nameText = titleEl.text().trim();
      
      // Pattern 2: Paragraph with "المصنع" or "الشركة" labels (Common in MCCI/Madinah Local Content)
      if (!nameText) {
        $card.find('p').each((_, p) => {
            const pText = $(p).text();
            if (pText.includes('المصنع') || pText.includes('الاسم') || pText.includes('الشركة') || pText.includes('المنشأة')) {
                // Get text after the colon
                const parts = pText.split(':');
                if (parts.length > 1) {
                    nameText = parts[1].trim();
                    return false; // Break
                }
            }
        });
      }

      // CR Number Pattern (Iterative to handle entities)
      $card.find('.card-pro__text, p, .cr-number').each((_, el) => {
        const text = $(el).text();
        if (text.includes('السجل') || text.includes('رقم') || text.includes('الضريبي')) {
            const crValue = $(el).find('.card-pro__value').text().trim();
            if (crValue) {
                crNumber = crValue.replace(/[^0-9]/g, '');
            } else {
                const parts = text.split(/[:\-\–]/);
                crNumber = (parts.length > 1 ? parts[parts.length - 1] : text).replace(/[^0-9]/g, '');
            }
            if (crNumber) return false; // Found it
        }
      });

      activity = $card.find('.card-pro__activity, h5, .description, .company-desc').first().text().trim();
      let logoPath = $card.find('img').first().attr('src');
      
      // Skip generic chamber logos
      if (this.isGenericLogo(logoPath)) {
        logoPath = undefined;
      }

      if (!nameText || nameText.length < 2) return;

      const nameLink = $card.find('a[href*="Details"], a[href*="factory"], a[href*="member"]').first().attr('href');

      const company: ParsedCompany = {
        name_en: this.cleanName(nameText),
        name_ar: nameText,
        cr_number: crNumber || undefined,
        description_en: activity || undefined,
        website_url: nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined,
        logo_url: logoPath ? this.resolveUrl(logoPath, baseUrl) : undefined,
        confidence_score: 0.85,
        source_url: baseUrl,
        field_confidence: {
          name_en: 0.7,
          name_ar: 0.95,
          website_url: nameLink ? 0.7 : 0.2,
          description_en: activity ? 0.7 : 0.2,
          phone: 0.2,
          email: 0.2,
          city: 0.3
        }
      };

      // Extract contact info from buttons/links
      $card.find('a[href^="tel:"]').each((_, el) => {
        const tel = $(el).attr('href')?.replace('tel:', '').trim();
        if (tel) {
            company.phone = tel;
            company.field_confidence!.phone = 0.9;
        }
      });
      $card.find('a[href^="mailto:"]').each((_, el) => {
        const email = $(el).attr('href')?.replace('mailto:', '').trim();
        if (email) {
            company.email = email;
            company.field_confidence!.email = 0.9;
        }
      });

      companies.push(company);
    });

    return companies;
  }

  /**
   * Discover pagination URLs from chamber directory pages.
   */
  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    // Common chamber pagination patterns
    const paginationSelectors = [
      '.pagination a',
      '.pager a',
      '.page-numbers a',
      '.wp-pagenavi a',
      '[class*="page"] a'
    ];

    for (const selector of paginationSelectors) {
      $(selector).each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          urls.push(this.resolveUrl(href, baseUrl));
        }
      });
    }

    return [...new Set(urls)];
  }

  /**
   * Checks if an image URL is likely a generic directory/chamber logo.
   */
  private isGenericLogo(url: string | undefined): boolean {
    if (!url) return true;
    const lower = url.toLowerCase();
    const genericKeywords = [
      'chamber', 'mcci', 'fsc', 'modon', 'eamana', 'gov.sa', 'vision2030',
      'logo-white', 'logo-dark', 'logo_white', 'logo_dark',
      'directory', 'placeholder', 'no-logo', 'default-image', 'noimage',
      'favicon', 'apple-touch-icon', 'icon-', 'banner-default', 'hero-bg'
    ];
    return genericKeywords.some(k => lower.includes(k));
  }
}

// Auto-register
parserRegistry.register(new SaudiChamberAdapter());
