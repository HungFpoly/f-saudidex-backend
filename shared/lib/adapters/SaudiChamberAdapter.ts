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
      lower.includes('mcci') || lower.includes('chamber.org.sa')) {
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

    // Strategy 4: MCCI "Factories" directory (lc.mcci.org.sa/Home/Factories)
    // Renders as repeated labeled blocks:
    // "رقم السجل التجاري" + "المصنع" + activity headings + "التفاصيل".
    const factories = this.parseFactoriesDirectory($, baseUrl);
    if (factories.length > 0) {
      return {
        companies: factories,
        totalFound: factories.length,
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

  private parseFactoriesDirectory($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const lower = (baseUrl || '').toLowerCase();
    if (!lower.includes('mcci.org.sa') || !lower.includes('/home/factories')) return [];

    // Build line-oriented text from common block-level elements to preserve order.
    const lines: string[] = [];
    $('main, [role="main"], .container, body')
      .first()
      .find('h1,h2,h3,h4,h5,p,li,div')
      .each((_, el) => {
        const t = ($(el).text() || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
        if (!t) return;
        // Skip huge option lists (products filter) which can be megabytes of text.
        if (t.length > 400) return;
        lines.push(t);
      });

    if (lines.length === 0) return [];

    const results: ParsedCompany[] = [];
    let pending: { cr?: string; name?: string; activity?: string } | null = null;

    const flush = () => {
      if (!pending?.name) return;
      const name = pending.name.trim();
      if (name.length < 2) return;

      let detailUrl: string | undefined;
      if (pending.cr) {
        try {
          const origin = new URL(baseUrl).origin;
          detailUrl = new URL(`/Home/FactoryDetails/${pending.cr}`, origin).toString();
        } catch { }
      }

      results.push({
        name_en: name,
        website_url: undefined,
        email: undefined,
        phone: undefined,
        description_en: pending.activity ? pending.activity : undefined,
        categories: pending.activity ? [pending.activity] : undefined,
        confidence_score: 0.72,
        // Prefer per-factory detail page as source_url when we can derive it.
        source_url: detailUrl || baseUrl,
        field_confidence: {
          name_en: 0.9,
          website_url: 0.2,
          email: 0.2,
          phone: 0.2,
          description_en: pending.activity ? 0.6 : 0.2,
        }
      } as any);
    };

    for (const line of lines) {
      // New record start
      if (/رقم\s*السجل\s*التجاري/i.test(line)) {
        // flush previous
        flush();
        pending = {};
        const m = line.match(/(\d{6,})/);
        if (m?.[1]) pending.cr = m[1];
        continue;
      }

      if (!pending) continue;

      if (/المصنع/i.test(line)) {
        // Examples:
        // - "المصنع : شركة اماد الصناعية"
        // - "المصنع شركة اماد الصناعية"
        // - "المصنع:شركة اماد الصناعية"
        const idx = line.indexOf('المصنع');
        const after = idx >= 0 ? line.slice(idx + 'المصنع'.length).trim() : line.trim();
        const afterColon = after.replace(/^[:：\-\s]+/, '').trim();
        pending.name = (afterColon || after).trim() || pending.name;
        continue;
      }

      // Activity headings are often short and follow the factory name.
      if (!pending.activity && line.length >= 6 && line.length <= 120) {
        // Heuristic: ignore generic UI labels
        if (/^(التفاصيل|بحث|السابق|التالي|\d+|إجمالي)/i.test(line)) continue;
        // Arabic activity categories often start with "صنع"
        if (/^صنع\s+/i.test(line) || /الصناعات/i.test(line)) {
          pending.activity = line.trim();
          continue;
        }
      }
    }

    flush();
    return results;
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
    $('.company-card, .member-card, .business-card, .company-item, .member-item, .listing-item').each((_, card) => {
      const $card = $(card);

      const nameEl = $card.find('h1, h2, h3, h4, .company-name, .member-name, .business-name').first();
      const nameText = nameEl.text().trim();
      if (!nameText) return;

      const nameLink = nameEl.find('a').attr('href');
      const descText = $card.find('.description, .company-desc, .member-desc, p').first().text().trim();

      const company: ParsedCompany = {
        name_en: this.cleanName(nameText),
        website_url: nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined,
        description_en: descText || undefined,
        confidence_score: 0.6,
        source_url: baseUrl,
        field_confidence: {
          name_en: 0.8,
          name_ar: 0.2,
          website_url: nameLink ? 0.6 : 0.2,
          description_en: descText ? 0.5 : 0.2,
          phone: 0.2,
          email: 0.2,
          city: 0.3
        }
      };

      // Extract contact info
      const phoneText = $card.find('.phone, .tel, [class*="phone"]').first().text().trim();
      const emailText = $card.find('.email, [class*="email"] a').first().text().trim();
      const locationText = $card.find('.location, .city, .address, [class*="location"]').first().text().trim();

      if (phoneText) {
        company.phone = phoneText;
        company.field_confidence!.phone = 0.7;
      }
      if (emailText) {
        company.email = emailText;
        company.field_confidence!.email = 0.7;
      }
      if (locationText) {
        company.city = locationText;
        company.field_confidence!.city = 0.6;
      }

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

    // MCCI Factories: generate `pageNumber` links from "إجمالي عدد الصفحات : 37"
    const lower = (baseUrl || '').toLowerCase();
    if (lower.includes('mcci.org.sa') && lower.includes('/home/factories')) {
      const text = $('body').text().replace(/\s+/g, ' ');
      const total = Number(text.match(/إجمالي\s+عدد\s+الصفحات\s*:\s*(\d{1,4})/)?.[1] || 0);
      const maxToGenerate = Math.min(total || 0, 60); // safety cap
      if (maxToGenerate >= 2) {
        // Empirically, this site uses 1-indexed `pageNumber` and pageNumber=0 returns no results.
        for (let p = 2; p <= maxToGenerate; p++) {
          try {
            const u = new URL(baseUrl);
            u.searchParams.set('pageNumber', String(p));
            urls.push(u.toString());
          } catch { }
        }
      }
    }

    let unique = [...new Set(urls)];
    if (lower.includes('mcci.org.sa') && lower.includes('/home/factories')) {
      // `pageNumber=0` returns an empty page; ignore it to avoid wasting crawl budget.
      unique = unique.filter(u => !/[?&]pageNumber=0(?:&|$)/i.test(u));

      // The base URL (no pageNumber) renders the same results as pageNumber=1.
      // If we keep both, small `maxPages` values look like "missing data" due to dedupe.
      const baseHasPageNumber = (() => {
        try { return new URL(baseUrl).searchParams.has('pageNumber'); } catch { return false; }
      })();
      if (!baseHasPageNumber) {
        unique = unique.filter(u => !/[?&]pageNumber=1(?:&|$)/i.test(u));
      }
    }
    return unique;
  }
}

// Auto-register
parserRegistry.register(new SaudiChamberAdapter());
