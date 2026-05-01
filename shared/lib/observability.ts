/**
 * Observability & Metrics Module
 *
 * Responsible for:
 * - Tracking crawl success/failure rates per adapter
 * - Queue size and processing metrics
 * - AI provider performance metrics
 * - Per-source scrape quality metrics
 * - Error rate tracking
 *
 * This module provides a lightweight, in-memory metrics collector
 * that can later be replaced with Redis/Prometheus for production scale.
 */

export interface MetricPoint {
  metric: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

// In-memory storage
const metricsStore: MetricPoint[] = [];
const MAX_METRICS = 10000;  // Keep last N metrics
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, number[]>();

// ─── Counter API ──────────────────────────────────────────────────

/**
 * Increment a counter metric.
 */
export function incrementCounter(name: string, tags?: Record<string, string>, delta: number = 1): void {
  const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
  counters.set(key, (counters.get(key) || 0) + delta);

  metricsStore.push({
    metric: name,
    value: delta,
    timestamp: Date.now(),
    tags,
  });

  trimMetrics();
}

/**
 * Get current counter value.
 */
export function getCounter(name: string, tags?: Record<string, string>): number {
  const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
  return counters.get(key) || 0;
}

/**
 * Reset a counter.
 */
export function resetCounter(name: string, tags?: Record<string, string>): void {
  const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
  counters.delete(key);
}

// ─── Gauge API ────────────────────────────────────────────────────

/**
 * Set a gauge metric (instantaneous value).
 */
export function setGauge(name: string, value: number, tags?: Record<string, string>): void {
  const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
  gauges.set(key, value);

  metricsStore.push({
    metric: name,
    value,
    timestamp: Date.now(),
    tags,
  });

  trimMetrics();
}

/**
 * Get current gauge value.
 */
export function getGauge(name: string, tags?: Record<string, string>): number {
  const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
  return gauges.get(key) || 0;
}

// ─── Histogram API ────────────────────────────────────────────────

/**
 * Record a value in a histogram (for latency, sizes, etc.).
 */
export function recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
  const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
  if (!histograms.has(key)) {
    histograms.set(key, []);
  }
  histograms.get(key)!.push(value);

  // Keep only last 1000 values per histogram
  if (histograms.get(key)!.length > 1000) {
    histograms.set(key, histograms.get(key)!.slice(-1000));
  }

  metricsStore.push({
    metric: name,
    value,
    timestamp: Date.now(),
    tags,
  });

  trimMetrics();
}

/**
 * Get histogram statistics (p50, p90, p99, mean, min, max).
 */
export function getHistogramStats(name: string, tags?: Record<string, string>): {
  count: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p99: number;
} | null {
  const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
  const values = histograms.get(key);
  if (!values || values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    count: n,
    mean: sorted.reduce((sum, v) => sum + v, 0) / n,
    min: sorted[0],
    max: sorted[n - 1],
    p50: sorted[Math.floor(n * 0.5)],
    p90: sorted[Math.floor(n * 0.9)],
    p99: sorted[Math.floor(n * 0.99)],
  };
}

// ─── Pre-defined Metric Helpers ───────────────────────────────────

/**
 * Record an adapter parsing event.
 */
export function recordAdapterParse(
  adapterId: string,
  url: string,
  companiesFound: number,
  parseTimeMs: number,
  success: boolean
): void {
  incrementCounter('adapter.parse_total', { adapter_id: adapterId });

  if (success) {
    incrementCounter('adapter.parse_success', { adapter_id: adapterId });
  } else {
    incrementCounter('adapter.parse_failure', { adapter_id: adapterId });
  }

  if (companiesFound > 0) {
    incrementCounter('adapter.companies_found', { adapter_id: adapterId }, companiesFound);
  }

  recordHistogram('adapter.parse_time_ms', parseTimeMs, { adapter_id: adapterId });
}

/**
 * Simplified helper for tracking adapter success/failure and latency.
 */
export function trackAdapterUsage(adapterId: string, success: boolean, durationMs: number): void {
  recordAdapterParse(adapterId, 'unknown', success ? 1 : 0, durationMs, success);
}

/**
 * Record a fetch event (HTTP or browser).
 */
export function recordFetch(
  url: string,
  fetchMethod: 'http' | 'browser',
  responseCode: number | null,
  fetchTimeMs: number,
  success: boolean,
  blockedByRobots: boolean = false
): void {
  incrementCounter('fetch.total', { method: fetchMethod });

  if (blockedByRobots) {
    incrementCounter('fetch.blocked_by_robots');
  }

  if (success) {
    incrementCounter('fetch.success', { method: fetchMethod });
  } else {
    incrementCounter('fetch.failure', { method: fetchMethod });
  }

  if (responseCode) {
    incrementCounter('fetch.response_code', { code: String(responseCode) });
  }

  recordHistogram('fetch.time_ms', fetchTimeMs, { method: fetchMethod });
}

/**
 * Record a queue event.
 */
export function recordQueueEvent(
  queueName: string,
  action: 'enqueued' | 'dequeued' | 'completed' | 'failed' | 'retried' | 'dead_lettered'
): void {
  incrementCounter('queue.total', { queue: queueName, action });

  // Update queue size gauges
  setGauge('queue.size', getGauge('queue.size', { queue: queueName }) + (action === 'enqueued' ? 1 : action === 'dequeued' ? -1 : 0), { queue: queueName });
}

/**
 * Record a field extraction event.
 */
