/**
 * Enhanced Normalizer
 *
 * Responsible for:
 * - Standardizing company names
 * - Formatting phone numbers
 * - Validating emails
 * - Cleaning whitespace
 * - Normalizing countries/cities
 * - Removing junk values
 */

// Saudi cities with normalized names
const SAUDI_CITIES: Record<string, string> = {
  'riyadh': 'Riyadh', 'الرياض': 'Riyadh',
  'jeddah': 'Jeddah', 'جدة': 'Jeddah',
  'mecca': 'Mecca', 'مكة': 'Mecca',
  'medina': 'Medina', 'المدينة': 'Medina',
  'dammam': 'Dammam', 'الدمام': 'Dammam',
  'khobar': 'Al Khobar', 'الخبر': 'Al Khobar',
  'dhahran': 'Dhahran', 'الظهران': 'Dhahran',
  'tabuk': 'Tabuk', 'تبوك': 'Tabuk',
  'abha': 'Abha', 'أبها': 'Abha',
  'hail': 'Hail', 'حائل': 'Hail',
  'buraydah': 'Buraydah', 'بريدة': 'Buraydah',
  'taif': 'Taif', 'الطائف': 'Taif',
  'yanbu': 'Yanbu', 'ينبع': 'Yanbu',
  'najran': 'Najran', 'نجران': 'Najran',
  'jazan': 'Jazan', 'جازان': 'Jazan'
};

// Country name variations
const COUNTRY_VARIATIONS = ['saudi arabia', 'ksa', 'sa', 'saudi', 'المملكة العربية السعودية'];

/**
 * Clean and normalize a company name.
 * Removes legal suffixes, extra whitespace, and special characters.
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return '';

  let cleaned = name.trim();

  // Remove common legal suffixes
  const suffixes = [
    'co.', 'corp.', 'ltd.', 'llc', 'inc.', 'gmbh', 'ag',
    'limited', 'corporation', 'company', 'establishment',
    'للمساهمة', 'المحدودة', 'ذات المسؤولية المحدودة'
  ];

  for (const suffix of suffixes) {
    const regex = new RegExp(`\\s+${suffix.replace('.', '\\.')}$`, 'i');
    cleaned = cleaned.replace(regex, '');
  }

  // Clean whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Remove trademark symbols
  cleaned = cleaned.replace(/[™®©]/g, '');

  return cleaned;
}

/**
 * Normalize and format a phone number to international format.
 * Handles Saudi phone number formats.
 */
export function normalizePhone(phone: string): { formatted: string | null; confidence: number } {
  if (!phone) return { formatted: null, confidence: 0 };

  // Clean the phone number
  let cleaned = phone.replace(/[\s\-().]/g, '');

  // Remove non-digit characters except +
  cleaned = cleaned.replace(/[^\d+]/g, '');

  // Handle Saudi numbers
  if (cleaned.startsWith('05')) {
    // Saudi mobile: 05XXXXXXXX → +9665XXXXXXXX
    cleaned = '+966' + cleaned.substring(1);
  } else if (cleaned.startsWith('5') && cleaned.length === 9) {
    // Saudi mobile without leading 0: 5XXXXXXXX → +9665XXXXXXXX
    cleaned = '+966' + cleaned;
  } else if (cleaned.startsWith('01') && cleaned.length >= 10) {
    // Saudi landline: 01XXXXXXXX → +9661XXXXXXXX
    cleaned = '+966' + cleaned.substring(1);
  } else if (cleaned.startsWith('1') && cleaned.length === 9) {
    // Saudi landline without leading 0: 1XXXXXXXX → +9661XXXXXXXX
    cleaned = '+966' + cleaned;
  } else if (cleaned.startsWith('+966')) {
    // Already in international format
    cleaned = cleaned;
  } else if (cleaned.startsWith('966')) {
    // Missing + sign
    cleaned = '+' + cleaned;
  } else if (cleaned.length >= 7 && cleaned.length <= 15) {
    // Unknown format but valid length
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
  } else {
    return { formatted: null, confidence: 0 };
  }

  // Final validation
  const isValid = /^\+\d{7,15}$/.test(cleaned);

  return {
    formatted: isValid ? cleaned : null,
    confidence: isValid ? 0.8 : 0
  };
}

