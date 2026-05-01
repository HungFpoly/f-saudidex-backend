import { createClient } from '@supabase/supabase-js';
import { getConfigValue } from '../config/runtime';

const getSupabaseEnvValue = (...keys: string[]): string => {
  return getConfigValue(...keys);
};

const supabaseUrl = getSupabaseEnvValue(
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
);
const supabaseAnonKey = getSupabaseEnvValue(
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
);
const isBrowser = typeof window !== 'undefined';
const supabaseServiceKey = isBrowser
  ? ''
  : getSupabaseEnvValue('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Missing Supabase URL/anon key env vars (VITE_SUPABASE_* / SUPABASE_* / NEXT_PUBLIC_SUPABASE_*) — Supabase will be unavailable.');
}

/**
 * Public (browser-safe) client — respects Row Level Security.
 * Use for all client-side reads and auth flows.
 */
export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  : null;

/**
 * Server-side admin client — bypasses RLS.
 * Only use in server.ts / API routes — never import in browser bundles.
 */
export const supabaseAdmin = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })
  : null;

export const isSupabaseConfigured = (): boolean => supabase !== null;

/** Helper — throws if supabase is not configured */
export function requireSupabase() {
  if (!supabase) throw new Error('[Supabase] Client not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  return supabase;
}

/** Helper — throws if supabaseAdmin is not configured */
export function requireSupabaseAdmin() {
  if (!supabaseAdmin) throw new Error('[Supabase] Admin client not configured. Check SUPABASE_SERVICE_ROLE_KEY.');
  return supabaseAdmin;
}
