/**
 * Page Classifier for Enrichment Crawl
 *
 * Classifies URLs into page types (homepage, about, contact, team, products, etc.)
 * to prioritize high-value pages during company website enrichment.
 */

export type PageType =
  | 'homepage'
  | 'about'
  | 'contact'
  | 'team'
  | 'products'
  | 'services'
  | 'news'
  | 'careers'
  | 'blog'
  | 'faq'
  | 'legal'
  | 'other';

export interface ClassifiedPage {
  url: string;
  pageType: PageType;
  confidence: number;
  content?: string;
}

/**
 * Common URL patterns that indicate page type.
 * Ordered by priority for enrichment: contact > about > team > products > homepage.
 */
const PAGE_PATTERNS: Array<{ pattern: RegExp; pageType: PageType; priority: number }> = [
  // Contact pages — highest value for enrichment
  { pattern: /\/contact/i, pageType: 'contact', priority: 10 },
  { pattern: /\/contacts/i, pageType: 'contact', priority: 10 },
  { pattern: /\/get-in-touch/i, pageType: 'contact', priority: 10 },
  { pattern: /\/reach-us/i, pageType: 'contact', priority: 10 },

  // About pages — high value
  { pattern: /\/about/i, pageType: 'about', priority: 9 },
  { pattern: /\/about-us/i, pageType: 'about', priority: 9 },
  { pattern: /\/who-we-are/i, pageType: 'about', priority: 9 },
  { pattern: /\/company/i, pageType: 'about', priority: 8 },
  { pattern: /\/our-story/i, pageType: 'about', priority: 8 },
  { pattern: /\/profile/i, pageType: 'about', priority: 7 },

  // Team pages — medium-high value
  { pattern: /\/team/i, pageType: 'team', priority: 7 },
  { pattern: /\/leadership/i, pageType: 'team', priority: 7 },
  { pattern: /\/management/i, pageType: 'team', priority: 7 },
  { pattern: /\/our-people/i, pageType: 'team', priority: 7 },

  // Products/Services pages — medium value
  { pattern: /\/product/i, pageType: 'products', priority: 6 },
  { pattern: /\/products/i, pageType: 'products', priority: 6 },
  { pattern: /\/service/i, pageType: 'services', priority: 6 },
  { pattern: /\/solutions/i, pageType: 'products', priority: 5 },
  { pattern: /\/catalog/i, pageType: 'products', priority: 5 },

  // Careers — low value for company data
  { pattern: /\/career/i, pageType: 'careers', priority: 3 },
  { pattern: /\/join/i, pageType: 'careers', priority: 3 },

  // News/Blog — low value
  { pattern: /\/news/i, pageType: 'news', priority: 2 },
  { pattern: /\/blog/i, pageType: 'blog', priority: 2 },
  { pattern: /\/press/i, pageType: 'news', priority: 2 },
  { pattern: /\/media/i, pageType: 'news', priority: 2 },
  { pattern: /\/article/i, pageType: 'news', priority: 1 },

  // Legal — low value
  { pattern: /\/privacy/i, pageType: 'legal', priority: 1 },
  { pattern: /\/terms/i, pageType: 'legal', priority: 1 },
  { pattern: /\/legal/i, pageType: 'legal', priority: 1 },
  { pattern: /\/cookie/i, pageType: 'legal', priority: 1 },
  { pattern: /\/gdpr/i, pageType: 'legal', priority: 1 },

  // FAQ — medium-low value
  { pattern: /\/faq/i, pageType: 'faq', priority: 3 },
  { pattern: /\/help/i, pageType: 'faq', priority: 3 },
  { pattern: /\/support/i, pageType: 'faq', priority: 3 },
];

/**
 * Classify a single URL into a page type.
 */
export const classifyPage = (url: string, baseUrl: string): ClassifiedPage => {
  try {
    const parsed = new URL(url, baseUrl);
    const path = parsed.pathname.toLowerCase();

    // Homepage detection
    if (path === '/' || path === '/index.html' || path === '/home' || path === '/en' || path === '/ar') {
      return { url, pageType: 'homepage', confidence: 0.95 };
    }

    // Strip trailing slash for matching
    const cleanPath = path.replace(/\/$/, '');

    for (const { pattern, pageType, priority } of PAGE_PATTERNS) {
      if (pattern.test(cleanPath)) {
        // Higher priority patterns get higher confidence
        const confidence = Math.min(0.95, 0.5 + (priority / 20));
        return { url, pageType, confidence };
      }
    }

    return { url, pageType: 'other', confidence: 0.3 };
  } catch {
    return { url, pageType: 'other', confidence: 0.1 };
  }
};

/**
 * Classify and prioritize pages for enrichment crawl.
 * Returns pages sorted by enrichment priority, limited to maxPages.
 * Always includes homepage first, then contact, about, team, products.
 */
export const prioritizePages = (
  urls: string[],
  baseUrl: string,
  maxPages: number = 5
): ClassifiedPage[] => {
  const classified = urls.map(url => classifyPage(url, baseUrl));

  // Sort by priority: homepage first, then contact, about, team, products, then others
  const pageTypeOrder: Record<PageType, number> = {
    homepage: 0,
    contact: 1,
    about: 2,
    team: 3,
    products: 4,
    services: 5,
    faq: 6,
    careers: 7,
    news: 8,
    blog: 9,
    legal: 10,
    other: 11,
  };

  classified.sort((a, b) => {
    const aOrder = pageTypeOrder[a.pageType] ?? 11;
    const bOrder = pageTypeOrder[b.pageType] ?? 11;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.confidence - a.confidence;
  });

  return classified.slice(0, maxPages);
};

/**
 * Get the recommended page fetch order for enrichment.
 * Returns a list of page types to target, in order.
 */
export const getEnrichmentPageOrder = (): PageType[] => {
  return ['homepage', 'contact', 'about', 'team', 'products', 'services'];
};
