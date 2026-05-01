type EnvValue = string | boolean | undefined;
type EnvMap = Record<string, EnvValue>;
const BACKEND_URL_CONFIG_KEYS = [
  'VITE_API_BASE_URL',
  'VITE_API_URL',
  'VITE_BACKEND_URL',
  'VITE_RENDER_BACKEND_URL',
] as const;

const stripQuotes = (value: string) => value.replace(/^["']|["']$/g, '').trim();

const getViteEnv = (): EnvMap => {
  const meta = import.meta as ImportMeta & { env?: EnvMap };
  return meta.env ?? {};
};

const getRuntimeEnv = (): EnvMap => {
  if (typeof window === 'undefined') {
    return {};
  }

  return window.__APP_ENV__ ?? {};
};

const getProcessEnv = (): EnvMap => (
  typeof process !== 'undefined' ? process.env ?? {} : {}
);

const normalizeEnvValue = (value: EnvValue): string => {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'string') {
    return stripQuotes(value);
  }

  return '';
};

export const getConfigValue = (...keys: string[]): string => {
  const runtimeEnv = getRuntimeEnv();
  const viteEnv = getViteEnv();
  const processEnv = getProcessEnv();

  for (const key of keys) {
    const value = normalizeEnvValue(runtimeEnv[key] ?? viteEnv[key] ?? processEnv[key]);
    if (value) {
      return value;
    }
  }

  return '';
};

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');
const getConfiguredApiBaseUrl = () => getConfigValue(...BACKEND_URL_CONFIG_KEYS);

const ensureApiPath = (value: string) => {
  const trimmed = trimTrailingSlashes(value);

  // Relative values (e.g. "/api", "/backend-api") should be preserved as-is.
  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  // Absolute URL values should default to "/api" when only an origin is provided.
  try {
    const parsed = new URL(trimmed);
    const pathname = trimTrailingSlashes(parsed.pathname);
    if (!pathname || pathname === '') {
      parsed.pathname = '/api';
      return trimTrailingSlashes(parsed.toString());
    }
    return trimTrailingSlashes(parsed.toString());
  } catch {
    // Non-URL strings are returned unchanged to avoid surprising rewrites.
    return trimmed;
  }
};

export const getBrowserOrigin = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.origin;
};

export const getConfiguredBackendUrl = () => {
  const configuredBaseUrl = getConfiguredApiBaseUrl();
  if (!configuredBaseUrl) {
    return '';
  }

  try {
    const parsed = new URL(configuredBaseUrl, getBrowserOrigin() || undefined);
    const pathname = trimTrailingSlashes(parsed.pathname);

    // When the configured value points at the API root, derive the backend origin.
    if (!pathname || pathname === '/api') {
      parsed.pathname = '/';
    } else {
      parsed.pathname = pathname;
    }

    return trimTrailingSlashes(parsed.toString());
  } catch {
    return '';
  }
};

export const getApiBaseUrl = () => {
  const configuredBaseUrl = getConfiguredApiBaseUrl();
  // Prefer explicit runtime configuration when provided.
  if (configuredBaseUrl) {
    return ensureApiPath(configuredBaseUrl);
  }

  const origin = getBrowserOrigin();
  return origin ? `${origin}/api` : '/api';
};

export const getGeminiApiKey = () => {
  return getConfigValue('VITE_GEMINI_API_KEY', 'GEMINI_API_KEY');
};

export const isGeminiConfigured = () => getGeminiApiKey().length > 0;

/** Check if a custom backend API URL is configured */
export const isBackendConfigured = () => {
  return !!getConfiguredApiBaseUrl();
};

export const getAdminEmails = () => getConfigValue('VITE_ADMIN_EMAILS');

export const isDevEnvironment = () => Boolean(getViteEnv().DEV);

export const getSupabaseAuthRedirectTo = () => {
  const configuredRedirectTo = getConfigValue('VITE_SUPABASE_AUTH_REDIRECT_TO', 'APP_URL');
  return configuredRedirectTo ? trimTrailingSlashes(configuredRedirectTo) : '';
};

/** Get the backend provider mode: 'local' | 'remote' | 'none' */
export const getBackendMode = (): 'local' | 'remote' | 'none' => {
  if (typeof window === 'undefined') return 'none';
  const { hostname, origin } = window.location;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  const configuredBaseUrl = getConfiguredApiBaseUrl();

  if (isLocalhost) return 'local';
  if (!configuredBaseUrl) return origin ? 'local' : 'none';

  try {
    const resolvedUrl = new URL(ensureApiPath(configuredBaseUrl), origin);
    return resolvedUrl.origin === origin ? 'local' : 'remote';
  } catch {
    return 'remote';
  }
};

/**
 * Check if AI providers are enabled.
 * When set to 'true', all AI enrichment/classification endpoints return
 * { status: "ai_disabled" } and the discovery pipeline skips AI extraction.
 *
 * Set via: VITE_AI_DISABLED=true (client) or AI_DISABLED=true (server)
 */
let _aiEnabledOverride: boolean | null = null;

export const setAIEnabledOverride = (enabled: boolean | null) => {
  _aiEnabledOverride = enabled;
};

export const isAIEnabled = (): boolean => {
  // 1. Check dynamic override (used by server.ts and AdminDashboard)
  if (_aiEnabledOverride !== null) {
    return _aiEnabledOverride;
  }

  // 2. Fall back to environment configuration
  if (getConfigValue('VITE_AI_DISABLED', 'AI_DISABLED') === 'true') {
    return false;
  }
  
  return true; // Default: AI enabled
};
