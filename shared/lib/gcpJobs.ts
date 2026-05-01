import { JobsClient, ExecutionsClient } from "@google-cloud/run";
import { isAIEnabled } from "../config/runtime";
import { logToCloud } from "./monitoring";

/**
 * GCP Job Orchestrator
 * This utility allows triggering Cloud Run Jobs with runtime environment overrides.
 */

const project = process.env.GOOGLE_CLOUD_PROJECT || "saudidix";
const defaultLocation = process.env.GOOGLE_CLOUD_REGION || "me-central1"; 
const jobName = process.env.CLOUD_RUN_JOB_NAME || "saudidex-engine-job";

const AVAILABLE_REGIONS = ["me-central1", "us-central1", "europe-west1", "asia-east1"];
let lastRegionIndex = 0;

/**
 * Get next available region for rotation or failover.
 */
export function getNextRegion(currentRegion?: string): string {
  if (currentRegion) {
    const idx = AVAILABLE_REGIONS.indexOf(currentRegion);
    if (idx !== -1) {
      return AVAILABLE_REGIONS[(idx + 1) % AVAILABLE_REGIONS.length];
    }
  }
  const region = AVAILABLE_REGIONS[lastRegionIndex];
  lastRegionIndex = (lastRegionIndex + 1) % AVAILABLE_REGIONS.length;
  return region;
}

let clientInstance: JobsClient | null = null;

function getClient() {
  if (!clientInstance) {
    clientInstance = new JobsClient();
  }
  return clientInstance;
}

let executionsClientInstance: ExecutionsClient | null = null;

function getExecutionsClient() {
  if (!executionsClientInstance) {
    executionsClientInstance = new ExecutionsClient();
  }
  return executionsClientInstance;
}

export interface JobOptions {
  jobType: 'discovery' | 'single-scrape' | 'enrichment';
  targetUrl?: string;
  companyId?: string;
  provider?: string;
  maxPages?: number;
  region?: string; // Optional specific region override
  batchId?: string; // Added for tracking
  jobId?: string;   // Added for tracking
}

export async function triggerCloudRunJob(options: JobOptions) {
  // If no region provided, rotate through available ones
  const selectedRegion = options.region && AVAILABLE_REGIONS.includes(options.region) 
    ? options.region 
    : getNextRegion();

  const name = `projects/${project}/locations/${selectedRegion}/jobs/${jobName}`;

  logToCloud({
    level: 'INFO',
    category: 'INFRA',
    message: `Triggering Cloud Run Job in ${selectedRegion}`,
    details: { jobName, jobType: options.jobType, targetUrl: options.targetUrl },
    region: selectedRegion,
    jobId: options.jobId
  });

  // Map options to environment variables for the container
  const envOverrides = [
    { name: "JOB_TYPE", value: options.jobType },
    { name: "TARGET_URL", value: options.targetUrl || "" },
    { name: "COMPANY_ID", value: options.companyId || "" },
    { name: "AI_PROVIDER", value: options.provider || "gemini" },
    { name: "MAX_PAGES", value: String(options.maxPages || 20) },
    { name: "RUN_REGION", value: selectedRegion },
    { name: "JOB_ID", value: options.jobId || "" },
    { name: "BATCH_ID", value: options.batchId || "" },
    { name: "AI_DISABLED", value: isAIEnabled() ? "false" : "true" },
  ];

  try {
    const [operation] = await getClient().runJob({
      name,
      overrides: {
        containerOverrides: [
          {
            env: envOverrides,
          },
        ],
      },
    });

    console.log(`[GCP] Job execution started in ${selectedRegion}: ${operation.name}`);
    
    return {
      executionName: operation.name,
      region: selectedRegion,
      status: "triggered"
    };
  } catch (error: any) {
    logToCloud({
      level: 'ERROR',
      category: 'INFRA',
      message: `Failed to trigger job in ${selectedRegion}`,
      details: { error: error.message, stack: error.stack },
      region: selectedRegion
    });
    throw new Error(`Cloud Run Job error (${selectedRegion}): ${error.message}`);
  }
}

export async function getJobExecutionStatus(executionName: string) {
  try {
    const [execution] = await getExecutionsClient().getExecution({ name: executionName });
    
    const exec = execution as any;
    
    // Cloud Run Execution Status logic
    const completedCondition = exec.status?.conditions?.find((c: any) => c.type === 'Completed');
    let status: 'running' | 'succeeded' | 'failed' | 'unknown' = 'running';

    if (completedCondition) {
      if (completedCondition.status === 'True') {
        status = 'succeeded';
      } else if (completedCondition.status === 'False') {
        status = 'failed';
      }
    }

    return {
      status,
      executionName,
      logUri: exec.logUri,
      completionTime: exec.status?.completionTime,
      startTime: exec.status?.startTime,
      errorMessage: completedCondition?.message || null,
      retriedAt: exec.status?.retriedAt
    };
  } catch (error: any) {
    console.error(`[GCP] Failed to get execution status for ${executionName}:`, error);
    return { status: "unknown", executionName, error: error.message };
  }
}
