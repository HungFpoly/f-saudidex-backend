/**
 * Database-backed Queue Manager for Crawl Jobs
 *
 * This module replaces the in-memory CrawlQueue with a persistent
 * database-backed queue system using Supabase. It supports:
 * - Job persistence across server restarts
 * - Dead letter queue for permanently failed jobs
 * - Retry logic with exponential backoff
 * - Idempotency keys to prevent duplicate processing
 * - Multiple queue types for different crawling tasks
 */

import { supabaseAdmin } from './supabase';

export enum QueueType {
  SEED_DISCOVER = 'queue.seed.discover',
  DIRECTORY_PARSE = 'queue.directory.parse',
  WEBSITE_RESOLVE = 'queue.website.resolve',
  COMPANY_HOMEPAGE_FETCH = 'queue.company.fetch.homepage',
  COMPANY_PRIORITY_PAGE_FETCH = 'queue.company.fetch.priority_page',
  FIELD_EXTRACT = 'queue.field.extract',
  AI_ENRICH = 'queue.ai.enrich',
  ENTITY_MERGE = 'queue.entity.merge',
  ENTITY_RESOLVE = 'queue.entity.resolve',
  ENTITY_INDEX = 'queue.entity.index',
  REVIEW = 'queue.review',
  CRAWL_DIRECTORY = 'queue.directory.crawl',
  CRAWL_COMPANY = 'queue.company.crawl',
  EVIDENCE_STORE = 'queue.evidence.store'
}

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DEAD_LETTER = 'dead_letter'
}

export interface CrawlJob {
  id: string;
  queue_name: QueueType;
  status: JobStatus;
  priority: number; // Higher number = higher priority
  url: string;
  payload?: Record<string, any>;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  scheduled_at: string;
  completed_at?: string;
  error_message?: string;
  idempotency_key?: string;
  worker_id?: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead_letter: number;
}

export class QueueManager {
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly BASE_RETRY_DELAY_MS = 1000; // 1 second base delay

