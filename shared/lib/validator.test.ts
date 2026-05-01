import { afterEach, describe, expect, it, vi } from 'vitest';

import { validator } from './validator';

describe('validator confidence sanitization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps valid confidence scores unchanged', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(validator.sanitizeConfidence(0)).toBe(0);
    expect(validator.sanitizeConfidence(0.75)).toBe(0.75);
    expect(validator.sanitizeConfidence(1)).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('clamps out-of-range, NaN, and non-numeric confidence scores to 0.0', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(validator.sanitizeConfidence(-0.1, 'confidence_score')).toBe(0);
    expect(validator.sanitizeConfidence(1.1, 'confidence_score')).toBe(0);
    expect(validator.sanitizeConfidence(Number.NaN, 'confidence_score')).toBe(0);
    expect(validator.sanitizeConfidence('0.9', 'confidence_score')).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(4);
  });

  it('sanitizes mixed field confidence maps while preserving keys', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      validator.sanitizeConfidenceMap({
        email: 0.9,
        phone: -1,
        website_url: Number.NaN,
        logo_url: 'high',
      })
    ).toEqual({
      email: 0.9,
      phone: 0,
      website_url: 0,
      logo_url: 0,
    });

    expect(validator.sanitizeConfidenceMap(null)).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('sanitizes enrichment payloads without stripping field evidence/confidence', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const sanitized = validator.sanitizeCompanyConfidencePayload({
      name_en: 'Example Co',
      confidence_score: 9,
      field_confidence: {
        email: 0.8,
        phone: 'bad',
      },
      field_evidence: {
        email: 'hello@example.com',
      },
      extraction_metadata: {
        field_confidence: {
          description_en: -0.2,
          website_url: 0.7,
        },
      },
    });

    expect(sanitized).toEqual({
      sanitized: {
        name_en: 'Example Co',
        confidence_score: 0,
        field_confidence: {
          email: 0.8,
          phone: 0,
        },
        field_evidence: {
          email: 'hello@example.com',
        },
        extraction_metadata: {
          field_confidence: {
            description_en: 0,
            website_url: 0.7,
          },
        },
      },
      clamped: true,
    });
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('sanitizes persistence payloads and strips non-column company keys', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const sanitized = validator.sanitizeCompanyPersistencePayload({
      name_en: 'Persisted Co',
      city: 'Riyadh',
      address: 'Somewhere',
      confidence_score: 'bad',
      field_confidence: {
        email: 0.9,
      },
      field_evidence: {
        email: 'snippet',
      },
      extraction_metadata: {
        field_confidence: {
          website_url: 2,
        },
      },
    });

    expect(sanitized).toEqual({
      name_en: 'Persisted Co',
      confidence_score: 0,
      extraction_metadata: {
        field_confidence: {
          website_url: 0,
        },
      },
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
