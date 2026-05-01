
export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  alternates?: { lang: string; loc: string }[];
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateSitemapXml(urls: SitemapUrl[]): string {
  const urlEntries = urls.map(url => {
    let xml = `  <url>\n    <loc>${escapeXml(url.loc)}</loc>`;
    
    if (url.alternates && url.alternates.length > 0) {
      url.alternates.forEach(alt => {
        xml += `\n    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${escapeXml(alt.loc)}" />`;
      });
    }

    if (url.lastmod) xml += `\n    <lastmod>${url.lastmod}</lastmod>`;
    if (url.changefreq) xml += `\n    <changefreq>${url.changefreq}</changefreq>`;
    if (url.priority !== undefined) xml += `\n    <priority>${url.priority.toFixed(1)}</priority>`;
    xml += '\n  </url>';
    return xml;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries}
</urlset>`;
}

export function generateSitemapIndexXml(sitemaps: string[]): string {
  const entries = sitemaps.map(loc => {
    return `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n  </sitemap>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;
}
