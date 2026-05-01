/**
 * Data Validator Service for Saudidex
 *
 * Validates extracted data before it's stored in the database.
 * Ensures data quality and prevents invalid entries from entering the system.
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CompanyData {
  name_en?: string;
  name_ar?: string;
  business_type?: string;
  description_en?: string;
  description_ar?: string;
  website_url?: string;
  phone?: string;
  email?: string;
  city?: string;
  categories?: string[];
  products?: string[];
  services?: string[];
  brands?: string[];
  locations?: string[];
  secondary_emails?: string[];
  secondary_phones?: string[];
  secondary_websites?: string[];
  secondary_linkedin?: string[];
  secondary_socials?: string[];
  team_members?: { name: string; role: string }[];
  [key: string]: any; // Allow additional fields
}

export class Validator {
  /**
   * Validate a company record
   */
  validateCompany(company: CompanyData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields:
    // Accept Arabic-only source names by falling back to name_ar when name_en is missing/invalid.
    const hasValidEnglishName = this.isValidName(company.name_en, 'en');
    const hasValidArabicName = this.isValidName(company.name_ar || '', 'ar');
    if (!hasValidEnglishName && !hasValidArabicName) {
      errors.push('Company name in English is required and must be valid');
    } else if (!hasValidEnglishName && hasValidArabicName) {
      warnings.push('English name is missing; using Arabic company name as fallback');
    }

    if (company.name_ar && !this.isValidName(company.name_ar, 'ar')) {
      warnings.push('Arabic name provided but appears to be invalid');
    }

    if (company.business_type && !this.isValidBusinessType(company.business_type)) {
      errors.push('Invalid business type. Must be "vendor", "manufacturer", or "trader"');
    }

    if (company.website_url && !this.isValidUrl(company.website_url)) {
      errors.push(`Invalid website URL: ${company.website_url}`);
    }

    if (company.phone && !this.isValidPhone(company.phone)) {
      errors.push(`Invalid phone number: ${company.phone}`);
    }

    if (company.email && !this.isValidEmail(company.email)) {
      errors.push(`Invalid email: ${company.email}`);
    }

    if (company.city && !this.isValidCityName(company.city)) {
      errors.push(`Invalid city name: ${company.city}`);
    }

    // Validate array fields
    if (company.categories && !this.isValidStringArray(company.categories, 'categories')) {
      errors.push('Categories array contains invalid entries');
    }

    if (company.products && !this.isValidStringArray(company.products, 'products')) {
      errors.push('Products array contains invalid entries');
    }

    if (company.services && !this.isValidStringArray(company.services, 'services')) {
      errors.push('Services array contains invalid entries');
    }

    if (company.brands && !this.isValidStringArray(company.brands, 'brands')) {
      errors.push('Brands array contains invalid entries');
    }

    if (company.locations && !this.isValidStringArray(company.locations, 'locations')) {
      errors.push('Locations array contains invalid entries');
    }

    if (company.secondary_emails && !this.isValidStringArray(company.secondary_emails, 'secondary_emails')) {
      errors.push('Secondary emails array contains invalid entries');
    }

    if (company.secondary_phones && !this.isValidStringArray(company.secondary_phones, 'secondary_phones')) {
      errors.push('Secondary phones array contains invalid entries');
    }

    if (company.secondary_websites && !this.isValidStringArray(company.secondary_websites, 'secondary_websites')) {
      errors.push('Secondary websites array contains invalid entries');
    }

    if (company.secondary_socials && !this.isValidStringArray(company.secondary_socials, 'secondary_socials')) {
      errors.push('Secondary socials array contains invalid entries');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate an email address
   */
  isValidEmail(email: string): boolean {
    if (!email) return false;
    
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email) && email.length <= 254;
  }

  /**
   * Validate a phone number
   */
  isValidPhone(phone: string): boolean {
    if (!phone) return false;

    // Remove common formatting characters
    const cleanPhone = phone.replace(/[\s\-\(\)\+\.]/g, '');
    
    // Check if it contains only digits and is of reasonable length
    if (!/^\d+$/.test(cleanPhone)) return false;
    
    // For Saudi Arabia, numbers typically start with 5, 6, 7, 8, or 9 and are 9-15 digits
    // But we'll be more flexible to accommodate international formats
    return cleanPhone.length >= 7 && cleanPhone.length <= 15;
  }
  /**
   * Validate a URL
   */
  isValidUrl(url: string): boolean {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) && 
             parsed.hostname.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Validate a name (English or Arabic)
   */
  isValidName(name: string, language: 'en' | 'ar' = 'en'): boolean {
    if (!name) return false;

    // Enforce name length between 2 and 200 characters for ALL languages (audit recommendation)
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 200) {
      return false;
    }

    // For English names, basic alphanumeric and common punctuation
    if (language === 'en') {
      // Allow letters, numbers, spaces, hyphens, apostrophes, periods, commas
      const validChars = /^[a-zA-Z0-9\s\u00C0-\u017F\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]+$/;
      return validChars.test(name);
    } else {
      // For Arabic names, allow Arabic characters plus Latin characters, numbers, and basic punctuation
      const validChars = /^[\u0600-\u06FF\s\u0750-\u077F\u08A0-\u08FFa-zA-Z0-9\u2000-\u206F\u2E00-\u2E7F\s\\!"#$%&'()*+,\-./:;<=>?@\[\]^_`{|}~]+$/;
      return validChars.test(name);
    }
  }

  /**
   * Validate a city name
   */
  isValidCityName(city: string): boolean {
    if (!city) return false;

    // Basic checks: non-empty, not too long
    if (city.trim().length < 2 || city.trim().length > 100) {
      return false;
    }

    // Allow letters, spaces, hyphens, and accented characters (for international cities)
    const validChars = /^[a-zA-Z\u00C0-\u017F\s\-']+$/;
    return validChars.test(city.trim());
  }

  /**
   * Validate a confidence score (0.0 to 1.0)
   */
  isValidConfidence(score: unknown): boolean {
    return typeof score === 'number' && 
           Number.isFinite(score) &&
           score >= 0 && 
           score <= 1;
  }

  /**
   * Sanitize a confidence score for persistence/display.
   * Invalid values are clamped to 0.0 and logged.
   */
  sanitizeConfidence(score: unknown, fieldName: string = 'confidence'): number {
    return this.sanitizeConfidenceWithReport(score, fieldName).score;
  }

  /**
   * Sanitize a confidence score for persistence/display.
   * Invalid values are clamped to 0.0 and returns if clamping occurred.
   */
  sanitizeConfidenceWithReport(score: unknown, fieldName: string = 'confidence'): { score: number; clamped: boolean } {
    if (this.isValidConfidence(score)) {
      return { score: score as number, clamped: false };
    }

    console.warn(`[Validator] Invalid ${fieldName}: ${String(score)}. Clamping to 0.0`);
    return { score: 0.0, clamped: true };
  }

  /**
   * Sanitize a map of field confidence scores.
   * Preserves keys and clamps invalid values to 0.0.
   */
  sanitizeConfidenceMap(
    confidenceMap: unknown,
    fieldName: string = 'field_confidence'
  ): Record<string, number> {
    if (!confidenceMap || typeof confidenceMap !== 'object' || Array.isArray(confidenceMap)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(confidenceMap as Record<string, unknown>).map(([key, value]) => [
        key,
        this.sanitizeConfidence(value, `${fieldName}.${key}`),
      ])
    );
  }

  /**
   * Sanitize confidence-bearing company payload fields while preserving
   * enrichment-only metadata such as field_evidence/field_confidence.
   * Returns a report indicating if any field was clamped.
   */
  sanitizeCompanyConfidencePayload<T extends Record<string, any>>(payload: T): { sanitized: T; clamped: boolean } {
    let anyClamped = false;
    const sanitized = { ...payload } as Record<string, unknown>;

    if ('confidence_score' in sanitized) {
      const result = this.sanitizeConfidenceWithReport(
        sanitized.confidence_score,
        'confidence_score'
      );
      sanitized.confidence_score = result.score;
      if (result.clamped) anyClamped = true;
    }

    if ('field_confidence' in sanitized) {
      const confidenceMap = sanitized.field_confidence as Record<string, unknown>;
      if (confidenceMap && typeof confidenceMap === 'object' && !Array.isArray(confidenceMap)) {
        const newMap: Record<string, number> = {};
        for (const [key, value] of Object.entries(confidenceMap)) {
          const result = this.sanitizeConfidenceWithReport(value, `field_confidence.${key}`);
          newMap[key] = result.score;
          if (result.clamped) anyClamped = true;
        }
        sanitized.field_confidence = newMap;
      }
    }

    if (
      sanitized.extraction_metadata &&
      typeof sanitized.extraction_metadata === 'object' &&
      !Array.isArray(sanitized.extraction_metadata)
    ) {
      const extractionMetadata = {
        ...(sanitized.extraction_metadata as Record<string, unknown>),
      };

      if ('field_confidence' in extractionMetadata) {
        const confidenceMap = extractionMetadata.field_confidence as Record<string, unknown>;
        if (confidenceMap && typeof confidenceMap === 'object' && !Array.isArray(confidenceMap)) {
          const newMap: Record<string, number> = {};
          for (const [key, value] of Object.entries(confidenceMap)) {
            const result = this.sanitizeConfidenceWithReport(value, `extraction_metadata.field_confidence.${key}`);
            newMap[key] = result.score;
            if (result.clamped) anyClamped = true;
          }
          extractionMetadata.field_confidence = newMap;
        }
      }

      sanitized.extraction_metadata = extractionMetadata;
    }

    return { sanitized: sanitized as T, clamped: anyClamped };
  }

  /**
   * Sanitize a company payload before writing it to the companies table.
   * Removes legacy non-column keys that should never reach PostgREST.
   */
  sanitizeCompanyPersistencePayload<T extends Record<string, any>>(payload: T): T {
    const { sanitized } = this.sanitizeCompanyConfidencePayload(payload);
    const final = { ...sanitized } as Record<string, unknown>;

    // Map city and address to full_address before deleting if full_address is missing
    if (!final.full_address) {
      const parts = [];
      if (final.address && typeof final.address === 'string') parts.push(final.address.trim());
      if (final.city && typeof final.city === 'string') parts.push(final.city.trim());
      if (parts.length > 0) {
        final.full_address = parts.join(', ');
      }
    }

    delete final.city;
    delete final.address;
    delete final.field_confidence;
    delete final.field_evidence;
    delete final.company_details;

    return final as T;
  }

  /**
   * Validate business type
   */
  isValidBusinessType(type: string): boolean {
    return ['vendor', 'manufacturer', 'trader'].includes(type.toLowerCase());
  }

  /**
   * Validate an array of strings
   */
  isValidStringArray(arr: string[], fieldName: string): boolean {
    if (!Array.isArray(arr)) {
      return false;
    }

    // Check if array is too long (prevent abuse)
    if (arr.length > 50) {
      console.warn(`Validator: ${fieldName} array has more than 50 items, consider reducing`);
    }

    // Check each item in the array
    for (const item of arr) {
      if (typeof item !== 'string' || item.trim().length === 0 || item.length > 200) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate an array of company records
   */
  validateCompanies(companies: CompanyData[]): { valid: CompanyData[]; invalid: { company: CompanyData; errors: string[] }[] } {
    const valid: CompanyData[] = [];
    const invalid: { company: CompanyData; errors: string[] }[] = [];

    for (const company of companies) {
      const result = this.validateCompany(company);
      if (result.isValid) {
        valid.push(company);
      } else {
        invalid.push({ company, errors: result.errors });
      }
    }

    return { valid, invalid };
  }

  /**
   * Sanitize a company record by removing potentially harmful content
   */
  sanitizeCompany(company: CompanyData): CompanyData {
    const sanitized: CompanyData = { ...company };

    // Sanitize string fields
    if (sanitized.name_en) sanitized.name_en = this.sanitizeString(sanitized.name_en);
    if (sanitized.name_ar) sanitized.name_ar = this.sanitizeString(sanitized.name_ar);
    if ((!sanitized.name_en || !sanitized.name_en.trim()) && sanitized.name_ar?.trim()) {
      sanitized.name_en = sanitized.name_ar.trim();
    }
    if (sanitized.description_en) sanitized.description_en = this.sanitizeString(sanitized.description_en);
    if (sanitized.description_ar) sanitized.description_ar = this.sanitizeString(sanitized.description_ar);
    if (sanitized.website_url) sanitized.website_url = this.sanitizeUrl(sanitized.website_url);
    if (sanitized.phone) sanitized.phone = this.sanitizeString(sanitized.phone);
    if (sanitized.email) sanitized.email = this.sanitizeString(sanitized.email);
    if (sanitized.youtube_url) sanitized.youtube_url = this.sanitizeUrl(sanitized.youtube_url);
    if (sanitized.tiktok_url) sanitized.tiktok_url = this.sanitizeUrl(sanitized.tiktok_url);

    // Sanitize array fields
    if (sanitized.categories) sanitized.categories = sanitized.categories.map(item => this.sanitizeString(item));
    if (sanitized.products) sanitized.products = sanitized.products.map(item => this.sanitizeString(item));
    if (sanitized.services) sanitized.services = sanitized.services.map(item => this.sanitizeString(item));
    if (sanitized.brands) sanitized.brands = sanitized.brands.map(item => this.sanitizeString(item));
    if (sanitized.locations) sanitized.locations = sanitized.locations.map(item => this.sanitizeString(item));
    
    if (sanitized.secondary_emails) sanitized.secondary_emails = sanitized.secondary_emails.map(item => this.sanitizeString(item));
    if (sanitized.secondary_phones) sanitized.secondary_phones = sanitized.secondary_phones.map(item => this.sanitizeString(item));
    if (sanitized.secondary_websites) sanitized.secondary_websites = sanitized.secondary_websites.map(item => this.sanitizeUrl(item));
    if (sanitized.secondary_linkedin) sanitized.secondary_linkedin = sanitized.secondary_linkedin.map(item => this.sanitizeUrl(item));
    if (sanitized.secondary_socials) sanitized.secondary_socials = sanitized.secondary_socials.map(item => this.sanitizeUrl(item));

    if (sanitized.team_members && Array.isArray(sanitized.team_members)) {
      sanitized.team_members = sanitized.team_members.map((tm: any) => ({
        name: this.sanitizeString(tm.name || ''),
        role: this.sanitizeString(tm.role || '')
      }));
    }

    // Not DB columns on companies — strip so PostgREST upserts do not fail
    // Map city and address to full_address before deleting if full_address is missing
    if (!sanitized.full_address) {
      const parts = [];
      if (sanitized.address && typeof sanitized.address === 'string') parts.push(sanitized.address.trim());
      if (sanitized.city && typeof sanitized.city === 'string') parts.push(sanitized.city.trim());
      if (parts.length > 0) {
        sanitized.full_address = parts.join(', ');
      }
    }

    delete (sanitized as Record<string, unknown>).city;
    delete (sanitized as Record<string, unknown>).address;

    return sanitized;
  }

  /**
   * Sanitize a string by removing potentially harmful content
   */
  private sanitizeString(str: string): string {
    if (!str) return str;
    
    // Remove potentially dangerous content
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')  // Remove script tags
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')  // Remove iframe tags
      .replace(/javascript:/gi, '')  // Remove javascript: protocol
      .replace(/vbscript:/gi, '')    // Remove vbscript: protocol
      .replace(/onload=/gi, '')      // Remove onload attributes
      .replace(/onerror=/gi, '')     // Remove onerror attributes
      .trim();
  }

  /**
   * Sanitize a URL
   */
  private sanitizeUrl(url: string): string {
    if (!url) return url;
    
    // Ensure the URL starts with http:// or https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    return this.sanitizeString(url);
  }
}

// Export a singleton instance
export const validator = new Validator();
