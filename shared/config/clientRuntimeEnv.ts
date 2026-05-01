type EnvMap = Record<string, string | undefined>;

export const CLIENT_RUNTIME_ENV_KEYS = [
  'APP_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'VITE_ADMIN_EMAILS',
  'VITE_AI_DISABLED',
  'VITE_API_BASE_URL',
  'VITE_API_URL',
  'VITE_BACKEND_URL',
  'VITE_GEMINI_API_KEY',
  'VITE_RENDER_BACKEND_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_AUTH_REDIRECT_TO',
  'VITE_SUPABASE_PUBLISHABLE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_URL',
  'VITE_SUPABASE_URL',
] as const;

const stripQuotes = (value: string) => value.replace(/^["']|["']$/g, '').trim();

const sanitizeEnvValue = (value: string | undefined) => {
  if (typeof value !== 'string') return '';
  return stripQuotes(value);
};

export const getClientRuntimeEnv = (env: EnvMap = process.env) => {
  const runtimeEnv: Record<string, string> = {};

  for (const key of CLIENT_RUNTIME_ENV_KEYS) {
    const value = sanitizeEnvValue(env[key]);
    if (value) {
      runtimeEnv[key] = value;
    }
  }

  return runtimeEnv;
};

const escapeForInlineScript = (value: string) => (
  value
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
);

export const buildClientRuntimeEnvScript = (env: EnvMap = process.env) => {
  const serializedEnv = escapeForInlineScript(JSON.stringify(getClientRuntimeEnv(env)));
  return `window.__APP_ENV__ = Object.freeze(${serializedEnv});`;
};