/**
 * Validate and normalize an email address.
 */
export function normalizeEmail(email: string): { formatted: string | null; isValid: boolean } {
  if (!email) return { formatted: null, isValid: false };

  const cleaned = email.trim().toLowerCase();

  // Basic email validation
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned);

  return {
    formatted: isValid ? cleaned : null,
    isValid
  };
}

/**
 * Normalize city name to standard format.
 * Handles Arabic and English variations.
 */
export function normalizeCity(city: string): { normalized: string | null; confidence: number } {
  if (!city) return { normalized: null, confidence: 0 };

  const cleaned = city.trim().toLowerCase();

  // Check against known Saudi cities
  for (const [key, value] of Object.entries(SAUDI_CITIES)) {
    if (cleaned.includes(key.toLowerCase())) {
      return { normalized: value, confidence: 0.9 };
    }
  }

  // If no match, return original cleaned version
  if (cleaned.length > 1 && cleaned.length < 50) {
    return { normalized: city.trim(), confidence: 0.3 };
  }

  return { normalized: null, confidence: 0 };
}

/**
 * Normalize country name to standard format.
 */
export function normalizeCountry(country: string): { normalized: string | null; isSaudi: boolean } {
  if (!country) return { normalized: null, isSaudi: false };

  const cleaned = country.trim().toLowerCase();
  const isSaudi = COUNTRY_VARIATIONS.some(v => cleaned.includes(v));

  return {
    normalized: isSaudi ? 'Saudi Arabia' : country.trim(),
    isSaudi
  };
}

/**
 * Clean whitespace and remove junk characters from a string.
 */
export function cleanText(text: string): string {
  if (!text) return '';

  return text
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
    .replace(/[™®©]/g, '') // Remove trademark symbols
    .trim();
}

/**
 * Remove junk values from a company record.
 */
export function removeJunkValues(company: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...company };

  for (const [key, value] of Object.entries(cleaned)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();

      // Remove empty or junk values
      if (trimmed === '' ||
          trimmed === 'null' ||
          trimmed === 'undefined' ||
          trimmed === 'N/A' ||
          trimmed === 'n/a' ||
          trimmed === '-' ||
          trimmed === '—' ||
          trimmed === 'TBD' ||
          trimmed === 'TBA') {
        cleaned[key] = undefined;
      } else {
        cleaned[key] = cleanText(value);
      }
    }
  }

  return cleaned;
}

/**
 * Normalize an entire company record.
 * Applies all normalizations at once.
 */
export function normalizeCompanyRecord(company: Record<string, unknown>): Record<string, unknown> {
  let normalized = removeJunkValues(company);

  // Normalize company name
  if (normalized.name_en) {
    normalized.name_en = normalizeCompanyName(normalized.name_en as string);
  }
  if (normalized.name_ar) {
    normalized.name_ar = normalizeCompanyName(normalized.name_ar as string);
  }

  // Normalize phone
  if (normalized.phone) {
    const phoneResult = normalizePhone(normalized.phone as string);
    normalized.phone = phoneResult.formatted || normalized.phone;
  }

  // Normalize email
  if (normalized.email) {
    const emailResult = normalizeEmail(normalized.email as string);
    normalized.email = emailResult.formatted || normalized.email;
  }

  // Normalize city
  if (normalized.city) {
    const cityResult = normalizeCity(normalized.city as string);
    normalized.city = cityResult.normalized || normalized.city;
  }

  // Normalize country
  if (normalized.country) {
    const countryResult = normalizeCountry(normalized.country as string);
    normalized.country = countryResult.normalized;
  }

  return normalized;
}