export function recordFieldExtract(
  fieldName: string,
  method: 'regex' | 'dom_selector' | 'json_ld' | 'meta_tag' | 'adapter_parse',
  confidence: number,
  success: boolean
): void {
  if (success) {
    incrementCounter('extract.success', { field: fieldName, method });
  } else {
    incrementCounter('extract.failed', { field: fieldName, method });
  }

  recordHistogram('extract.confidence', confidence * 100, { field: fieldName });
}

/**
 * Record an AI enrichment event.
 */
export function recordAIEnrichment(
  provider: string,
  jobType: string,
  durationMs: number,
  success: boolean,
  tokensUsed?: number
): void {
  incrementCounter('ai.total', { provider, job_type: jobType });

  if (success) {
    incrementCounter('ai.success', { provider, job_type: jobType });
  } else {
    incrementCounter('ai.failure', { provider, job_type: jobType });
  }

  recordHistogram('ai.duration_ms', durationMs, { provider, job_type: jobType });

  if (tokensUsed) {
    recordHistogram('ai.tokens', tokensUsed, { provider });
    incrementCounter('ai.tokens_total', { provider }, tokensUsed);
  }
}

/**
 * Get total tokens used by a provider.
 */
export function getAITokenUsage(provider: string): number {
  return getCounter('ai.tokens_total', { provider });
}

/**
 * Record a validation event.
 */
export function recordValidation(
  score: number,
  passed: boolean,
  flagCount: number
): void {
  incrementCounter('validation.total');

  if (passed) {
    incrementCounter('validation.passed');
  } else {
    incrementCounter('validation.failed');
  }

  recordHistogram('validation.score', score * 100);
  recordHistogram('validation.flags', flagCount);
}

// ─── Aggregate Stats ──────────────────────────────────────────────

/**
 * Get adapter success rate statistics.
 */
export function getAdapterStats(): Record<string, {
  totalParses: number;
  successParses: number;
  failureParses: number;
  successRate: number;
  avgCompaniesPerParse: number;
  avgParseTimeMs: number | null;
}> {
  const stats: Record<string, { total: number; success: number; failure: number; companies: number }> = {};

  for (const [key, value] of counters.entries()) {
    if (key.startsWith('adapter.parse_total')) {
      const adapterId = key.split(':').pop() || 'unknown';
      if (!stats[adapterId]) stats[adapterId] = { total: 0, success: 0, failure: 0, companies: 0 };
      stats[adapterId].total = value;
    }
    if (key.startsWith('adapter.parse_success')) {
      const adapterId = key.split(':').pop() || 'unknown';
      if (!stats[adapterId]) stats[adapterId] = { total: 0, success: 0, failure: 0, companies: 0 };
      stats[adapterId].success = value;
    }
    if (key.startsWith('adapter.parse_failure')) {
      const adapterId = key.split(':').pop() || 'unknown';
      if (!stats[adapterId]) stats[adapterId] = { total: 0, success: 0, failure: 0, companies: 0 };
      stats[adapterId].failure = value;
    }
    if (key.startsWith('adapter.companies_found')) {
      const adapterId = key.split(':').pop() || 'unknown';
      if (!stats[adapterId]) stats[adapterId] = { total: 0, success: 0, failure: 0, companies: 0 };
      stats[adapterId].companies = value;
    }
  }

  const result: Record<string, {
    totalParses: number;
    successParses: number;
    failureParses: number;
    successRate: number;
    avgCompaniesPerParse: number;
    avgParseTimeMs: number | null;
  }> = {};

  for (const [adapterId, data] of Object.entries(stats)) {
    const timeStats = getHistogramStats('adapter.parse_time_ms', { adapter_id: adapterId });
    result[adapterId] = {
      totalParses: data.total,
      successParses: data.success,
      failureParses: data.failure,
      successRate: data.total > 0 ? data.success / data.total : 0,
      avgCompaniesPerParse: data.total > 0 ? data.companies / data.total : 0,
      avgParseTimeMs: timeStats ? Math.round(timeStats.mean) : null,
    };
  }

  return result;
}

/**
 * Get overall system metrics summary.
 */
export function getSystemMetrics(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  adapterStats: ReturnType<typeof getAdapterStats>;
  memoryUsage: NodeJS.MemoryUsage | null;
  uptime: number;
} {
  return {
    counters: Object.fromEntries(counters.entries()),
    gauges: Object.fromEntries(gauges.entries()),
    adapterStats: getAdapterStats(),
    memoryUsage: typeof process !== 'undefined' ? process.memoryUsage() : null,
    uptime: typeof process !== 'undefined' ? process.uptime() : 0,
  };
}

/**
 * Get recent metrics (last N points).
 */
export function getRecentMetrics(limit: number = 100): MetricPoint[] {
  return metricsStore.slice(-limit);
}

// ─── Internal helpers ─────────────────────────────────────────────

function trimMetrics(): void {
  if (metricsStore.length > MAX_METRICS) {
    metricsStore.splice(0, metricsStore.length - MAX_METRICS);
  }
}

/**
 * Reset all metrics (useful for testing).
 */
export function resetAllMetrics(): void {
  metricsStore.length = 0;
  counters.clear();
  gauges.clear();
  histograms.clear();
}

// Export a single metrics collector instance (singleton pattern)
export const metricsCollector = {
  incrementCounter,
  getCounter,
  resetCounter,
  setGauge,
  getGauge,
  recordHistogram,
  getHistogramStats,
  recordAdapterParse,
  recordFetch,
  recordQueueEvent,
  recordFieldExtract,
  recordAIEnrichment,
  recordValidation,
  getAdapterStats,
  getSystemMetrics,
  getRecentMetrics,
  resetAllMetrics,
};
