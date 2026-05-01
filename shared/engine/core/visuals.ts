import * as cheerio from "cheerio";

const EXCLUDED_DOMAINS = [
  'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com', 
  'youtube.com', 'google.com', 'snapchat.com', 'google-analytics.com',
  'googletagmanager.com', 'cloudfront.net', 'wp.com', 'gravatar.com'
];

const EXCLUDED_KEYWORDS = [
  'facebook', 'twitter', 'linkedin', 'instagram', 'youtube', 'snapchat',
  'social', 'icon', 'btn', 'button', 'loading', 'spinner', 'pixel',
  'google', 'play-store', 'app-store', 'avatar', 'user', 'chamber',
  'mcci', 'government', 'fsc', 'modon', 'eamana', 'vision2030'
];

/**
 * Extracts high-quality logos and header images from raw HTML.
 */
export function discoverVisuals(html: string, baseUrl: string): { logo_url: string | null; header_url: string | null } {
  if (!html) return { logo_url: null, header_url: null };
  const $ = cheerio.load(html);
  let logo_url: string | null = null;
  let header_url: string | null = null;

  const resolve = (path: string | null) => {
    if (!path) return null;
    if (path.startsWith('data:')) return null;
    try {
      const url = new URL(path, baseUrl).toString();
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      const pathLower = urlObj.pathname.toLowerCase();

      // Skip social media and generic CDNs
      if (EXCLUDED_DOMAINS.some(d => domain.includes(d))) return null;
      
      // Skip common host-level assets that aren't company logos
      const hostDomain = new URL(baseUrl).hostname.toLowerCase();
      if (domain === hostDomain) {
        const genericAssets = ['/assets/', '/static/', '/wp-content/themes/', '/header', '/footer', '/nav', '/theme/'];
        const isGenericPath = genericAssets.some(ga => pathLower.includes(ga));
        
        // If it's a generic path, it MUST contain 'logo' AND NOT contain directory keywords
        if (isGenericPath) {
          if (!pathLower.includes('logo')) return null;
          if (['chamber', 'mcci', 'fsc', 'modon', 'eamana'].some(k => pathLower.includes(k))) return null;
        }
      }

      if (EXCLUDED_KEYWORDS.some(k => url.toLowerCase().includes(k) && !url.toLowerCase().includes('logo'))) {
         // Only allow if it explicitly contains 'logo' AND doesn't look like a social icon
         if (EXCLUDED_KEYWORDS.filter(ek => ek !== 'icon').some(k => url.toLowerCase().includes(k))) return null;
      }
      return url;
    } catch {
      return null;
    }
  };

  // 1. Look for Social Metadata (High Quality)
  const metaLogo = $('meta[property="og:image"]').attr('content') || 
                   $('meta[name="twitter:image"]').attr('content') || 
                   $('meta[property="og:image:secure_url"]').attr('content');
  
  logo_url = resolve(metaLogo || null);

  // 2. Look for explicit icons (Large ones)
  if (!logo_url) {
    const icon = $('link[rel="apple-touch-icon"]').attr('href') || 
                 $('link[rel="icon"][sizes="192x192"]').attr('href') ||
                 $('link[rel="icon"][sizes="512x512"]').attr('href') ||
                 $('link[rel="shortcut icon"]').attr('href');
    logo_url = resolve(icon || null);
  }

  // 3. Look for logo patterns in DOM (Prioritize images with 'logo' in their path/alt)
  if (!logo_url) {
    const logoSelectors = [
      'img[src*="logo" i]',
      'img[id*="logo" i]',
      'img[class*="logo" i]',
      'img[alt*="logo" i]',
      '.navbar-brand img',
      '.header-logo img',
      'header img',
      '.logo img'
    ];
    for (const sel of logoSelectors) {
      const img = $(sel).first();
      const src = img.attr('src');
      const resolved = resolve(src || null);
      if (resolved) {
        logo_url = resolved;
        break;
      }
    }
  }

  // 4. Look for Header/Hero images (Banners)
  const headerSelectors = [
    '.hero img',
    '.banner img',
    '.main-banner img',
    '.slider img',
    '#hero-banner img',
    'main img',
    'section:first-of-type img',
    'div[style*="background-image"]'
  ];
  for (const sel of headerSelectors) {
    let src = $(sel).first().attr('src');
    if (!src && sel.includes('background-image')) {
       const style = $(sel).first().attr('style');
       const match = style?.match(/url\(['"]?([^'"]+)['"]?\)/);
       if (match) src = match[1];
    }
    
    const resolved = resolve(src || null);
    // Ensure header is different from logo
    if (resolved && resolved !== logo_url) {
      header_url = resolved;
      break;
    }
  }

  return {
    logo_url,
    header_url
  };
}

/**
 * Downloads an image and returns it as a base64 string for Vision AI.
 */
export async function downloadImageAsBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    const data = Buffer.from(buffer).toString('base64');
    
    return { mimeType, data };
  } catch (e) {
    console.error(`[Visuals] Failed to download image: ${url}`, e);
    return null;
  }
}
