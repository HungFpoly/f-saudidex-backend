/**
 * AI Logger — Supabase implementation
 * Records AI model interactions into the `ai_logs` table.
 */
import { supabase, supabaseAdmin } from './supabase';

export interface AILogData {
  provider: string;
  model?: string;
  type: 'discovery' | 'enrichment' | 'health' | 'research'
      | 'classify_company' | 'normalize_taxonomy' | 'detect_brands'
      | 'rank_duplicates' | 'improve_profile' | 'suggest_fields'
      | 'score_completeness' | 'summarize_evidence';
  prompt?: string;
  response?: string;
  status: 'success' | 'error';
  error_message?: string;
  duration_ms?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  estimated_cost_usd?: number;
  fallback_reason?: string;
  is_fallback?: boolean;
  was_clamped?: boolean;
}

const MAX_LOG_FIELD_LENGTH = 12_000;

const truncateField = (value?: string): string | undefined => {
  if (!value) return value;
  return value.length <= MAX_LOG_FIELD_LENGTH
    ? value
    : `${value.slice(0, MAX_LOG_FIELD_LENGTH)}...[truncated]`;
};

export async function logAIInteraction(data: AILogData, userEmail?: string): Promise<void> {
  try {
    const client = supabaseAdmin ?? supabase;
    if (!client) return;

    // Resolve current user email if not explicitly passed
    let email = userEmail;
    if (!email && supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      email = session?.user?.email ?? 'unknown';
    }

    const record = {
      id: crypto.randomUUID(),
      provider: data.provider,
      model: data.model,
      type: data.type,
      status: data.status,
      duration_ms: data.duration_ms,
      error_message: truncateField(data.error_message),
      usage: {
        prompt_tokens: data.prompt_tokens,
        completion_tokens: data.completion_tokens,
        estimated_cost_usd: data.estimated_cost_usd,
      },
      request_payload: { 
        prompt: truncateField(data.prompt), 
        fallback_reason: data.fallback_reason,
        user_email: email ?? 'unknown'
      },
      response_payload: { 
        response: truncateField(data.response), 
        is_fallback: data.is_fallback,
        was_clamped: data.was_clamped
      },
      created_at: new Date().toISOString(),
    };

    const { error } = await client.from('ai_logs').insert(record);
    if (error) {
      console.error('[aiLogger] Failed to insert log:', error.message);
    }
  } catch (err) {
    console.error('[aiLogger] Unexpected error:', err);
  }
}
