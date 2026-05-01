import { describe, expect, it, vi } from 'vitest';

import {
  createCompanySlug,
  mapCategoryIds,
  normalizeDiscoveredCompany,
  normalizeEnrichmentUpdate,
  validateCompanyRecord,
} from './companyNormalization';

describe('company normalization', () => {
  it('maps category labels to known IDs', () => {
    expect(mapCategoryIds(['Electrical', '4', 'Unknown Category'])).toEqual([
      '2',
      '4',
      'Unknown Category',
    ]);
  });

  it('creates stable slugs', () => {
    expect(createCompanySlug('Controls & Electrics Arabia Ltd.')).toBe(
      'controls-electrics-arabia-ltd',
    );
  });

  it('normalizes discovered companies with required defaults', () => {
    const normalized = normalizeDiscoveredCompany(
      {
        name_en: 'Example Co',
        categories: ['Electrical'],
      },
      'https://saudidex.ae',
    );

    expect(normalized.slug).toBe('example-co');
    expect(normalized.categories).toEqual(['2']);
    expect(normalized.status).toBe('pending');
    expect(normalized.full_address).toBe('Saudi Arabia');
    expect(normalized.city_id).toBe('1');
    expect(normalized).not.toHaveProperty('city');
  });

  it('maps legacy AI city into full_address but does not persist city on the row', () => {
    const normalized = normalizeDiscoveredCompany(
      {
        name_en: 'Legacy Co',
        city: 'Riyadh',
      },
      'https://example.com',
    );

    expect(normalized.full_address).toBe('Riyadh');
    expect(normalized).not.toHaveProperty('city');
  });

  it('treats manual out-of-range confidence scores as validation errors', () => {
    const result = validateCompanyRecord({
      name_en: 'Manual Confidence Co',
      slug: 'manual-confidence-co',
      business_type: 'vendor',
      confidence_score: 5,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('confidence_score out of range: 5');
  });

  it('clamps invalid discovery confidence and sanitizes extraction metadata field confidence', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const normalized = normalizeDiscoveredCompany(
      {
        name_en: 'Confidence Co',
        confidence_score: 1.4,
        field_confidence: {
          email: 0.8,
          phone: -0.2,
          website_url: 'high',
        },
      },
      'https://example.com',
    );

    expect(normalized.confidence_score).toBe(0);
    expect(normalized.extraction_metadata?.field_confidence).toEqual({
      email: 0.8,
      phone: 0,
      website_url: 0,
    });
    warnSpy.mockRestore();
  });

  it('keeps only safe enrichment fields and normalizes arrays', () => {
    const normalized = normalizeEnrichmentUpdate({
      categories: ['Electrical'],
      products: ['Panels', 123],
      services: ['Maintenance', 456],
      locations: [' Riyadh ', 789],
      team_members: [{ name: ' A ', role: ' CEO ' }, { name: '', role: 'CTO' }, 'bad'],
      logo_url: 'https://saudidex.vercel.app/logo.png',
      youtube_url: 'https://youtube.com/example',
      unsupported: 'ignore-me',
    });

    expect(normalized).toEqual({
      categories: ['2'],
      products: ['Panels'],
      services: ['Maintenance'],
      locations: ['Riyadh'],
      team_members: [{ name: 'A', role: 'CEO' }],
      logo_url: 'https://saudidex.vercel.app/logo.png',
      youtube_url: 'https://youtube.com/example',
    });
  });

  it('clamps invalid enrichment confidence to 0.0', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      normalizeEnrichmentUpdate({
        confidence_score: Number.NaN,
        categories: ['Electrical'],
      }),
    ).toEqual({
        confidence_score: 0,
        categories: ['2'],
      });
    warnSpy.mockRestore();
  });

  it('coerces is_vat_registered from Gemini string', () => {
    expect(
      normalizeEnrichmentUpdate({
        is_vat_registered: 'true',
        cr_number: '1010123456',
      }),
    ).toEqual({ is_vat_registered: true, cr_number: '1010123456' });
  });

  it('normalizes industry fields from enrichment', () => {
    expect(
      normalizeEnrichmentUpdate({
        fields: ['  Steel  ', 'Electrical', 99],
      }),
    ).toEqual({ fields: ['Steel', 'Electrical'] });
  });
});
