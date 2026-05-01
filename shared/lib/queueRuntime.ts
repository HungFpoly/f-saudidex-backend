import { CrawlJob, QueueType, queueManager } from './queueManager';
import { resolveWebsite, type WebsiteResolution } from './websiteResolver';
import { canFetch } from './robotsPolicy';
import { waitForSlot, releaseSlot, extractDomainFromUrl } from './rateLimiter';
import { recordQueueEvent } from './observability';

export const DEFAULT_QUEUE_TYPES: QueueType[] = [
  QueueType.CRAWL_DIRECTORY,
  QueueType.CRAWL_COMPANY,
];

export interface QueueProcessorOptions {
  timeoutMs?: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
  completeJob?: (jobId: string) => Promise<boolean>;
  failJob?: (jobId: string, message?: string) => Promise<boolean>;
  resolveWebsiteFn?: (url: string) => Promise<WebsiteResolution>;
}

const defaultOptions: Required<Pick<QueueProcessorOptions, 'timeoutMs' | 'userAgent'>> = {
  timeoutMs: 20000,
  userAgent: 'saudidex-bot (+https://saudidex.ae/bot)',
};

async function fetchUrlJob(job: CrawlJob, options: Required<QueueProcessorOptions>) {
  const isAllowed = await canFetch(job.url, options.userAgent);
  if (!isAllowed) {
    throw new Error(`Robots.txt restricted access to URL: ${job.url}`);
  }
  
  const domain = extractDomainFromUrl(job.url) || job.url;
  await waitForSlot(domain);

  try {
    const response = await options.fetchFn(job.url, {
      method: 'GET',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { 'User-Agent': options.userAgent },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
  } finally {
    releaseSlot(domain);
  }
}

async function resolveWebsiteJob(job: CrawlJob, options: Required<QueueProcessorOptions>) {
  const resolution = await options.resolveWebsiteFn(job.url);
  if (!resolution.isReachable || !resolution.isValid) {
    throw new Error(
      `Website resolve failed: reachable=${resolution.isReachable}, valid=${resolution.isValid}, status=${resolution.statusCode}`
    );
  }
}

async function storeEvidenceJob(job: CrawlJob) {
  const payload = job.payload ?? {};
  const companyId = payload.company_id || payload.companyId;
  const evidence = payload.evidence;
  const hasEvidence = Array.isArray(evidence) ? evidence.length > 0 : !!evidence;

  if (!companyId) {
    throw new Error('Evidence store failed: missing company_id in payload');
  }
  if (!hasEvidence) {
    throw new Error('Evidence store failed: missing evidence in payload');
  }
}

export async function processClaimedJob(
  job: CrawlJob,
  options: QueueProcessorOptions = {}
): Promise<{ ok: boolean; message?: string }> {
  const merged: Required<QueueProcessorOptions> = {
    ...defaultOptions,
    fetchFn: options.fetchFn ?? fetch,
    completeJob: options.completeJob ?? ((jobId: string) => queueManager.completeJob(jobId)),
    failJob: options.failJob ?? ((jobId: string, message?: string) => queueManager.failJob(jobId, message)),
    resolveWebsiteFn: options.resolveWebsiteFn ?? ((url: string) => resolveWebsite(url)),
    timeoutMs: options.timeoutMs ?? defaultOptions.timeoutMs,
    userAgent: options.userAgent ?? defaultOptions.userAgent,
  };

  try {
    switch (job.queue_name) {
      case QueueType.CRAWL_DIRECTORY:
      case QueueType.CRAWL_COMPANY:
        await fetchUrlJob(job, merged);
        break;
      case QueueType.WEBSITE_RESOLVE:
        await resolveWebsiteJob(job, merged);
        break;
      case QueueType.EVIDENCE_STORE:
        await storeEvidenceJob(job);
        break;
      default:
        throw new Error(`No processor configured for queue "${job.queue_name}"`);
    }

    await merged.completeJob(job.id);
    recordQueueEvent(job.queue_name, 'completed');
    return { ok: true };
  } catch (error: any) {
    const message = error?.message || 'Unknown worker error';
    await merged.failJob(job.id, message);
    recordQueueEvent(job.queue_name, 'failed');
    return { ok: false, message };
  }
}