  /**
   * Add a job to the queue
   */
  async enqueue(
    queueName: QueueType,
    url: string,
    priority: number = 1,
    payload?: Record<string, any>,
    idempotencyKey?: string,
    maxAttempts: number = QueueManager.MAX_ATTEMPTS
  ): Promise<string> {
    const jobId = crypto.randomUUID();
    
    // Check for idempotency - if a job with this key already exists and hasn't completed, return its ID
    if (idempotencyKey) {
      const { data: existingJobs, error } = await supabaseAdmin
        .from('crawl_jobs')
        .select('id, status')
        .eq('idempotency_key', idempotencyKey)
        .limit(1);
      
      if (error) {
        console.error('QueueManager.enqueue - Error checking idempotency:', error);
      } else if (existingJobs && existingJobs.length > 0) {
        const existingJob = existingJobs[0];
        // If the job is not completed, return its ID to prevent duplication
        if (existingJob.status !== JobStatus.COMPLETED) {
          return existingJob.id;
        }
      }
    }

    const job: Omit<CrawlJob, 'id' | 'created_at' | 'updated_at' | 'completed_at'> = {
      queue_name: queueName,
      status: JobStatus.PENDING,
      priority,
      url,
      payload,
      attempts: 0,
      max_attempts: maxAttempts,
      scheduled_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
    };

    const { error } = await supabaseAdmin
      .from('crawl_jobs')
      .insert([{ ...job, id: jobId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);

    if (error) {
      throw new Error(`Failed to enqueue job: ${error.message}`);
    }

    return jobId;
  }

  /**
   * Claim a job for processing using atomic RPC
   */
  async claimJob(queueNames: QueueType[], workerId: string): Promise<CrawlJob | null> {
    const { data, error } = await supabaseAdmin.rpc('claim_queued_job', {
      p_queue_names: queueNames,
      p_worker_id: workerId
    });

    if (error) {
      console.error('QueueManager.claimJob - Error claiming job via RPC:', error);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const job = data[0];
    return job as CrawlJob;
  }

  /**
   * Mark a job as completed successfully
   */
  async completeJob(jobId: string): Promise<boolean> {
    const { error } = await supabaseAdmin
      .from('crawl_jobs')
      .update({
        status: JobStatus.COMPLETED,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    if (error) {
      console.error('QueueManager.completeJob - Error completing job:', error);
      return false;
    }

    return true;
  }

  /**
   * Mark a job as failed and schedule a retry or move to dead letter queue
   */
  async failJob(jobId: string, errorMessage?: string): Promise<boolean> {
    // Get the current job to check attempts count
    const { data: job, error: fetchError } = await supabaseAdmin
      .from('crawl_jobs')
      .select('*')
      .eq('id', jobId)
      .limit(1)
      .single();

    if (fetchError || !job) {
      console.error('QueueManager.failJob - Error fetching job:', fetchError);
      return false;
    }

    const updatedAttempts = job.attempts + 1;
    let newStatus = JobStatus.FAILED;
    let scheduledAt = new Date();

    // Check if max attempts reached
    if (updatedAttempts >= job.max_attempts) {
      // Move to dead letter queue
      newStatus = JobStatus.DEAD_LETTER;
    } else {
      // Schedule retry with exponential backoff
      const delayMs = QueueManager.BASE_RETRY_DELAY_MS * Math.pow(2, updatedAttempts - 1);
      scheduledAt = new Date(Date.now() + delayMs);
      newStatus = JobStatus.PENDING;
    }

    const { error: updateError } = await supabaseAdmin
      .from('crawl_jobs')
      .update({
        status: newStatus,
        attempts: updatedAttempts,
        error_message: errorMessage,
        scheduled_at: scheduledAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    if (updateError) {
      console.error('QueueManager.failJob - Error failing job:', updateError);
      return false;
    }

    return true;
  }

  /**
   * Get statistics for a specific queue
   */
  async getQueueStats(queueName: QueueType): Promise<QueueStats> {
    const { count: pendingCount } = await supabaseAdmin
      .from('crawl_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('queue_name', queueName)
      .eq('status', JobStatus.PENDING);

    const { count: processingCount } = await supabaseAdmin
      .from('crawl_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('queue_name', queueName)
      .eq('status', JobStatus.PROCESSING);

    const { count: completedCount } = await supabaseAdmin
      .from('crawl_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('queue_name', queueName)
      .eq('status', JobStatus.COMPLETED);

    const { count: failedCount } = await supabaseAdmin
      .from('crawl_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('queue_name', queueName)
      .eq('status', JobStatus.FAILED);

    const { count: deadLetterCount } = await supabaseAdmin
      .from('crawl_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('queue_name', queueName)
      .eq('status', JobStatus.DEAD_LETTER);

    return {
      pending: pendingCount || 0,
      processing: processingCount || 0,
      completed: completedCount || 0,
      failed: failedCount || 0,
      dead_letter: deadLetterCount || 0
    };
  }

  /**
   * Get all jobs in a specific status for a queue
   */
  async getJobsByStatus(queueName: QueueType, status: JobStatus, limit: number = 50): Promise<CrawlJob[]> {
    const { data, error } = await supabaseAdmin
      .from('crawl_jobs')
      .select('*')
      .eq('queue_name', queueName)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`QueueManager.getJobsByStatus - Error getting jobs with status ${status}:`, error);
      return [];
    }

    return data || [];
  }

  /**
   * Retry all failed jobs in a queue
   */
  async retryFailedJobs(queueName: QueueType): Promise<number> {
    const failedJobs = await this.getJobsByStatus(queueName, JobStatus.FAILED, 1000);

    for (const job of failedJobs) {
      const { error } = await supabaseAdmin
        .from('crawl_jobs')
        .update({
          status: JobStatus.PENDING,
          attempts: 0,
          error_message: null,
          scheduled_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      if (error) {
        console.error('QueueManager.retryFailedJobs - Error resetting job:', error);
      }
    }

    return failedJobs.length;
  }
}

// Export a singleton instance
export const queueManager = new QueueManager();
