/**
 * Modon (Saudi Industrial Property Authority) Adapter
 *
 * Parses factory/company listings from the MODON industrial directory.
 * modon.gov.sa uses a SharePoint Online-based ASPX structure with custom web parts.
 *
 * Covered URLs:
 *   - https://www.modon.gov.sa/ar/Partners/Factories/Pages/default.aspx  (Arabic)
 *   - https://www.modon.gov.sa/en/Partners/Factories/Pages/default.aspx  (English)
 *   - https://www.modon.gov.sa/ar/Partners/Factories/                     (variant)
 *   - https://www.modon.gov.sa/en/Partners/Factories/                     (variant)
 *
 * HTML strategies (tried in order, first one with results wins):
 *   1. SharePoint List View Table  — .ms-listviewtable rows
 *   2. SharePoint Modern Card Grid — [class*="factory"], [class*="Factory"]
 *   3. Generic anchor extraction   — All links inside #DeltaPlaceHolderMain
 *   4. SharePoint Value Cells      — .ms-vb2, .ms-vb with adjacent text
 *   5. Broad heading scan          — h2/h3/h4 inside main content zone
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, ParsedCompany, parserRegistry } from './DirectoryParserAdapter';

export class ModonAdapter extends BaseDirectoryParser {
  readonly id = 'modon';
  readonly name = 'MODON Industrial Directory';

  // ── URL matching ────────────────────────────────────────────────────────────

  matches(url: string): number {
    const lower = url.toLowerCase();
    if (!lower.includes('modon.gov.sa')) return 0;

    // Factories directory — highest confidence
    if (lower.includes('/factories') || lower.includes('/partners')) {
      return 0.97;
    }

    // Any other modon.gov.sa page — still high confidence
    return 0.85;
  }

  // ── Main parse entry ────────────────────────────────────────────────────────

  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);
    const warnings: string[] = [];

    // Try each strategy in order; stop at the first one that yields results.
    const strategies: Array<() => ParsedCompany[]> = [
      () => this.parseSharePointListView($, baseUrl),
      () => this.parseModernCards($, baseUrl),
      () => this.parseMainZoneLinks($, baseUrl),
      () => this.parseSharePointValueCells($, baseUrl),
      () => this.parseHeadingsInMainZone($, baseUrl),
    ];

    for (const strategy of strategies) {
      try {
        const companies = strategy();
        if (companies.length > 0) {
          return {
            companies,
            totalFound: companies.length,
            parseMethod: 'adapter',
            adapterName: this.name,
            warnings,
          };
        }
      } catch (err) {
        warnings.push(`Strategy failed: ${(err as Error).message}`);
      }
    }

    warnings.push(
      'No factory listings found with any parsing strategy. ' +
      'The page may require JavaScript rendering or use a different structure.'
    );

    return {
      companies: [],
      totalFound: 0,
      parseMethod: 'adapter',
      adapterName: this.name,
      warnings,
    };
  }

  // ── Strategy 1: SharePoint Classic List View Table ──────────────────────────
  //
  // SharePoint renders list views as <table class="ms-listviewtable">.
  // Columns are <td class="ms-vb2"> or <td class="ms-vb">.
  // The first link inside a row is typically the item title.

  private parseSharePointListView($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    const tableSelectors = [
      'table.ms-listviewtable',
      'table[class*="listview"]',
      'table[class*="ListView"]',
      '#onetidDoclibViewTbl0',
      '.ms-listviewtable',
    ];

    for (const sel of tableSelectors) {
      const $table = $(sel);
      if ($table.length === 0) continue;

      $table.find('tr').each((rowIdx, row) => {
        // Skip header rows (th-only rows)
        if ($(row).find('th').length > 0 && $(row).find('td').length === 0) return;

        const $cells = $(row).find('td');
        if ($cells.length === 0) return;

        // Title cell: first td that contains an anchor or meaningful text
        const $firstCell = $cells.first();
        const $link = $firstCell.find('a').first();
        const rawName = $link.text().trim() || $firstCell.text().trim();

        if (!rawName || rawName.length < 2) return;

        const href = $link.attr('href') || '';

        // Gather remaining cells as description / city / category
        const cellTexts = $cells
          .map((_, td) => $(td).text().trim())
          .get()
          .filter(Boolean);

        const description = cellTexts.slice(1).join(' | ').trim();

        companies.push({
          name_en: this.isArabic(rawName) ? '' : this.cleanName(rawName),
          name_ar: this.isArabic(rawName) ? this.cleanName(rawName) : '',
          website_url: href ? this.resolveUrl(href, baseUrl) : undefined,
          description_en: !this.isArabic(description) ? description : undefined,
          description_ar: this.isArabic(description) ? description : undefined,
          confidence_score: 0.8,
          source_url: baseUrl,
          field_confidence: {
            name_en: !this.isArabic(rawName) ? 0.85 : 0.2,
            name_ar: this.isArabic(rawName) ? 0.9 : 0.2,
            website_url: href ? 0.7 : 0.1,
            description_en: description ? 0.6 : 0.1,
          },
        });
      });

      if (companies.length > 0) break;
    }

    return companies;
  }

  // ── Strategy 2: Modern SharePoint Card Grid ──────────────────────────────────
  //
  // Modern SharePoint uses div-based card layouts.
  // Common patterns: ms-List-cell, ms-DetailsRow, cbs-List items.

  private parseModernCards($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    const cardSelectors = [
      '.ms-List-cell',
      '.ms-DetailsRow',
      '[class*="factory-card"]',
      '[class*="factoryCard"]',
      '[class*="Factory"]',
      '[class*="company-card"]',
      '[class*="CompanyCard"]',
      '.cbs-List li',
      '.sp-List li',
      '[data-automationid="ListCell"]',
      '[data-automationid="DetailsRowCheck"]',
      '.ms-TilesList-cell',
    ];

    for (const sel of cardSelectors) {
      $(sel).each((_, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        if (!text || text.length < 2) return;

        // Look for title field
        const $titleEl = $el.find(
          '[data-automationid="FieldRenderer-title"] a, ' +
          '[class*="title"] a, [class*="Title"] a, ' +
          'h1 a, h2 a, h3 a, h4 a, ' +
          '.ms-font-l a'
        ).first();

        const $link = $titleEl.length > 0 ? $titleEl : $el.find('a').first();
        const rawName = $link.text().trim() || $el.find('h1, h2, h3, h4').first().text().trim();

        if (!rawName || rawName.length < 2) return;

        const href = $link.attr('href') || '';

        companies.push({
          name_en: this.isArabic(rawName) ? '' : this.cleanName(rawName),
          name_ar: this.isArabic(rawName) ? this.cleanName(rawName) : '',
          website_url: href ? this.resolveUrl(href, baseUrl) : undefined,
          confidence_score: 0.75,
          source_url: baseUrl,
          field_confidence: {
            name_en: !this.isArabic(rawName) ? 0.8 : 0.2,
            name_ar: this.isArabic(rawName) ? 0.85 : 0.2,
            website_url: href ? 0.65 : 0.1,
          },
        });
      });

      if (companies.length > 0) break;
    }

    return companies;
  }

  // ── Strategy 3: Main Zone Links ──────────────────────────────────────────────
  //
  // Look for all anchor tags inside SharePoint's main content placeholder.
  // Filter out navigation, footer, utility links.

  private parseMainZoneLinks($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];
    const seen = new Set<string>();

    // SharePoint main content zones
    const zoneSelectors = [
      '#DeltaPlaceHolderMain',
      '#ctl00_PlaceHolderMain',
      '#WebPartWPQ1',
      '#WebPartWPQ2',
      '.ms-rtestate-field',
      'main',
      '[role="main"]',
    ];

    for (const zoneSel of zoneSelectors) {
      const $zone = $(zoneSel);
      if ($zone.length === 0) continue;

      $zone.find('a[href]').each((_, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        const text = $a.text().trim();

        // Skip navigation/utility links
        if (!text || text.length < 3) return;
        if (text.length > 120) return; // Suspiciously long — likely paragraph text
        if (this.isNavigationLink(href, text)) return;
        if (seen.has(text.toLowerCase())) return;
        seen.add(text.toLowerCase());

        const isInternal = href.startsWith('/') || href.includes('modon.gov.sa');
        const isDetailLink = href.includes('/Pages/') ||
          href.includes('/Factory/') ||
          href.includes('/Detail') ||
          href.includes('FactoryId=') ||
          href.includes('ID=');

        if (!isInternal && !isDetailLink) return;

        companies.push({
          name_en: this.isArabic(text) ? '' : this.cleanName(text),
          name_ar: this.isArabic(text) ? this.cleanName(text) : '',
          website_url: this.resolveUrl(href, baseUrl),
          confidence_score: 0.65,
          source_url: baseUrl,
          field_confidence: {
            name_en: !this.isArabic(text) ? 0.7 : 0.2,
            name_ar: this.isArabic(text) ? 0.75 : 0.2,
            website_url: 0.6,
          },
        });
      });

      if (companies.length > 0) break;
    }

    return companies;
  }

  // ── Strategy 4: SharePoint Value Cells ──────────────────────────────────────
  //
  // Classic SharePoint renders each field in a <td class="ms-vb2"> or <td class="ms-vb">.
  // Scan for rows that have multiple value cells suggesting a listing.

  private parseSharePointValueCells($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];

    $('tr').each((_, row) => {
      const $row = $(row);
      const $vb = $row.find('td.ms-vb2, td.ms-vb');
      if ($vb.length === 0) return;

      const $firstLink = $vb.first().find('a').first();
      const rawName = $firstLink.text().trim() || $vb.first().text().trim();
      if (!rawName || rawName.length < 2) return;

      const href = $firstLink.attr('href') || '';

      const extraText = $vb
        .map((_, td) => $(td).text().trim())
        .get()
        .slice(1)
        .join(' | ')
        .trim();

      companies.push({
        name_en: this.isArabic(rawName) ? '' : this.cleanName(rawName),
        name_ar: this.isArabic(rawName) ? this.cleanName(rawName) : '',
        website_url: href ? this.resolveUrl(href, baseUrl) : undefined,
        description_en: !this.isArabic(extraText) ? extraText : undefined,
        description_ar: this.isArabic(extraText) ? extraText : undefined,
        confidence_score: 0.7,
        source_url: baseUrl,
        field_confidence: {
          name_en: !this.isArabic(rawName) ? 0.75 : 0.2,
          name_ar: this.isArabic(rawName) ? 0.8 : 0.2,
          website_url: href ? 0.65 : 0.1,
        },
      });
    });

    return companies;
  }

  // ── Strategy 5: Heading Scan in Main Content Zone ───────────────────────────
  //
  // Last resort: collect all h2/h3/h4 headings that look like company names.

  private parseHeadingsInMainZone($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];
    const seen = new Set<string>();

    const $zone = $(
      '#DeltaPlaceHolderMain, #ctl00_PlaceHolderMain, main, [role="main"], .ms-rtestate-field'
    ).first();

    const $root = $zone.length > 0 ? $zone : $('body');

    $root.find('h2, h3, h4, h5').each((_, el) => {
      const $h = $(el);
      const text = $h.text().trim();
      if (!text || text.length < 3 || text.length > 150) return;
      if (seen.has(text.toLowerCase())) return;
      seen.add(text.toLowerCase());

      // Skip common page headings
      if (this.isPageHeading(text)) return;

      const $link = $h.find('a').first();
      const href = $link.attr('href') || $h.next('a').attr('href') || '';

      companies.push({
        name_en: this.isArabic(text) ? '' : this.cleanName(text),
        name_ar: this.isArabic(text) ? this.cleanName(text) : '',
        website_url: href ? this.resolveUrl(href, baseUrl) : undefined,
        confidence_score: 0.55,
        source_url: baseUrl,
        field_confidence: {
          name_en: !this.isArabic(text) ? 0.6 : 0.2,
          name_ar: this.isArabic(text) ? 0.65 : 0.2,
          website_url: href ? 0.5 : 0.1,
        },
      });
    });

    return companies;
  }

  // ── Pagination ───────────────────────────────────────────────────────────────
  //
  // Modon uses SharePoint pagination (PageFirstRow query param) and possibly
  // custom next/prev buttons.

  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    // SharePoint paging control (classic)
    $('a[href*="PageFirstRow"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) urls.push(this.resolveUrl(href, baseUrl));
    });

    // Standard pagination links
    const pageSels = [
      '.pagination a', '.pager a', '.page-numbers a',
      'a[rel="next"]', '.next-page a', 'a.ms-commandLink',
    ];
    for (const sel of pageSels) {
      $(sel).each((_, el) => {
        const href = $(el).attr('href');
        if (href) urls.push(this.resolveUrl(href, baseUrl));
      });
    }

    // Numeric pagination via ?page= or ?p=
    const patterns = [
      /href=["']([^"']*[?&]page=\d+[^"']*)["']/gi,
      /href=["']([^"']*[?&]p=\d+[^"']*)["']/gi,
      /href=["']([^"']*PageFirstRow=\d+[^"']*)["']/gi,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(html)) !== null) {
        urls.push(this.resolveUrl(m[1], baseUrl));
      }
    }

    return [...new Set(urls)];
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  /** True if the string contains a significant proportion of Arabic characters. */
  private isArabic(text: string): boolean {
    if (!text) return false;
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    return arabicChars / text.length > 0.3;
  }

  /** True if the href/text looks like a navigation/utility link to skip. */
  private isNavigationLink(href: string, text: string): boolean {
    const navTexts = [
      'home', 'about', 'contact', 'search', 'login', 'sign in', 'sign up',
      'english', 'arabic', 'ar', 'en', 'sitemap', 'privacy', 'terms',
      'الرئيسية', 'عن', 'تواصل', 'بحث', 'دخول',
    ];
    const lowerText = text.toLowerCase();
    if (navTexts.some(n => lowerText === n)) return true;

    const navHrefs = ['javascript:', 'mailto:', 'tel:', '#', '_layouts/', '_catalogs/'];
    return navHrefs.some(n => href.toLowerCase().startsWith(n));
  }

  /** True if the heading text is a common page section heading (not a company name). */
  private isPageHeading(text: string): boolean {
    const headings = [
      'factories', 'factory', 'companies', 'partners', 'our partners',
      'search', 'filter', 'results', 'list', 'directory', 'industrial',
      'المصانع', 'الشركاء', 'بحث', 'نتائج', 'قائمة',
    ];
    return headings.some(h => text.toLowerCase().trim() === h);
  }
}

// Auto-register
parserRegistry.register(new ModonAdapter());
