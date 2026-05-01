import { isAIEnabled } from "../config/runtime";

/**
 * Advanced Monitoring & Error Reporting
 * Centralizes logging for scraper performance and regional health.
 */

export interface LogEntry {
  level: 'INFO' | 'WARNING' | 'ERROR';
  category: 'DISCOVERY' | 'ENRICHMENT' | 'INFRA' | 'AI';
  message: string;
  details?: any;
  region?: string;
  jobId?: string;
}

export function logToCloud(entry: LogEntry) {
  const timestamp = new Date().toISOString();
  const logPayload = {
    timestamp,
    ...entry,
    ai_enabled: isAIEnabled(),
    env: process.env.NODE_ENV || 'development'
  };

  // Structured logging for GCP Cloud Logging
  console.log(JSON.stringify(logPayload));

  // In a full production setup, this would also push to a metrics DB 
  // or trigger PagerDuty if level === 'ERROR'
}

export function trackRegionalPerformance(region: string, success: boolean, durationMs: number) {
  logToCloud({
    level: success ? 'INFO' : 'WARNING',
    category: 'INFRA',
    message: `Regional performance: ${region}`,
    details: { success, durationMs },
    region
  });
}
