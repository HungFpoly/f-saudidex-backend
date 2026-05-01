/**
 * Saudi Industry Guide Adapter
 *
 * Parses company listings from saudiindustryguide.com
 * An industry-focused directory with categorized company listings.
 *
 * URL: https://saudiindustryguide.com/
 */

import * as cheerio from 'cheerio';
import { BaseDirectoryParser, ParseResult, ParsedCompany, parserRegistry } from './DirectoryParserAdapter';

export class SaudiIndustryGuideAdapter extends BaseDirectoryParser {
  readonly id = 'saudi-industry-guide';
  readonly name = 'Saudi Industry Guide';

  matches(url: string): number {
    return url.includes('saudiindustryguide.com') ? 0.95 : 0;
  }

  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);

    // Profile pages (single company) should be parsed differently than the homepage guide.
    const isHome =
      (() => {
        try {
          const u = new URL(baseUrl);
          return u.pathname === '/' || u.pathname === '';
        } catch {
          return baseUrl === 'https://saudiindustryguide.com' || baseUrl === 'https://saudiindustryguide.com/';
        }
      })();

    if (!isHome) {
      const profile = this.parseProfilePage($, baseUrl);
      if (profile) {
        return { companies: [profile], totalFound: 1, parseMethod: 'adapter', adapterName: this.name };
      }
      // If we couldn't confidently parse a profile page, do NOT fall back to guide parsing.
      // Profile pages often contain many non-company headings (e.g., "Our mission") that look like listings.
      return {
        companies: [],
        totalFound: 0,
        parseMethod: 'adapter',
        adapterName: this.name,
        warnings: ['Profile page did not match expected patterns (skipped listing parse to avoid junk records)'],
      };
    }

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

  /** Strip trailing source suffix sometimes concatenated into scraped titles. */
  private stripGuideTitleSuffix(name: string): string {
    return this.normalizeLine(name).replace(/\s*\|\s*Saudi\s+Industry\s+Guide\s*$/i, '').trim();
  }

  // NOTE: We intentionally do NOT map "Website:" rows to the next heading.
  // On saudiindustryguide.com homepage, the "Website:" line belongs to the CURRENT company section
  // (after the heading). Mapping it to the next heading shifts websites by one and causes duplicates.

  private parseCompanyCardListings($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];
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
        const nameSelectors = ['h3 a', 'h2 a', 'h4 a', 'h3', 'h2', 'h4', '.company-name', '.title a', '.title'];
        let nameText = '';
        let nameLink = '';

        for (const sel of nameSelectors) {
          const $nameEl = $card.find(sel).first();
          if ($nameEl.length) {
            nameText = $nameEl.text().trim();
            nameLink = $nameEl.attr('href') || $nameEl.find('a').attr('href') || '';
            if (nameText) break;
          }
        }

        if (!nameText || nameText.length < 2) return;

        const descText = $card.find('.description, .company-desc, .summary, .excerpt, p').first().text().trim();
        const websiteLink = $card.find('.website a, .company-url a, a.external-link').attr('href');

        const categories: string[] = [];
        $card.find('.category, .tag, .industry, .sector a, .category a, .tag a, .industry a').each((_, cel) => {
          const text = $(cel).text().trim();
          if (text && text.length > 1 && text.length < 50) categories.push(text);
        });

        const locationText = $card.find('.location, .city, .address, .country').first().text().trim();

        const products: string[] = [];
        $card.find('.product, .products a, [class*="product"] a').each((_, pel) => {
          const text = $(pel).text().trim();
          if (text && text.length > 1 && text.length < 100) products.push(text);
        });

        companies.push({
          name_en: this.cleanName(this.stripGuideTitleSuffix(nameText)),
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
    return companies;
  }

  private parseCompanyTableListings($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const companies: ParsedCompany[] = [];
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
        if (i === 0) return;
        const $cells = $(row).find('td');
        if ($cells.length < 2) return;

        const nameText = $cells.eq(0).text().trim();
        if (!nameText) return;

        const nameLink = $cells.eq(0).find('a').attr('href');

        companies.push({
          name_en: this.cleanName(this.stripGuideTitleSuffix(nameText)),
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
    return companies;
  }

  /**
   * Parse company listings from the industry guide.
   * Homepage is usually a long article (h3/h4 + Website lines). Broad "card" selectors often match
   * partial shells without contact rows — then article parsing never ran. We compare and prefer article
   * when the page looks like a guide and article extraction found multiple companies.
   */
  private parseCompanyListings($: cheerio.CheerioAPI, baseUrl: string) {
    const article = this.parseArticleSections($, baseUrl);
    const cards = this.parseCompanyCardListings($, baseUrl);
    const tables = cards.length === 0 ? this.parseCompanyTableListings($, baseUrl) : [];
    const legacy = cards.length > 0 ? cards : tables;

    const webCount = (xs: ParsedCompany[]) => xs.filter(c => !!c.website_url).length;
    const bodyText = this.normalizeLine($('body').text());
    const pageLooksGuide = /\bwebsite\s*:/i.test(bodyText) && $('h3, h4').length >= 2;

    if (pageLooksGuide && article.length >= 2) return article;
    if (article.length >= 2 && webCount(article) >= webCount(legacy)) return article;

    if (legacy.length > 0) return legacy;
    return article;
  }

  /** Main article / profile body — never scan full document (sidebar/footer pollutes). */
  private pickMainContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
    const selectors = ['main', '[role="main"]', 'article', '.post-content', '.entry-content', '.page-content', '.content', '#content'];
    for (const sel of selectors) {
      const $n = $(sel).first();
      if ($n.length && this.normalizeLine($n.text()).length > 80) return $n;
    }
    for (const sel of selectors) {
      const $n = $(sel).first();
      if ($n.length) return $n;
    }
    return $('body');
  }

  private parseProfilePage($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany | null {
    const h1 = this.normalizeLine($('h1').first().text());
    const ogTitle = this.normalizeLine($('meta[property="og:title"]').attr('content') || '');
    const docTitle = this.normalizeLine($('title').text());
    const looksGeneric = (t: string) => {
      const v = this.normalizeLine(t).toLowerCase();
      if (!v) return true;
      return [
        'products', 'product', 'services', 'service', 'contact', 'about', 'home', 'overview',
        'المنتجات', 'منتجات', 'خدمات', 'الخدمات', 'اتصل', 'نبذة', 'الرئيسية'
      ].includes(v);
    };
    // On many profile pages, the first H1 is a section heading (e.g., "Products") not the company name.
    // Prefer OG/title tags when present; fall back to H1 only if it doesn't look generic.
    const rawTitle =
      (ogTitle && !looksGeneric(ogTitle) ? ogTitle : '') ||
      (docTitle && !looksGeneric(docTitle) ? docTitle : '') ||
      (!looksGeneric(h1) ? h1 : '') ||
      ogTitle || docTitle || h1;

    const title = this.stripGuideTitleSuffix(this.normalizeLine(rawTitle));
    if (!title || title.length < 2) return null;

    const $root = this.pickMainContentRoot($).clone();
    $root.find('aside, nav, footer, header, .sidebar, #sidebar, .widget, .menu, .navigation, .nav, .breadcrumb').remove();
    const blockText = this.normalizeLine($root.text());
    const split = this.splitBilingualTitle(title);

    // Guardrail: some "profile" URLs contain content for a different company (site content issue).
    // Example: a Noor Sar URL whose main H1 + Website line are for "LineMachinery".
    // If the main content H1 looks like a real company name and strongly disagrees with our title, skip this page.
    const contentH1 = this.normalizeLine($root.find('h1').first().text());
    const tokenSet = (s: string) =>
      new Set(
        this.normalizeLine(s)
          .toLowerCase()
          .replace(/[^a-z0-9\u0600-\u06ff\s]/g, ' ')
          .split(/\s+/)
          .filter(t => t.length >= 3)
      );
    const overlapRatio = (a: string, b: string) => {
      const A = tokenSet(a);
      const B = tokenSet(b);
      if (A.size === 0 || B.size === 0) return 0;
      let inter = 0;
      for (const t of A) if (B.has(t)) inter++;
      return inter / Math.min(A.size, B.size);
    };
    if (contentH1 && !looksGeneric(contentH1)) {
      // Only apply this check when the H1 looks like a company name (Latin brand / domain).
      // Many profiles start with an Arabic product heading; that should not invalidate the page.
      const h1LooksCompanyish = /[a-z]/i.test(contentH1) || /\.[a-z]{2,}\b/i.test(contentH1);
      if (h1LooksCompanyish) {
        const o = overlapRatio(contentH1, split.name_en);
        // Require at least some token overlap; otherwise this is likely another company's content.
        if (o < 0.34) return null;
      }
    }

    // Website: try explicit label first (accepts https://, www., or bare domain),
    // then look for anchors near a Website label.
    const websiteLabelRaw = blockText.match(/\bwebsite\b\s*[:\-]?\s*([^\s|]+)\b/i)?.[1] ?? null;
    let website = websiteLabelRaw ? this.normalizeWebsiteCandidate(websiteLabelRaw) : null;
    if (!website) {
      const domain = (() => { try { return new URL(baseUrl).hostname.replace(/^www\./,''); } catch { return 'saudiindustryguide.com'; } })();
      const socials = /(facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com)/i;
      // Some "Website:" links are <a> without href (JS click). Use websiteCandidateFromAnchor() to read text/data/onclick.
      $root.find('a').each((_, el) => {
        if (website) return;
        const $a = $(el);
        const parents = [$a.parent(), $a.parent().parent(), $a.parent().parent().parent()];
        const hasWebsiteLabel = parents.some(p => this.normalizeLine(p.text()).toLowerCase().includes('website'));
        if (!hasWebsiteLabel) return;
        const candidate = this.websiteCandidateFromAnchor($a);
        if (!candidate) return;
        if (socials.test(candidate)) return;
        try {
          const abs = this.normalizeWebsiteCandidate(candidate);
          if (!abs) return;
          const h = new URL(abs).hostname.replace(/^www\./,'');
          if (h.includes(domain)) return;
          website = abs;
        } catch { }
      });
    }

    // Guardrail (continued): if the "Website:" value appears to belong to a different company section on this page,
    // prefer skipping this profile entirely (so homepage listing data can be used instead).
    if (website) {
      try {
        const host = new URL(website).hostname.replace(/^www\./i, '');
        const hostCore = host.split('.').slice(0, -1).join(' ') || host.split('.')[0] || host;
        const pageHeadings = $root
          .find('h1, h2')
          .toArray()
          .map((el) => this.normalizeLine($(el).text()))
          .filter((t) => t && !looksGeneric(t));

        let best = { heading: '', hostOverlap: 0, titleOverlap: 0 };
        for (const h of pageHeadings) {
          const ho = overlapRatio(h, hostCore);
          if (ho > best.hostOverlap) {
            best = { heading: h, hostOverlap: ho, titleOverlap: overlapRatio(h, split.name_en) };
          }
        }

        // If a heading strongly matches the website host (e.g., "LineMachinery") but not the page title ("Noor Sar"),
        // this page content is mismatched; skip it to avoid wrong website/email.
        if (best.hostOverlap >= 0.5 && best.titleOverlap < 0.34) return null;
      } catch { /* ignore */ }
    }

    let email = blockText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}(?![a-z])/i)?.[0];
    const mailto = $root.find('a[href^="mailto:"]').first().attr('href');
    if (mailto) {
      const addr = mailto.replace(/^mailto:/i, '').split('?')[0].trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) email = addr;
    }
    if (email) {
      email = this.normalizeLine(email).replace(/(phone|tel|location).*/i, '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = undefined as any;
    }
    // Ignore site-wide footer email (not a company contact)
    if (email && /@saudiindustryguide\.com$/i.test(email)) {
      email = undefined as any;
    }
    const phoneMatch = blockText.match(/\b(phone|tel)\b\s*[:\-]?\s*([\d+][\d\s\-()]{6,25})/i);
    let phone = phoneMatch ? this.normalizePhoneCandidate(phoneMatch[2]) : undefined;
    const tel = $root.find('a[href^="tel:"]').first().attr('href');
    if (tel) {
      const digits = tel.replace(/^tel:/i, '').replace(/[^\d+]/g, '').replace(/^00/, '+');
      const normalized = this.normalizePhoneCandidate(digits) || this.normalizePhoneCandidate(tel);
      if (normalized) phone = normalized;
      else if (digits.length >= 7) phone = digits;
    }
    const loc = blockText.match(/\blocation\b\s*[:\-]?\s*([^|]+?)(?=\bwebsite\b|\bemail\b|\bphone\b|$)/i)?.[1];
    const full_address = loc ? this.normalizeLine(loc).slice(0, 160) : undefined;

    if (!website) {
      const inferred = this.inferWebsiteFromCompanyName(split.name_en);
      if (inferred) website = inferred;
    }

    return {
      name_en: this.cleanName(this.stripGuideTitleSuffix(split.name_en)),
      name_ar: split.name_ar,
      website_url: website ? this.resolveUrl(website, baseUrl) : undefined,
      email: email || undefined,
      phone: phone || undefined,
      full_address,
      confidence_score: 0.72,
      source_url: baseUrl,
      field_confidence: {
        name_en: 0.9,
        name_ar: split.name_ar ? 0.75 : 0.2,
        website_url: website ? 0.85 : 0.2,
        email: email ? 0.8 : 0.2,
        phone: phone ? 0.8 : 0.2,
        full_address: full_address ? 0.7 : 0.2,
      }
    };
  }

  private normalizeLine(s: string): string {
    return s.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private splitBilingualTitle(title: string): { name_en: string; name_ar?: string } {
    const t = this.normalizeLine(title);
    // Common pattern: Arabic name (English Name)
    const m = t.match(/^(.*?)\s*\((.*?)\)\s*$/);
    if (m) {
      const left = this.normalizeLine(m[1] ?? '');
      const inside = this.normalizeLine(m[2] ?? '');
      const insideHasLatin = /[A-Za-z]/.test(inside);
      const leftHasArabic = /[\u0600-\u06FF]/.test(left);
      const leftHasLatin = /[A-Za-z]/.test(left);

      if (insideHasLatin) {
        // Prefer inside as English if it contains Latin letters
        return {
          name_en: inside,
          name_ar: leftHasArabic && !leftHasLatin ? left : undefined,
        };
      }

      // If inside doesn't look English, keep the full title as name_en
      return { name_en: t };
    }

    return { name_en: t };
  }

  private extractFieldValue(line: string, label: string): string | null {
    const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'i');
    const m = line.match(re);
    if (!m?.[1]) return null;
    const v = this.normalizeLine(m[1]);
    if (!v || v === '—' || v === '-') return null;
    return v;
  }

  private firstMatch(text: string, re: RegExp): string | null {
    const m = text.match(re);
    if (!m) return null;
    return this.normalizeLine(m[1] ?? m[0] ?? '');
  }

  private normalizeWebsiteCandidate(raw: string): string | null {
    let v = this.normalizeLine(raw);
    if (!v) return null;
    v = v.replace(/[)\].,;]+$/g, '').trim();
    v = v.replace(/(email|phone|location).*/i, '').trim();
    // Trim surrounding junk
    v = v.replace(/^website\s*[:\-]?\s*/i, '').trim();
    v = v.replace(/^www\./i, 'www.'); // normalize casing

    // Accept: https://x, http://x, www.x.com, x.com
    if (!/^https?:\/\//i.test(v)) {
      // If it's clearly a domain/hostname, add scheme.
      const candidate = v.replace(/^www\./i, '');
      const host = candidate.split(/[\/\s]/)[0];
      if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
        v = `https://${candidate}`;
      } else {
        return null;
      }
    }

    return this.cleanWebsiteCandidate(v);
  }

  private normalizePhoneCandidate(raw: string): string | undefined {
    const t = this.normalizeLine(raw);
    if (!t) return undefined;
    // Extract candidates like +966..., 059..., 00966..., etc. Pick first that validates (7-15 digits).
    const matches = t.match(/(\+?\d[\d\s\-()]{6,30})/g) || [];
    const tryOne = (s: string): string | undefined => {
      const digits = s.replace(/[^\d+]/g, '').replace(/^00/, '+');
      const cleanDigits = digits.replace(/[^\d]/g, '');
      if (cleanDigits.length >= 7 && cleanDigits.length <= 15) return digits.startsWith('+') ? digits : `+${digits}`.replace(/^\+\+/, '+');
      return undefined;
    };
    for (const m of matches) {
      const p = tryOne(m);
      if (p) return p;
    }
    // Fallback: if string is like "+9665...+9665..." (no spaces), split by '+' and retry
    const parts = t.split('+').map(x => x.trim()).filter(Boolean).map(x => `+${x}`);
    for (const part of parts) {
      const p = tryOne(part);
      if (p) return p;
    }
    return undefined;
  }

  private firstUrlLike(text: string): string | null {
    const t = this.normalizeLine(text);
    if (!t) return null;
    // Don't treat email domains as websites.
    if (/@/.test(t)) {
      const http = t.match(/https?:\/\/[^\s"'<>]+/i)?.[0] || null;
      return http ? http.trim() : null;
    }
    const m =
      t.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ||
      t.match(/\bwww\.[a-z0-9.-]+\.[a-z]{2,}\b/i)?.[0] ||
      t.match(/\b[a-z0-9.-]+\.(com|net|org|io|sa|co|me|biz|info)\b/i)?.[0] ||
      null;
    if (!m) return null;
    const s = m.trim();
    // Ignore common XML namespace URLs that appear in inline SVG icons.
    if (/w3\.org\/2000\/svg/i.test(s) || /^w3\.org$/i.test(s) || /^www\.w3\.org$/i.test(s)) return null;
    return s;
  }

  private websiteCandidateFromAnchor($a: cheerio.Cheerio<any>): string | null {
    const attrKeys = [
      'href',
      'data-href',
      'data-url',
      'data-link',
      'data-website',
      'data-target',
      'data-src',
    ];
    for (const k of attrKeys) {
      const v = ($a.attr(k) || '').toString().trim();
      const found = this.firstUrlLike(v);
      if (found) return found;
    }
    const onclick = ($a.attr('onclick') || '').toString();
    const fromOnclick = this.firstUrlLike(onclick);
    if (fromOnclick) return fromOnclick;
    const text = this.normalizeLine($a.text());
    const fromText = this.firstUrlLike(text);
    if (fromText) return fromText;
    // Parent HTML often contains inline SVG icons with xmlns="http://www.w3.org/2000/svg"
    // which can be mis-detected as a website. Strip SVG before scanning.
    const parentHtmlRaw = ($a.parent().html() || '').toString();
    const parentHtml = parentHtmlRaw
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/http:\/\/www\.w3\.org\/2000\/svg/gi, ' ')
      .replace(/https?:\/\/www\.w3\.org\/2000\/svg/gi, ' ');
    const fromHtml = this.firstUrlLike(parentHtml);
    if (fromHtml) return fromHtml;
    const parentText = this.normalizeLine($a.parent().text());
    const fromParentText = this.firstUrlLike(parentText);
    if (fromParentText) return fromParentText;
    return null;
  }

  private cleanWebsiteCandidate(raw: string): string | null {
    let v = this.normalizeLine(raw);
    if (!v) return null;
    // Strip trailing punctuation and common concatenation artifacts like "...comEmail"
    v = v.replace(/[)\].,;]+$/g, '').trim();
    v = v.replace(/(email|phone|location).*/i, '').trim();
    // Ensure scheme and plausible hostname
    if (!/^https?:\/\//i.test(v)) return null;
    try {
      // If concatenation produced a path like "/email/", drop it.
      const u = new URL(v);
      if (u.pathname.toLowerCase().includes('email')) u.pathname = '/';
      return u.toString().replace(/\/+$/,'/') // normalize single trailing slash
        .replace(/\/$/, u.pathname === '/' ? '' : '/'); // keep no slash for root
    } catch {
      return v;
    }
  }

  /** Heading is a bare hostname (e.g. Linemachinery.com) with no Website: line. */
  private inferWebsiteFromCompanyName(name: string): string | undefined {
    const n = this.normalizeLine(name);
    if (!n || n.length < 4) return undefined;
    if (/[\u0600-\u06FF]/.test(n) && !/\./.test(n)) return undefined;
    const host = n.replace(/^https?:\/\//i, '').split(/[\s/]/)[0].replace(/^www\./i, '');
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) return undefined;
    if (!/\.(com|net|org|io|sa|co|me|biz|info)\b/i.test(host)) return undefined;
    try {
      return new URL(`https://${host}`).origin;
    } catch {
      return undefined;
    }
  }

  /**
   * SaudiIndustryGuide often renders as a long guide/article:
   * - Each company is a section heading (h3/h4)
   * - Followed by Arabic + English description paragraphs
   * - Then explicit labeled lines: Website:, Email:, Phone:, Location:
   */
  private parseArticleSections($: cheerio.CheerioAPI, baseUrl: string): ParsedCompany[] {
    const results: ParsedCompany[] = [];
    // Scope headings to the main content area to avoid menu/footer headings.
    const $root = this.pickMainContentRoot($).clone();
    $root.find('aside, nav, footer, header, .sidebar, #sidebar, .widget, .menu, .navigation, .nav, .breadcrumb').remove();
    // Some guide pages use h2 for company names; include it but keep strict filtering below.
    const $headings = $root.find('h2, h3, h4').filter((_, el) => this.normalizeLine($(el).text()).length > 2);

    if ($headings.length === 0) return results;

    const pushCompany = (company: Partial<ParsedCompany>) => {
      const name = (company.name_en || '').toString().trim();
      if (!name || name.length < 2) return;
      results.push({
        name_en: this.cleanName(this.stripGuideTitleSuffix(name)),
        website_url: company.website_url,
        email: company.email,
        phone: company.phone,
        full_address: company.full_address,
        description_en: company.description_en,
        categories: company.categories,
        products: company.products,
        confidence_score: company.confidence_score ?? 0.65,
        source_url: baseUrl,
        field_confidence: company.field_confidence ?? {
          name_en: 0.9,
          website_url: company.website_url ? 0.8 : 0.2,
          email: company.email ? 0.8 : 0.2,
          phone: company.phone ? 0.8 : 0.2,
          full_address: company.full_address ? 0.7 : 0.2,
          description_en: company.description_en ? 0.7 : 0.2,
        }
      });
    };

    $headings.each((idx, el) => {
      const title = this.normalizeLine($(el).text());
      // Skip obvious non-company headings
      if (/^select page$/i.test(title)) return;
      if (/^saudi industry guide$/i.test(title)) return;
      if (/^(products?|services?|our mission|mission|vision|about|contact)$/i.test(title)) return;
      if (/^(المنتجات|منتجات|الخدمات|خدمات|رسالتنا|عن\s+الشركة|اتصل\s+بنا)$/i.test(title)) return;

      const $heading = $(el);
      // Primary content is AFTER the heading until the next company heading.
      // IMPORTANT: do NOT include prevUntil/prevAll here. This page sometimes renders
      // the *previous* company's contact row right before the next <h3>, which would
      // shift websites by one. We instead use `leadWebsites` mapping for the rare
      // "Website row before heading" layout.
      const $after = $heading.nextUntil('h2, h3, h4');
      const $blockRaw = $after;
      const $block = $blockRaw.clone();
      $block.find('aside, nav, footer, header, .sidebar, #sidebar, .widget, .menu, .navigation, .nav, .breadcrumb').remove();
      const sectionText = this.normalizeLine($block.text());
      const hasAnyContactLabel = /\b(website|email|phone|location)\b\s*:/i.test(sectionText);
      if (!sectionText) return;
      // Some companies have short sections but still include contact rows. Keep them.
      if (sectionText.length < 20 && !hasAnyContactLabel) return;

      const splitTitle = this.splitBilingualTitle(title);
      // Do NOT seed from leadWebsites: on this homepage, Website rows are usually AFTER the heading.
      // `leadWebsites` is only a fallback for the rare layout where Website row appears BEFORE the next heading.
      let website: string | undefined;
      let email: string | undefined;
      let phone: string | undefined;
      let location: string | undefined;
      let descEn: string | undefined;

      // DOM-first contact extraction (more reliable than text regex for this site)
      if (!website) {
        $block.find('a').each((_, a) => {
          if (website) return;
          const $a = $(a);
          const parents = [$a.parent(), $a.parent().parent(), $a.parent().parent().parent()];
          const parentText = parents.map(p => this.normalizeLine(p.text()).toLowerCase()).join(' ');
          const hasWebsiteLabel = parentText.includes('website');
          if (!hasWebsiteLabel) return;

          const candidate = this.websiteCandidateFromAnchor($a);
          if (!candidate) return;
          if (/(saudiindustryguide\.com|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com)/i.test(candidate)) return;
          const cleaned = this.normalizeWebsiteCandidate(candidate);
          if (cleaned) website = cleaned;
        });
      }
      if (!email) {
        const mailto = $block.find('a[href^="mailto:"]').first().attr('href');
        if (mailto) {
          const addr = mailto.replace(/^mailto:/i, '').split('?')[0].trim();
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) email = addr;
        }
      }
      if (!phone) {
        const tel = $block.find('a[href^="tel:"]').first().attr('href');
        if (tel) {
          const digits = tel.replace(/^tel:/i, '').replace(/[^\d+]/g, '').replace(/^00/, '+');
          const normalized = this.normalizePhoneCandidate(digits) || this.normalizePhoneCandidate(tel);
          if (normalized) phone = normalized;
          else if (digits.length >= 7) phone = digits;
        }
      }

      // Pull labeled lines from text nodes. We also inspect <p> boundaries for better splitting.
      const lines: string[] = [];
      $block.find('p, li, div').each((_, node) => {
        const t = this.normalizeLine($(node).text());
        if (t) lines.push(t);
      });
      if (lines.length === 0) {
        // Worst case: split raw text by common separators
        sectionText.split(/[\r\n]+| {2,}/).map(s => this.normalizeLine(s)).filter(Boolean).forEach(l => lines.push(l));
      }

      for (const line of lines) {
        const w = this.extractFieldValue(line, 'Website');
        if (w && !website) {
          const cleaned = this.normalizeWebsiteCandidate(w);
          if (cleaned) website = cleaned;
        }
        const e = this.extractFieldValue(line, 'Email');
        if (e && !email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) email = e;
        const p = this.extractFieldValue(line, 'Phone');
        if (p && !phone) {
          phone = this.normalizePhoneCandidate(p) || p;
        }
        const loc = this.extractFieldValue(line, 'Location');
        if (loc && !location) location = loc;
      }

      // Fallback: some pages concatenate fields without newlines/spaces (e.g. "... Website: https://x Email: y ...")
      if (!website) {
        const w = this.firstMatch(sectionText, /\bwebsite\b\s*[:\-]?\s*([^\s]+)(?=\bemail\b|\bphone\b|\blocation\b|\s|$)/i);
        const cleaned = w ? this.normalizeWebsiteCandidate(w) : null;
        if (cleaned) website = cleaned;
      }

      if (!email) {
        const e = this.firstMatch(sectionText, /\bemail\b\s*[:\-]?\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?=\bphone\b|\blocation\b|\s|$)/i);
        if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) email = e;
      }
      if (!phone) {
        const p = this.firstMatch(sectionText, /\bphone\b\s*[:\-]?\s*([\d+][\d\s\-()]{6,25})(?=\blocation\b|\bemail\b|\s|$)/i);
        if (p) {
          phone = this.normalizePhoneCandidate(p) || p;
        }
      }
      if (!location) {
        const loc = this.firstMatch(sectionText, /\blocation\b\s*[:\-]?\s*(.+?)(?=\bwebsite\b|\bemail\b|\bphone\b|$)/i);
        if (loc && loc.length > 3 && loc.length < 120) location = loc;
      }

      // Pick an English description: first paragraph that contains mostly latin letters
      const englishPara = lines.find(l => /[a-zA-Z]/.test(l) && l.length > 40 && !/^website:|^email:|^phone:|^location:/i.test(l));
      if (englishPara) descEn = englishPara;

      if (!website) {
        const inferred = this.inferWebsiteFromCompanyName(splitTitle.name_en);
        if (inferred) website = inferred;
      }

      pushCompany({
        ...splitTitle,
        website_url: website ? this.resolveUrl(website, baseUrl) : undefined,
        email,
        phone,
        full_address: location,
        description_en: descEn,
        confidence_score: (website || email || phone) ? 0.72 : 0.6,
        field_confidence: {
          name_en: 0.9,
          name_ar: /[\u0600-\u06FF]/.test(title) ? 0.75 : 0.2,
          website_url: website ? 0.85 : 0.2,
          email: email ? 0.85 : 0.2,
          phone: phone ? 0.8 : 0.2,
          full_address: location ? 0.75 : 0.2,
          description_en: descEn ? 0.7 : 0.2,
        }
      });
    });

    // Dedupe by name + website
    const deduped = results.filter((c, i, arr) => {
      const n = (c.name_en || '').toLowerCase();
      const w = (c.website_url || '').toLowerCase();
      return arr.findIndex(x => (x.name_en || '').toLowerCase() === n && (x.website_url || '').toLowerCase() === w) === i;
    });

    return deduped;
  }

  /**
   * Discover pagination URLs.
   */
  discoverPagination(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const $ = cheerio.load(html);

    // Pagination links (if any)
    $('.pagination a, .pager a, .page-numbers a, .next a, a[rel="next"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) urls.push(this.resolveUrl(href, baseUrl));
    });

    // Company profile links (often provides contact details vs the homepage guide)
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href) return;
      // Only crawl http(s) links
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
      // Skip obvious nav / non-company pages
      if (/\/(privacy|terms|contact|news|events|search)/i.test(href)) return;
      const abs = this.resolveUrl(href, baseUrl);
      if (!abs.includes('saudiindustryguide.com')) return;
      try {
        const u = new URL(abs);
        if (u.pathname === '/' || u.pathname === '') return;
        // Skip hubs / indexes
        if (/\/(all-pages|wp-admin|wp-login|feed)\b/i.test(u.pathname)) return;
        // Keep only single-slug pages (company profiles). Avoid deep paths.
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.length !== 1) return;
        urls.push(abs);
      } catch { }
    });

    return [...new Set(urls)];
  }
}

parserRegistry.register(new SaudiIndustryGuideAdapter());
