import { describe, expect, it, vi } from 'vitest';
import { JobStatus, QueueType, type CrawlJob } from './queueManager';
import { processClaimedJob } from './queueRuntime';

const baseJob: CrawlJob = {
  id: 'job-1',
  queue_name: QueueType.CRAWL_DIRECTORY,
  status: JobStatus.PROCESSING,
  priority: 1,
  url: 'https://example.com',
  attempts: 0,
  max_attempts: 3,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  scheduled_at: new Date().toISOString(),
};

describe('queueRuntime.processClaimedJob', () => {
  it('completes crawl jobs on successful fetch', async () => {
    const completeJob = vi.fn().mockResolvedValue(true);
    const failJob = vi.fn().mockResolvedValue(true);
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

    const result = await processClaimedJob(baseJob, {
      fetchFn: fetchFn as any,
      completeJob,
      failJob,
    });

    expect(result.ok).toBe(true);
    expect(completeJob).toHaveBeenCalledWith(baseJob.id);
    expect(failJob).not.toHaveBeenCalled();
  });

  it('fails unsupported queue types', async () => {
    const completeJob = vi.fn().mockResolvedValue(true);
    const failJob = vi.fn().mockResolvedValue(true);

    const result = await processClaimedJob(
      { ...baseJob, queue_name: QueueType.AI_ENRICH },
      {
        fetchFn: vi.fn() as any,
        completeJob,
        failJob,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('No processor configured');
    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).toHaveBeenCalledWith(baseJob.id, expect.stringContaining('No processor configured'));
  });

  it('fails crawl jobs when fetch returns non-OK response', async () => {
    const completeJob = vi.fn().mockResolvedValue(true);
    const failJob = vi.fn().mockResolvedValue(true);
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const result = await processClaimedJob(baseJob, {
      fetchFn: fetchFn as any,
      completeJob,
      failJob,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('HTTP 500');
    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).toHaveBeenCalledWith(baseJob.id, expect.stringContaining('HTTP 500'));
  });

  it('completes WEBSITE_RESOLVE jobs when resolver marks URL valid/reachable', async () => {
    const completeJob = vi.fn().mockResolvedValue(true);
    const failJob = vi.fn().mockResolvedValue(true);
    const resolveWebsiteFn = vi.fn().mockResolvedValue({
      isReachable: true,
      isValid: true,
      statusCode: 200,
    });

    const result = await processClaimedJob(
      { ...baseJob, queue_name: QueueType.WEBSITE_RESOLVE },
      {
        fetchFn: vi.fn() as any,
        resolveWebsiteFn: resolveWebsiteFn as any,
        completeJob,
        failJob,
      }
    );

    expect(result.ok).toBe(true);
    expect(resolveWebsiteFn).toHaveBeenCalledWith(baseJob.url);
    expect(completeJob).toHaveBeenCalledWith(baseJob.id);
    expect(failJob).not.toHaveBeenCalled();
  });

  it('fails WEBSITE_RESOLVE jobs when resolver marks URL invalid/unreachable', async () => {
    const completeJob = vi.fn().mockResolvedValue(true);
    const failJob = vi.fn().mockResolvedValue(true);
    const resolveWebsiteFn = vi.fn().mockResolvedValue({
      isReachable: false,
      isValid: false,
      statusCode: 500,
    });

    const result = await processClaimedJob(
      { ...baseJob, queue_name: QueueType.WEBSITE_RESOLVE },
      {
        fetchFn: vi.fn() as any,
        resolveWebsiteFn: resolveWebsiteFn as any,
        completeJob,
        failJob,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Website resolve failed');
    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).toHaveBeenCalledWith(baseJob.id, expect.stringContaining('Website resolve failed'));
  });

  it('completes EVIDENCE_STORE jobs when payload has company_id and evidence', async () => {
    const completeJob = vi.fn().mockResolvedValue(true);
    const failJob = vi.fn().mockResolvedValue(true);

    const result = await processClaimedJob(
      {
        ...baseJob,
        queue_name: QueueType.EVIDENCE_STORE,
        payload: { company_id: '123', evidence: [{ field: 'email', value: 'x@y.com' }] },
      },
      {
        fetchFn: vi.fn() as any,
        completeJob,
        failJob,
      }
    );

    expect(result.ok).toBe(true);
    expect(completeJob).toHaveBeenCalledWith(baseJob.id);
    expect(failJob).not.toHaveBeenCalled();
  });

  it('fails EVIDENCE_STORE jobs when payload is missing required fields', async () => {
    const completeJob = vi.fn().mockResolvedValue(true);
    const failJob = vi.fn().mockResolvedValue(true);

    const result = await processClaimedJob(
      {
        ...baseJob,
        queue_name: QueueType.EVIDENCE_STORE,
        payload: { company_id: '123' },
      },
      {
        fetchFn: vi.fn() as any,
        completeJob,
        failJob,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('missing evidence');
    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).toHaveBeenCalledWith(baseJob.id, expect.stringContaining('missing evidence'));
  });
});
