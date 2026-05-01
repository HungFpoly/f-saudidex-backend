import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/gcpJobs', () => ({
  triggerCloudRunJob: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { runBatchEnrich } from './batch';

describe('runBatchEnrich validation', () => {
  it('rejects malformed companyIds payloads with a 400 error', async () => {
    await expect(runBatchEnrich({ companyIds: null as any })).rejects.toMatchObject({
      statusCode: 400,
      message: 'companyIds must be provided as an array of strings.',
    });
  });

  it('rejects batches larger than 100 companies', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => String(i + 1));

    await expect(runBatchEnrich({ companyIds: ids })).rejects.toMatchObject({
      statusCode: 400,
      message: 'companyIds cannot exceed 100 entries.',
    });
  });
});
