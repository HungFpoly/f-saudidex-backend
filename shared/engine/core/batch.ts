import { triggerCloudRunJob } from "@/lib/gcpJobs";
import { supabase } from "@/lib/supabase";

const MAX_BATCH_SIZE = 100;

class BatchValidationError extends Error {
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'BatchValidationError';
  }
}

function normalizeBatchCompanyIds(companyIds: unknown): string[] {
  if (!Array.isArray(companyIds)) {
    throw new BatchValidationError('companyIds must be provided as an array of strings.');
  }

  const normalized = Array.from(
    new Set(
      companyIds
        .map((id) => (typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''))
        .filter((id) => id.length > 0)
    )
  );

  if (normalized.length === 0) {
    throw new BatchValidationError('companyIds must contain at least one valid company id.');
  }

  if (normalized.length > MAX_BATCH_SIZE) {
    throw new BatchValidationError(`companyIds cannot exceed ${MAX_BATCH_SIZE} entries.`);
  }

  return normalized;
}

export interface BatchEnrichOptions {
  companyIds: string[];
  provider?: string;
  batchId?: string;
  staggerMs?: number;
}

export interface BatchEnrichResult {
  batchId: string;
  jobsTriggered: number;
  totalRequested: number;
  errors: string[];
}

/**
 * Dispatches a list of company enrichment jobs to Cloud Run.
 * Uses the regional rotation logic in triggerCloudRunJob.
 */
export async function runBatchEnrich(options: BatchEnrichOptions): Promise<BatchEnrichResult> {
  const { 
    companyIds: rawCompanyIds,
    provider = 'gemini', 
    batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    staggerMs = 2000 // 2 second delay between triggers to avoid GCP API bursts
  } = options;
  const companyIds = normalizeBatchCompanyIds(rawCompanyIds);

  const results: BatchEnrichResult = {
    batchId,
    jobsTriggered: 0,
    totalRequested: companyIds.length,
    errors: []
  };

  console.log(`[Batch] Starting batch ${batchId} for ${companyIds.length} companies...`);

  if (!supabase) {
    throw new Error('Supabase client is not configured for batch enrichment.');
  }

  // Optimization: Fetch all company names in one go for the job status records
  const { data: companies, error: companyLoadError } = await supabase
    .from('companies')
    .select('id, name_en, website_url')
    .in('id', companyIds);

  if (companyLoadError) {
    throw new Error(`Failed to load company metadata for batch ${batchId}: ${companyLoadError.message}`);
  }
  
  const companyMap = new Map(companies?.map(c => [c.id, c]) || []);

  // We process these triggers one by one with a delay
  for (let index = 0; index < companyIds.length; index++) {
    const id = companyIds[index];
    let jobId: string | null = null;
    try {
      const company = companyMap.get(id) as any;
      
      // 1. Create a job status record first
      const { data: job, error: dbErr } = await supabase
        .from('job_status')
        .insert({
          category: 'mcci_enrichment',
          status: 'pending',
          batch_id: batchId,
          company_id: id,
          company_name: company?.name_en || 'Unknown',
        })
        .select()
        .single();

      if (dbErr) {
        throw new Error(`DB error for ${id}: ${dbErr.message}`);
      }

      jobId = job?.id ?? null;
      if (!jobId) {
        throw new Error(`Batch job record creation returned no row for ${id}.`);
      }

      // 2. Trigger the job
      console.log(`[Batch] Triggering enrichment for ${company?.name_en || id}...`);
      
      const jobResult = await triggerCloudRunJob({
        jobType: 'enrichment',
        companyId: id,
        targetUrl: company?.website_url,
        provider,
        batchId,
        jobId
      });

      // 3. Update the job status record with the execution name (worker_id)
      const { error: updateErr } = await supabase
        .from('job_status')
        .update({ 
          status: 'running',
          started_at: new Date().toISOString(),
          worker_id: jobResult.executionName,
          run_region: jobResult.region 
        })
        .eq('id', jobId);

      if (updateErr) {
        console.warn(`[Batch] Triggered job ${jobId} but failed to update job_status: ${updateErr.message}`);
        results.errors.push(`${id}: job started but status update failed: ${updateErr.message}`);
      }

      results.jobsTriggered++;
    } catch (error: any) {
      console.error(`[Batch] Error triggering job for ${id}:`, error);
      const message = error?.message || String(error);
      results.errors.push(`${id}: ${message}`);

      if (jobId) {
        await supabase
          .from('job_status')
          .update({
            status: 'failed',
            error: message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      }
    }

    // Stagger
    if (index < companyIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, staggerMs));
    }
  }

  return results;
}
