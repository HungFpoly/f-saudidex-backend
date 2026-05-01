/**
 * Saudi Government Registry Adapter
 *
 * Parses company listings from Saudi government business registries.
 * These typically use structured tables with CR numbers, official names,
 * and standardized formatting.
 *
 * Example URLs:
 *   - https://mc.gov.sa/en/business/companies
 *   - https://cr.mci.gov.sa/ (Commercial Register lookup)
 *   - https://monshaat.gov.sa/ (SME Authority)
 *   - https://zatca.gov.sa/ (Tax Authority - business lookup)
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, parserRegistry } from './DirectoryParserAdapter';

export class SaudiGovRegistryAdapter extends BaseDirectoryParser {
  readonly id = 'saudi-gov-registry';
  readonly name = 'Saudi Government Business Registry';

  /**
   * Match Saudi government domains and registry paths.
   */
  matches(url: string): number {
    const lower = url.toLowerCase();

    // Specific government domains
    if (lower.includes('.gov.sa') || lower.includes('monshaat.gov.sa')) {
      // High confidence for government domains
      if (lower.includes('/companies') || lower.includes('/business') ||
          lower.includes('/registry') || lower.includes('/register') ||
          lower.includes('/cr') || lower.includes('/commercial') ||
          lower.includes('/license') || lower.includes('/member')) {
        return 0.95;
      }
      return 0.8;
    }

    // Specific known registry paths
    if (lower.includes('mc.gov.sa') || lower.includes('mci.gov.sa') ||
        lower.includes('zatca.gov.sa') || lower.includes('monshaat.gov.sa')) {
      return 0.85;
    }

    return 0;
  }

  /**
   * Parse government registry HTML and extract company listings.
   * Government sites typically use structured tables with CR numbers.
   */
  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const companies = this.parseRegistryTable($, baseUrl);

    if (companies.length > 0) {
      return {
        companies,
        totalFound: companies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    // Try JSON-LD as fallback
    const jsonLdCompanies = this.parseJsonLd($, baseUrl);
    if (jsonLdCompanies.length > 0) {
      return {
        companies: jsonLdCompanies,
        totalFound: jsonLdCompanies.length,
        parseMethod: 'adapter',
        adapterName: this.name
      };
    }

    return {
      companies: [],
      totalFound: 0,
      parseMethod: 'adapter',
      adapterName: this.name,
      warnings: ['No company listings found in government registry patterns']
    };
  }

  /**
   * Parse registry table with CR numbers and official company data.
   * Government tables typically have columns: CR Number, Company Name, Activity, Status, Location
   */
  private parseRegistryTable($: cheerio.CheerioAPI, baseUrl: string) {
    const companies = [];

    // Look for tables with registry-related identifiers
    const tableSelectors = [
      'table#companies', 'table#businesses', 'table#registry',
      'table.companies', 'table.businesses', 'table.registry',
      'table.cr-list', 'table.license-list', 'table.member-list',
      '.data-table', '.results-table', '#search-results'
    ];

    for (const selector of tableSelectors) {
      const $table = $(selector);
      if ($table.length === 0) continue;

      // Parse header to identify columns
      const headers: string[] = [];
      $table.find('thead th, thead td, tr:first-child th, tr:first-child td').each((_, th) => {
        headers.push($(th).text().trim().toLowerCase());
      });

      // Find column indices
      const nameIdx = headers.findIndex(h =>
        h.includes('name') || h.includes('company') || h.includes('business') ||
        h.includes('establishment') || h.includes('institution') ||
        h.includes('اسم') || h.includes('شركة')
      );
      const crIdx = headers.findIndex(h =>
        h.includes('cr') || h.includes('register') || h.includes('license') || h.includes('رقم')
      );
      const activityIdx = headers.findIndex(h =>
        h.includes('activity') || h.includes('type') || h.includes('category') || h.includes('نشاط')
      );
      const statusIdx = headers.findIndex(h =>
        h.includes('status') || h.includes('state') || h.includes('حالة')
      );
      const locationIdx = headers.findIndex(h =>
        h.includes('location') || h.includes('city') || h.includes('region') || h.includes('مدينة')
      );

      // Parse data rows
      $table.find('tbody tr, tr').each((i, row) => {
        // Skip header row
        if (i === 0) return;

        const $cells = $(row).find('td');
        if ($cells.length < 2) return;

        const nameText = nameIdx >= 0 ? $cells.eq(nameIdx).text().trim() : $cells.eq(0).text().trim();
        if (!nameText || nameText.length < 2) return;

        const activityText = activityIdx >= 0 ? $cells.eq(activityIdx).text().trim() : '';
        const statusText = statusIdx >= 0 ? $cells.eq(statusIdx).text().trim() : '';
        const locationText = locationIdx >= 0 ? $cells.eq(locationIdx).text().trim() : '';
        const crText = crIdx >= 0 ? $cells.eq(crIdx).text().trim() : '';

        // Try to find company link
        const nameLink = nameIdx >= 0
          ? $cells.eq(nameIdx).find('a').attr('href')
          : $cells.eq(0).find('a').attr('href');

        const company = {
          name_en: this.cleanName(nameText),
          website_url: nameLink ? this.resolveUrl(nameLink, baseUrl) : undefined,
          description_en: activityText || undefined,
          city: locationText || undefined,
          categories: activityText ? [activityText] : undefined,
          confidence_score: 0.85, // Government data is high confidence
          source_url: baseUrl,
          field_confidence: {
            name_en: 0.95,
            name_ar: 0.9, // Government sites often have Arabic names
            website_url: nameLink ? 0.6 : 0.2,
            description_en: activityText ? 0.8 : 0.3,
            phone: 0.2,
            email: 0.2,
            city: locationText ? 0.8 : 0.3
          }
        };

        companies.push(company);
      });

      if (companies.length > 0) break;
    }

    return companies;
  }

  /**
   * Extract companies from JSON-LD structured data (less common for government sites).
   */
  private parseJsonLd($: cheerio.CheerioAPI, baseUrl: string) {
    const companies = [];

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
              city: org.address?.addressLocality || '',
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
        // Skip invalid JSON-LD
      }
    });

    return companies;
  }

  /**
   * Discover pagination URLs from government registry pages.
   */
  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    // Government sites often use simple pagination
    const paginationSelectors = [
      '.pagination a',
      '.pager a',
      '.page-numbers a',
      'a.next',
      'a[rel="next"]',
      '.next-page a'
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
}

// Auto-register
parserRegistry.register(new SaudiGovRegistryAdapter());
