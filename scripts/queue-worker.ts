import dotenv from 'dotenv';
dotenv.config();

import { queueManager, QueueType } from '../shared/lib/queueManager';
import { DEFAULT_QUEUE_TYPES, processClaimedJob } from '../shared/lib/queueRuntime';

const workerId = `queue-worker-${process.pid}`;
const pollIntervalMs = Number(process.env.QUEUE_WORKER_POLL_MS || 3000);
const timeoutMs = Number(process.env.QUEUE_WORKER_FETCH_TIMEOUT_MS || 20000);
const queueNames = (process.env.QUEUE_NAMES || DEFAULT_QUEUE_TYPES.join(','))
  .split(',')
  .map(q => q.trim())
  .filter(Boolean)
  .filter((q): q is QueueType => (Object.values(QueueType) as string[]).includes(q));

async function tick() {
  if (queueNames.length === 0) {
    console.warn('[QueueWorker] No valid queues configured. Set QUEUE_NAMES.');
    return;
  }

  const job = await queueManager.claimJob(queueNames, workerId);
  if (!job) return;
  const result = await processClaimedJob(job, { timeoutMs });
  if (result.ok) {
    console.log(`[QueueWorker] ✅ Completed ${job.id} (${job.queue_name}) ${job.url}`);
  } else {
    console.warn(`[QueueWorker] ⚠️ Failed ${job.id} (${job.queue_name}): ${result.message}`);
  }
}

async function main() {
  const hasSupabaseUrl = !!process.env.VITE_SUPABASE_URL;
  const hasSupabaseKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  if (!hasSupabaseUrl || !hasSupabaseKey) {
    console.warn('[QueueWorker] Supabase is not configured. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return;
  }

  console.log(`[QueueWorker] Started as ${workerId}`);
  console.log(`[QueueWorker] Queues: ${queueNames.join(', ')}`);
  console.log(`[QueueWorker] Poll interval: ${pollIntervalMs}ms`);

  while (true) {
    await tick();
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

main().catch((error) => {
  console.error('[QueueWorker] Fatal:', error);
  process.exit(1);
});
