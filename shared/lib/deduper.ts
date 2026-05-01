/**
 * Enhanced Deduplication / Entity Resolution
 *
 * Responsible for:
 * - Detecting same company from multiple sources
 * - Merging by domain
 * - Fuzzy-matching names
 * - Preventing duplicate records
 *
 * Primary key priority:
 * 1. Normalized domain
 * 2. LinkedIn company URL
 * 3. Normalized company name + location
 */

import { extractDomain, canonicalizeUrl, urlsMatch } from './urlCanonicalizer';

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings (0-1).
 */
export function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1;

  const distance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
  return (longer.length - distance) / longer.length;
}

/**
 * Check if two company names are likely the same company.
 * Uses fuzzy matching with common business name variations.
 */
export function isSameCompanyName(name1: string, name2: string): { isMatch: boolean; confidence: number } {
  if (!name1 || !name2) return { isMatch: false, confidence: 0 };

  // Clean names for comparison
  const clean1 = name1
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|ag|limited|corporation|company)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const clean2 = name2
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|ag|limited|corporation|company)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Exact match after cleaning
  if (clean1 === clean2) {
    return { isMatch: true, confidence: 0.95 };
  }

  // One contains the other
  if (clean1.includes(clean2) || clean2.includes(clean1)) {
    const shorter = clean1.length < clean2.length ? clean1 : clean2;
    const longer = clean1.length < clean2.length ? clean2 : clean1;
    const ratio = shorter.length / longer.length;
    return { isMatch: ratio > 0.7, confidence: ratio * 0.8 };
  }

  // Fuzzy match
  const similarity = stringSimilarity(clean1, clean2);

  if (similarity > 0.85) {
    return { isMatch: true, confidence: similarity * 0.9 };
  }

  return { isMatch: false, confidence: similarity };
}

/**
 * Detect duplicate companies using multiple strategies.
 * Returns groups of companies that are likely duplicates.
 */
export function detectDuplicates(
  companies: Array<{
    id: string;
    name_en: string;
    website_url?: string;
    linkedin_url?: string;
    city?: string;
  }>
): Array<{
  group: string[];
  reason: string;
  confidence: number;
}> {
  const groups: Array<{ group: string[]; reason: string; confidence: number }> = [];
  const assigned = new Set<string>();

  for (let i = 0; i < companies.length; i++) {
    if (assigned.has(companies[i].id)) continue;

    const company = companies[i];
    const group: string[] = [company.id];
    let reason = '';
    let confidence = 0;

    // Strategy 1: Domain match (highest confidence)
    if (company.website_url) {
      const companyDomain = extractDomain(company.website_url);

      for (let j = i + 1; j < companies.length; j++) {
        if (assigned.has(companies[j].id)) continue;
        const other = companies[j];

        if (other.website_url) {
          const otherDomain = extractDomain(other.website_url);
          if (companyDomain && otherDomain && companyDomain === otherDomain) {
            group.push(other.id);
            reason = `Same domain: ${companyDomain}`;
            confidence = 0.95;
            assigned.add(other.id);
          }
        }
      }
    }

    // Strategy 2: LinkedIn URL match
    if (company.linkedin_url) {
      const cleanLinkedin = canonicalizeUrl(company.linkedin_url);

      for (let j = i + 1; j < companies.length; j++) {
        if (assigned.has(companies[j].id)) continue;
        const other = companies[j];

        if (other.linkedin_url) {
          const otherLinkedin = canonicalizeUrl(other.linkedin_url);
          if (cleanLinkedin && otherLinkedin && urlsMatch(cleanLinkedin, otherLinkedin)) {
            if (!group.includes(other.id)) {
              group.push(other.id);
              reason = reason || 'Same LinkedIn URL';
              confidence = Math.max(confidence, 0.9);
              assigned.add(other.id);
            }
          }
        }
      }
    }

    // Strategy 3: Fuzzy name match + same city (lower confidence)
    if (group.length === 1) {
      for (let j = i + 1; j < companies.length; j++) {
        if (assigned.has(companies[j].id)) continue;
        const other = companies[j];

        const nameMatch = isSameCompanyName(company.name_en, other.name_en);
        if (nameMatch.isMatch && nameMatch.confidence > 0.7) {
          // If same city, higher confidence
          if (company.city && other.city &&
              company.city.toLowerCase() === other.city.toLowerCase()) {
            group.push(other.id);
            reason = `Similar name (${(nameMatch.confidence * 100).toFixed(0)}%) + same city: ${company.city}`;
            confidence = Math.max(confidence, nameMatch.confidence * 0.85);
            assigned.add(other.id);
          }
          // Very high name similarity without city match
          else if (nameMatch.confidence > 0.9) {
            group.push(other.id);
            reason = `Very similar name (${(nameMatch.confidence * 100).toFixed(0)}%)`;
            confidence = Math.max(confidence, nameMatch.confidence * 0.7);
            assigned.add(other.id);
          }
        }
      }
    }

    // Only report groups with 2+ companies
    if (group.length > 1) {
      groups.push({ group, reason, confidence });
      assigned.add(company.id);
    }
  }

  return groups.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Merge two company records, preferring higher-confidence values.
 */
export function mergeCompanies(
  master: Record<string, unknown>,
  duplicate: Record<string, unknown>,
  options: { preferMaster?: string[] } = {}
): Record<string, unknown> {
  const preferMaster = options.preferMaster || ['name_en', 'name_ar', 'id'];
  const merged = { ...master };

  for (const [key, dupValue] of Object.entries(duplicate)) {
    if (key === 'id' || !dupValue) continue;

    const masterValue = merged[key];

    // Prefer master for specified fields
    if (preferMaster.includes(key) && masterValue) continue;

    // Merge arrays
    if (Array.isArray(masterValue) && Array.isArray(dupValue)) {
      merged[key] = [...new Set([...masterValue, ...dupValue])];
    }
    // Use duplicate value only if master doesn't have it
    else if (!masterValue || (typeof masterValue === 'string' && masterValue.trim() === '')) {
      merged[key] = dupValue;
    }
    // Keep master value
    else {
      // No action needed - keep master
    }
  }

  // Merge metadata
  merged.merged_from = [
    ...new Set([
      ...((master.merged_from as string[]) || [master.id]),
      duplicate.id
    ])
  ];

  return merged;
}

export const deduper = {
  isDuplicate: (c1: any, c2: any) => {
    // Exact domain match
    if (c1.website_url && c2.website_url) {
      const d1 = extractDomain(c1.website_url);
      const d2 = extractDomain(c2.website_url);
      if (d1 && d2 && d1 === d2) return { isDuplicate: true, confidence: 0.95 };
    }

    // Name match
    const nameMatch = isSameCompanyName(c1.name_en, c2.name_en);
    if (nameMatch.isMatch && nameMatch.confidence > 0.85) {
      return { isDuplicate: true, confidence: nameMatch.confidence };
    }

    return { isDuplicate: false, confidence: 0 };
  },
  detectDuplicates,
  mergeCompanies,
  stringSimilarity,
  isSameCompanyName
};
