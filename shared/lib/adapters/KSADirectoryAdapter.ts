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
import { BaseDirectoryParser, ParseResult, ParsedCompany, parserRegistry } from './DirectoryParserAdapter';

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

  /** KSA / SaudiDir single-business profile URLs (must use profile parser, not listing cards). */
  private isSingleCompanyProfileUrl(url: string): boolean {
    const lower = url.toLowerCase();
    if (lower.includes('ksa.directory') && /\/i\/\d+(\/|\?|#|$)/.test(lower)) return true;
    if (lower.includes('saudidir.com') && /\/i\/\d+(\/|\?|#|$)/i.test(lower)) return true;
    // saudidir.com commonly uses /ksa/<slug>/ for single listing pages
    if (lower.includes('saudidir.com') && /\/ksa\/[^/?#]+\/?$/.test(lower)) return true;
    return false;
  }

  async parse(html: string, baseUrl: string): Promise<ParseResult> {
    const $ = cheerio.load(html);

    // Profile pages must not go through listing heuristics first (false positives skip profile extraction).
    if (this.isSingleCompanyProfileUrl(baseUrl)) {
      const profileFirst = this.parseProfilePage($, baseUrl);
      if (profileFirst) {
        return {
          companies: [profileFirst],
          totalFound: 1,
          parseMethod: 'adapter',
          adapterName: this.name,
        };
      }
    }

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
   * KSA Directory often uses <a href="tel:966..." class="show-phone">Call Now</a>.
   * Selectors like [class*="phone"] match "show-phone" and yield invalid placeholder text,
   * which makes the whole company fail server-side validation.
   */
  /** Decode Cloudflare `data-cfemail` / `email-protection#` hex payloads. */
  private decodeCfHex(hex: string): string | null {
    const clean = hex.replace(/^#/, '').trim();
    if (!clean || clean.length < 4 || clean.length % 2 !== 0) return null;
    if (!/^[a-f0-9]+$/i.test(clean)) return null;
    const key = parseInt(clean.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < clean.length; i += 2) {
      const byte = parseInt(clean.slice(i, i + 2), 16) ^ key;
      out += String.fromCharCode(byte);
    }
    return out || null;
  }

  private extractPhoneFromContext($ctx: cheerio.Cheerio<any>): string {
    const telHref = $ctx.find('a[href^="tel:"]').first().attr('href');
    if (telHref) {
      const digits = telHref.replace(/^tel:/i, '').replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) return digits;
    }
    const itemprop = $ctx.find('[itemprop="telephone"]').first().text().trim();
    if (itemprop) {
      const digits = itemprop.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) return digits;
    }
    const legacy = $ctx.find('.phone, .tel, .contact-phone, .telephone').first().text().trim();
    if (legacy) {
      const digits = legacy.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) return digits;
    }
    return '';
  }

  /** KSA Directory hides email behind Cloudflare; plain mailto also supported. */
  private extractEmailFromProfile($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>): string {
    const cfAttr = $root.find('span[data-cfemail]').first().attr('data-cfemail')?.trim();
    if (cfAttr) {
      const decoded = this.decodeCfHex(cfAttr);
      if (decoded && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decoded)) return decoded;
    }
    const protHref =
      $root.find('a[href*="/cdn-cgi/l/email-protection#"]').first().attr('href') ||
      $('a[href*="/cdn-cgi/l/email-protection#"]').first().attr('href') ||
      '';
    const hash = protHref.split('#')[1];
    if (hash) {
      const decoded = this.decodeCfHex(hash);
      if (decoded && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decoded)) return decoded;
    }
    const mailto = $root.find('a[href^="mailto:"]').first().attr('href');
    if (mailto) {
      const addr = mailto.replace(/^mailto:/i, '').split('?')[0].trim();
      if (addr && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return addr;
    }
    const itemText = $root.find('[itemprop="email"]').first().text().replace(/\s+/g, ' ').trim();
    if (itemText && itemText.includes('@') && !/\[email/i.test(itemText) && !/protected/i.test(itemText)) {
      return itemText;
    }
    return '';
  }

  private extractOfficialWebsite($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>): string | undefined {
    let selected: string | undefined;
    $root.find('a[itemprop="url"][href^="http"]').each((_, el) => {
      if (selected) return;
      const href = $(el).attr('href')?.trim();
      if (!href) return;
      try {
        const host = new URL(href).hostname.toLowerCase();
        if (host.includes('ksa.directory') || host.includes('saudidir.com')) return;
        if (href.includes('maps.app.') || href.includes('google.com/maps')) return;
        if (host.includes('facebook.com') || host.includes('instagram.com') || host.includes('linkedin.com')) return;
        selected = href;
      } catch {
        /* invalid URL */
      }
    });
    return selected;
  }

  private extractDescriptionFromProfile($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>): string {
    const og = $('meta[property="og:description"]').attr('content')?.trim();
    if (og && og.length > 20) return og;
    const dataDesc = $root.find('.social-share[data-description]').first().attr('data-description')?.trim();
    if (dataDesc && dataDesc.length > 15) return dataDesc;
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
    if (ogTitle && ogTitle.length > 5) return ogTitle;
    return '';
  }

  private extractSocialHref($root: cheerio.Cheerio<any>, cls: string): string | undefined {
    const href = $root.find(`a.${cls}[href^="http"]`).first().attr('href')?.trim();
    return href || undefined;
  }

  private normalizeProductToken(s: string): string {
    return s
      .replace(/\s+/g, ' ')
      .replace(/^[\-\u2022•\*]+\s*/g, '')
      .replace(/[|/]+/g, ' ')
      .trim();
  }

  private isJunkProductToken(s: string): boolean {
    const t = s.trim().toLowerCase();
    if (!t) return true;
    if (t.length < 2 || t.length > 80) return true;
    if (/^(call now|send mail|share|claim this business|open in google maps)$/i.test(t)) return true;
    if (/^(https?:\/\/|www\.)/i.test(t)) return true;
    if (/^\+?\d{7,15}$/.test(t.replace(/\s/g, ''))) return true;
    if (t.includes('@')) return true;
    return false;
  }

  /**
   * KSA Directory sometimes has an (often-empty) "Products & Services" tab.
   * If the site doesn't embed those items in HTML, we fall back to parsing
   * the og/description "namely ..." list into product tokens.
   */
  private extractProductsFromProfile($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>, description: string): string[] {
    const products: string[] = [];

    // 1) DOM-based extraction (only specific areas; avoid broad selectors)
    const candidates = $root
      .find(
        [
          '#products',
          '#products-services',
          '#product-services',
          '[id*="product"][class*="tab"]',
          '.products-services',
          '.product-services',
          '.services-products',
          '.pro-services',
          '.service-list',
          '.products-list',
          '.product-list',
          '.services-list',
          '.product_service',
        ].join(', ')
      )
      .first();

    const $scope = candidates.length ? candidates : $root;

    $scope.find('ul li, .item, .tag, .badge').each((_, el) => {
      const text = this.normalizeProductToken($(el).text());
      if (this.isJunkProductToken(text)) return;
      if (!products.includes(text)) products.push(text);
    });

    // 2) Fallback: parse "namely ..." from description into product tokens
    if (products.length === 0 && description) {
      const desc = description.replace(/\s+/g, ' ').trim();
      const lower = desc.toLowerCase();
      const markers = ['namely', 'such as', 'including', 'like'];
      let startIdx = -1;
      for (const m of markers) {
        const i = lower.indexOf(`${m} `);
        if (i !== -1) {
          startIdx = i + m.length + 1;
          break;
        }
      }

      const slice = startIdx !== -1 ? desc.slice(startIdx) : '';
      const until = slice ? slice.split(/\.|;|…|\.\.\./)[0] : '';
      if (until) {
        until
          .split(',')
          .map((s) => this.normalizeProductToken(s))
          .filter((s) => !this.isJunkProductToken(s))
          .slice(0, 15)
          .forEach((s) => {
            if (!products.includes(s)) products.push(s);
          });
      }
    }

    // Cap list to prevent huge arrays
    return products.slice(0, 25);
  }

  /**
   * Parse directory listing pages (category/search results).
   */
  private parseDirectoryListings($: cheerio.CheerioAPI, baseUrl: string) {
    const companies: ParsedCompany[] = [];

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
        const phoneText = this.extractPhoneFromContext($card);
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
          phone: phoneText ? phoneText : undefined,
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

  /** Prefer listing hero / og:image — not the site header logo (wrong for company profiles). */
  private pickProfileLogoSrc($: cheerio.CheerioAPI): string | undefined {
    const og = $('meta[property="og:image"]').attr('content')?.trim();
    if (og && /^https?:\/\//i.test(og) && !/\/site\/img\/logo\.svg/i.test(og)) return og;

    const slider = $('.product-slider img[itemprop="image"][src], .product-slider img[src^="http"]').first();
    const slideSrc = slider.attr('src')?.trim() || slider.attr('data-src')?.trim();
    if (slideSrc && /^https?:\/\//i.test(slideSrc)) return slideSrc;

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
    const lower = (baseUrl || '').toLowerCase();

    // Prefer the main listing container on saudidir.com to avoid footer/review pollution.
    const $root = (() => {
      const candidates = [
        'article',
        '.single-listing',
        '.listing',
        '.listing-single',
        '.listing-content',
        '.content-area',
        'main',
        'section.product-detail',
      ];
      for (const sel of candidates) {
        const $c = $(sel).first();
        if ($c.length && $c.text().includes('Opening Hours')) return $c;
        if ($c.length && $c.find('h1').length) return $c;
      }
      return $('body');
    })();

    // Remove obvious global / non-business sections before extracting fields
    // (review forms, auth modals, nav/footer, newsletter, etc.)
    const $scoped = $root.clone();
    $scoped.find(
      [
        'nav',
        'header',
        'footer',
        'form',
        '#respond',
        '.comment-respond',
        '.comments-area',
        '.site-footer',
        '.newsletter',
        '.modal',
        'script',
        'style',
      ].join(', ')
    ).remove();

    const nameSelectors = ['h1.company-name', 'h1.business-name', 'h1', '.company-title', '.business-title', '.page-title'];
    let nameText = '';

    for (const sel of nameSelectors) {
      const text = $root.find(sel).first().text().trim() || $(sel).first().text().trim();
      if (text && text.length > 2) {
        nameText = text;
        break;
      }
    }

    if (!nameText) return null;

    const addressFromLocation = $scoped.find('[itemprop="location"]').first().text().replace(/\s+/g, ' ').trim();
    const addressTextRaw =
      addressFromLocation ||
      $scoped
        .find('.address, .location, .company-address, .business-address, .physical-address')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
    // Avoid treating map URLs as addresses on SaudiDir.
    const addressText = /maps\.app\.goo\.gl|google\.com\/maps/i.test(addressTextRaw) ? '' : addressTextRaw;

    const bestAddress = (() => {
      // SaudiDir: the real address is displayed next to the Leaflet map.
      // Avoid picking sentences from the description (e.g. "Operating through ... across Saudi Arabia").
      const isSaudiDir = lower.includes('saudidir.com');
      const pageText = $scoped.text().replace(/\s+/g, ' ').trim();

      const badSentence = (t: string) =>
        /operating through/i.test(t) ||
        /has emerged/i.test(t) ||
        /strategic vision/i.test(t) ||
        /portfolio/i.test(t);

      const candidates: string[] = [];
      if (isSaudiDir) {
        $scoped
          .find('li, p, div, span')
          .each((_, el) => {
            const t = $(el).text().replace(/\s+/g, ' ').trim();
            if (!t) return;
            if (t.length < 12 || t.length > 220) return;
            if (!/saudi\s+arabia|المملكة\s+العربية\s+السعودية/i.test(t)) return;
            if (badSentence(t)) return;
            // Heuristics for address-ish lines
            const looksLikeAddress =
              /street|st\.|road|rd\.|opp|opposite|po\s*box|p\.o\.|district|حي|طريق|شارع|صندوق/i.test(t) ||
              (t.includes(',') && /al\s+/i.test(t));
            if (!looksLikeAddress) return;
            candidates.push(t);
          });

        // Also try extracting a single "address line" from the full page text.
        const sentenceCandidates = pageText
          .split(/[.]/g)
          .map((s) => s.replace(/\s+/g, ' ').trim())
          .filter((t) =>
            t.length >= 15 &&
            t.length <= 200 &&
            /saudi\s+arabia|المملكة\s+العربية\s+السعودية/i.test(t) &&
            !badSentence(t) &&
            /street|road|opposite|opp|شارع|طريق|حي/i.test(t)
          );
        candidates.push(...sentenceCandidates);

        if (candidates.length > 0) {
          const ranked = candidates
            .map((t) => {
              let score = 0;
              if (/opposite|opp/i.test(t)) score += 3;
              if (/street|road|rd\.|st\./i.test(t)) score += 2;
              if (/al\s+khobar|khobar|riyadh|jeddah|dammam|medina|mecca|tabuk|yanbu|najran|jazan/i.test(t)) score += 2;
              if (t.includes(',')) score += 1;
              // prefer shorter, denser address lines
              score += Math.max(0, 200 - t.length) / 50;
              return { t, score };
            })
            .sort((a, b) => b.score - a.score);
          return ranked[0].t;
        }
      }

      // Fallback to previously captured addressText.
      return addressText;
    })();

    const descFromBlocks = $scoped
      .find('.company-description, .business-description, .about-company, .company-about, .about, .entry-content')
      .first()
      .text()
      .trim();
    const descFromMeta = this.extractDescriptionFromProfile($, $root);
    const descClean = (descFromBlocks || '').replace(/\s+/g, ' ').trim();
    const isReviewJunk = /save my name, email, and website in this browser/i.test(descClean);
    let descText =
      (!isReviewJunk && descClean.length > 40 ? descClean : '') || descFromMeta || (!isReviewJunk ? descClean : '') || '';

    // SaudiDir: if description is still junk/too short, take the first meaningful paragraph in main content.
    if (lower.includes('saudidir.com')) {
      const bad = (t: string) =>
        !t ||
        t.length < 80 ||
        /save my name, email, and website in this browser/i.test(t) ||
        /your email address will not be published/i.test(t) ||
        /write a review/i.test(t);

      if (bad(descText)) {
        const paras = $scoped
          .find('p')
          .toArray()
          .map((p) => $scoped.find(p).text().replace(/\s+/g, ' ').trim())
          .filter((t) => t.length >= 120 && !bad(t));
        if (paras[0]) descText = paras[0];
      }
    }

    // SaudiDir: pick phone/email from the "Contact Business" area if present
    const $contactZone =
      $scoped
        .find('section, div, aside')
        .filter((_, el) => /contact business/i.test($(el).text()))
        .first();
    const $contact = $contactZone.length ? $contactZone : $scoped;

    const phoneText = this.extractPhoneFromContext($contact) || this.extractPhoneFromContext($scoped);
    const emailRaw = this.extractEmailFromProfile($, $contact) || this.extractEmailFromProfile($, $scoped);
    const emailText =
      emailRaw && !/^(needhelp@company\.com|info@saudidir\.com)$/i.test(emailRaw) ? emailRaw : '';
    const websiteRaw = this.extractOfficialWebsite($, $root);
    const websiteLink = websiteRaw;

    const categories: string[] = [];
    $root.find('[itemprop="department"]').each((_, el) => {
      const text = $(el).text().replace(/\//g, ' ').trim();
      if (text && text.length > 1 && text.length < 80) categories.push(text);
    });
    $root.find('.tags a').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 80 && !categories.includes(text)) categories.push(text);
    });
    $root.find('.category, .tag, .industry a, .category a, .tag a, .sector a').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 50 && !categories.includes(text)) categories.push(text);
    });

    const products = lower.includes('saudidir.com') ? [] : this.extractProductsFromProfile($, $root, descText);

    let city = '';
    const saudiCities = ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Tabuk', 'Abha', 'Hail', 'Buraydah', 'Taif', 'Yanbu', 'Najran', 'Jazan'];
    for (const saudiCity of saudiCities) {
      if (addressText.includes(saudiCity)) {
        city = saudiCity;
        break;
      }
    }

    const linkedin_url = this.extractSocialHref($scoped, 'social-linkedin');
    const instagram_url = this.extractSocialHref($scoped, 'social-instagram');
    const facebook_url = this.extractSocialHref($scoped, 'social-facebook');

    const logoSrc = this.pickProfileLogoSrc($);
    let logo_url: string | undefined;
    if (logoSrc) {
      try {
        logo_url = this.resolveUrl(logoSrc, baseUrl);
      } catch {
        logo_url = logoSrc.startsWith('http') ? logoSrc : undefined;
      }
    }

    const full_address =
      (bestAddress && bestAddress.length > 5 ? bestAddress : undefined) ||
      undefined;

    return {
      name_en: this.cleanName(nameText),
      website_url: websiteLink ? this.resolveUrl(websiteLink, baseUrl) : undefined,
      logo_url,
      full_address,
      description_en: descText ? descText.slice(0, 8000) : undefined,
      phone: phoneText ? phoneText : undefined,
      email: emailText || undefined,
      linkedin_url,
      instagram_url,
      facebook_url,
      city: city || (bestAddress ? bestAddress.substring(0, 50) : undefined),
      categories: categories.length > 0 ? categories : undefined,
      products: products.length > 0 ? products : undefined,
      confidence_score: 0.72,
      source_url: baseUrl,
      field_confidence: {
        name_en: 0.9,
        name_ar: 0.15,
        website_url: websiteLink ? 0.88 : 0.2,
        description_en: descText.length > 50 ? 0.75 : descText ? 0.45 : 0.2,
        phone: phoneText ? 0.85 : 0.2,
        email: emailText ? 0.88 : 0.15,
        city: city ? 0.72 : (addressText ? 0.45 : 0.2),
        logo_url: logo_url ? 0.8 : 0.2,
        linkedin_url: linkedin_url ? 0.85 : 0.15,
      },
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
