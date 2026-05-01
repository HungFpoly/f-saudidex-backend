/**
 * Export Layer
 *
 * Responsible for outputting company data in various formats:
 * - JSON (full records)
 * - CSV (spreadsheet-friendly)
 * - Database rows (for bulk insert)
 * - API payloads (for external integrations)
 */

import { canonicalizeUrl } from './urlCanonicalizer';

export type ExportFormat = 'json' | 'csv' | 'api-payload';

export interface ExportOptions {
  format: ExportFormat;
  fields?: string[]; // Which fields to include (default: all)
  filter?: (company: Record<string, unknown>) => boolean; // Filter function
  sortField?: string; // Field to sort by
  sortOrder?: 'asc' | 'desc'; // Sort direction
  includeMetadata?: boolean; // Include internal metadata fields
}

const DEFAULT_FIELDS = [
  'id', 'name_en', 'name_ar', 'slug', 'business_type',
  'description_en', 'description_ar',
  'website_url', 'email', 'phone', 'city',
  'logo_url', 'linkedin_url',
  'categories', 'products',
  'is_verified', 'status', 'confidence_score',
  'created_at', 'updated_at'
];

const METADATA_FIELDS = [
  'source_url', 'data_source', 'extraction_metadata',
  'field_confidence', 'master_id', 'merged_from'
];

/**
 * Export companies to JSON format.
 */
export function exportToJson(
  companies: Record<string, unknown>[],
  options: { fields?: string[]; includeMetadata?: boolean } = {}
): string {
  const fields = options.fields || DEFAULT_FIELDS;
  if (options.includeMetadata) {
    fields.push(...METADATA_FIELDS.filter(f => !fields.includes(f)));
  }

  const cleaned = companies.map(company => {
    const record: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in company) {
        // Canonicalize URLs in export
        if (field.endsWith('_url') && typeof company[field] === 'string') {
          record[field] = canonicalizeUrl(company[field] as string) || company[field];
        } else {
          record[field] = company[field];
        }
      }
    }
    return record;
  });

  return JSON.stringify(cleaned, null, 2);
}

/**
 * Export companies to CSV format with UTF-8 BOM for Arabic support.
 */
export function exportToCsv(
  companies: Record<string, unknown>[],
  options: { fields?: string[]; includeMetadata?: boolean; bom?: boolean } = {}
): string {
  const fields = options.fields || DEFAULT_FIELDS;
  if (options.includeMetadata) {
    fields.push(...METADATA_FIELDS.filter(f => !fields.includes(f)));
  }

  const bom = options.bom !== false ? '\uFEFF' : ''; // UTF-8 BOM by default

  // Escape CSV field value
  const escapeCsvField = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    // If contains comma, quote, or newline, wrap in quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Header row
  const header = fields.map(f => escapeCsvField(f)).join(',');

  // Data rows
  const rows = companies.map(company => {
    return fields.map(field => {
      let value = company[field];

      // Canonicalize URLs
      if (field.endsWith('_url') && typeof value === 'string') {
        value = canonicalizeUrl(value) || value;
      }

      // Convert arrays to semicolon-separated strings
      if (Array.isArray(value)) {
        value = value.join('; ');
      }

      return escapeCsvField(value);
    }).join(',');
  });

  return bom + [header, ...rows].join('\n');
}

/**
 * Export companies to API payload format.
 * Structured for external API integrations.
 */
export function exportToApiPayload(
  companies: Record<string, unknown>[],
  options: { endpoint?: string; includeMetadata?: boolean } = {}
): string {
  const includeMetadata = options.includeMetadata || false;

  const payload = {
    metadata: {
      total: companies.length,
      exported_at: new Date().toISOString(),
      endpoint: options.endpoint || '/api/companies'
    },
    companies: companies.map(company => {
      const record: Record<string, unknown> = {
        id: company.id,
        name: {
          en: company.name_en || '',
          ar: company.name_ar || ''
        },
        type: company.business_type,
        description: {
          en: company.description_en || '',
          ar: company.description_ar || ''
        },
        contact: {
          website: company.website_url ? canonicalizeUrl(company.website_url as string) : null,
          email: company.email || null,
          phone: company.phone || null
        },
        location: {
          city: company.city || null,
          country: 'Saudi Arabia'
        },
        social: {
          linkedin: company.linkedin_url || null
        },
        categories: Array.isArray(company.categories) ? company.categories : [],
        products: Array.isArray(company.products) ? company.products : [],
        verified: company.is_verified || false,
        status: company.status || 'pending',
        confidence: company.confidence_score || 0
      };

      if (includeMetadata) {
        (record as Record<string, unknown>).metadata = {
          source_url: company.source_url,
          data_source: company.data_source,
          field_confidence: company.field_confidence,
          created_at: company.created_at,
          updated_at: company.updated_at
        };
      }

      return record;
    })
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Export companies in the specified format.
 */
export function exportCompanies(
  companies: Record<string, unknown>[],
  options: ExportOptions
): string {
  let filtered = companies;

  // Apply filter
  if (options.filter) {
    filtered = companies.filter(options.filter);
  }

  // Apply sort
  if (options.sortField) {
    filtered = [...filtered].sort((a, b) => {
      const aVal = a[options.sortField!];
      const bVal = b[options.sortField!];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return options.sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return options.sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });
  }

  // Export in requested format
  switch (options.format) {
    case 'json':
      return exportToJson(filtered, {
        fields: options.fields,
        includeMetadata: options.includeMetadata
      });

    case 'csv':
      return exportToCsv(filtered, {
        fields: options.fields,
        includeMetadata: options.includeMetadata
      });

    case 'api-payload':
      return exportToApiPayload(filtered, {
        includeMetadata: options.includeMetadata
      });

    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }
}

/**
 * Download export result as a file.
 */
export function downloadExport(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
