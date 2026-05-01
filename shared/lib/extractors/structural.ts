import * as cheerio from 'cheerio';

export interface StructuralData {
  name?: string;
  legalName?: string;
  description?: string;
  url?: string;
  logo?: string;
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
    full?: string;
  };
  phone?: string[];
  email?: string[];
  socials?: Record<string, string>;
  vatNumber?: string;
  crNumber?: string;
  foundIn: string[]; // List of schemas found (Organization, LocalBusiness, etc.)
}

/**
 * Universal Metadata Harvester
 * Extracts high-fidelity structured data from HTML before AI processing.
 */
export function harvestStructuralData(html: string): StructuralData {
  const $ = cheerio.load(html);
  const result: StructuralData = {
    phone: [],
    email: [],
    socials: {},
    foundIn: []
  };

  // 1. Process all JSON-LD blocks
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).html();
      if (!content) return;
      const data = JSON.parse(content);
      const items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);

      for (const item of items) {
        processJsonLdItem(item, result);
      }
    } catch (e) {
      // Ignore malformed JSON
    }
  });

  // 2. Process Meta Tags (OpenGraph, Twitter, Geo)
  $('meta').each((_, el) => {
    const name = $(el).attr('name') || $(el).attr('property');
    const content = $(el).attr('content');
    if (!name || !content) return;

    if (name === 'og:site_name' && !result.name) result.name = content;
    if (name === 'og:description' && !result.description) result.description = content;
    if (name === 'description' && !result.description) result.description = content;
    if (name === 'og:url' && !result.url) result.url = content;
    if (name === 'og:image' && !result.logo) result.logo = content;
    
    // Geo tags
    if (name === 'geo.placename') {
      result.address = result.address || {};
      result.address.full = (result.address.full ? result.address.full + ', ' : '') + content;
    }
  });

  // Unique the arrays
  result.phone = Array.from(new Set(result.phone)).filter(Boolean);
  result.email = Array.from(new Set(result.email)).filter(Boolean);
  result.foundIn = Array.from(new Set(result.foundIn));

  return result;
}

function processJsonLdItem(item: any, result: StructuralData) {
  if (!item || typeof item !== 'object') return;

  const type = item['@type'];
  if (type) {
    const typeStr = Array.isArray(type) ? type.join(',') : String(type);
    if (/Organization|Corporation|LocalBusiness|Store|Place/i.test(typeStr)) {
      result.foundIn.push(typeStr);
    }
  }

  // Basic info
  if (item.name && !result.name) result.name = String(item.name);
  if (item.legalName && !result.legalName) result.legalName = String(item.legalName);
  if (item.description && !result.description) result.description = String(item.description);
  if (item.url && !result.url) result.url = String(item.url);
  
  // Logo
  if (item.logo) {
    const logoUrl = typeof item.logo === 'string' ? item.logo : item.logo.url;
    if (logoUrl && !result.logo) result.logo = String(logoUrl);
  }

  // Contact
  if (item.telephone) {
    const phones = Array.isArray(item.telephone) ? item.telephone : [item.telephone];
    result.phone?.push(...phones.map(String));
  }
  if (item.email) {
    const emails = Array.isArray(item.email) ? item.email : [item.email];
    result.email?.push(...emails.map(String));
  }

  // Address
  if (item.address) {
    result.address = result.address || {};
    const addr = item.address;
    if (typeof addr === 'string') {
      result.address.full = addr;
    } else {
      if (addr.streetAddress) result.address.street = String(addr.streetAddress);
      if (addr.addressLocality) result.address.city = String(addr.addressLocality);
      if (addr.addressRegion) result.address.region = String(addr.addressRegion);
      if (addr.postalCode) result.address.postalCode = String(addr.postalCode);
      if (addr.addressCountry) result.address.country = typeof addr.addressCountry === 'string' ? addr.addressCountry : addr.addressCountry.name;
    }
  }

  // Socials
  if (item.sameAs) {
    const urls = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
    for (const u of urls) {
      if (typeof u !== 'string') continue;
      if (u.includes('linkedin.com')) result.socials!.linkedin = u;
      if (u.includes('twitter.com') || u.includes('x.com')) result.socials!.twitter = u;
      if (u.includes('facebook.com')) result.socials!.facebook = u;
      if (u.includes('instagram.com')) result.socials!.instagram = u;
    }
  }

  // Saudi Specifics (custom schema often used in business directories)
  if (item.taxID && !result.vatNumber) result.vatNumber = String(item.taxID);
  if (item.id && String(item.id).match(/^\d{10}$/)) result.crNumber = String(item.id);
}
