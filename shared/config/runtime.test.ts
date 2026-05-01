import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('runtime config', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_BACKEND_URL', '');
    vi.stubEnv('VITE_RENDER_BACKEND_URL', '');
  });

  it('prefers the configured API base URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://saudidex.vercel.app');
    const { getApiBaseUrl } = await import('./runtime');

    expect(getApiBaseUrl()).toBe('https://saudidex.vercel.app/api');
  });

  it('appends /api when configured URL is origin-only', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://saudidex.vercel.app');
    const { getApiBaseUrl } = await import('./runtime');

    expect(getApiBaseUrl()).toBe('https://saudidex.vercel.app/api');
  });

  it('falls back to the browser origin', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubGlobal('window', { location: { origin: 'https://saudidex.vercel.app' } });
    const { getApiBaseUrl } = await import('./runtime');

    expect(getApiBaseUrl()).toBe('https://saudidex.vercel.app/api');
  });

  it('prefers runtime env over build-time env', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://stale.saudidex.vercel.app');
    vi.stubGlobal('window', {
      location: { origin: 'https://saudidex.vercel.app' },
      __APP_ENV__: { VITE_API_BASE_URL: 'https://runtime.saudidex.run.app' },
    });
    const { getApiBaseUrl } = await import('./runtime');

    expect(getApiBaseUrl()).toBe('https://runtime.saudidex.run.app/api');
  });

  it('falls back to the Render backend URL when API base URL is not set', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_RENDER_BACKEND_URL', 'https://saudidex.onrender.com');
    const { getApiBaseUrl } = await import('./runtime');

    expect(getApiBaseUrl()).toBe('https://saudidex.onrender.com/api');
  });

  it('derives the backend origin from an API base URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://saudidex.onrender.com/api');
    const { getConfiguredBackendUrl } = await import('./runtime');

    expect(getConfiguredBackendUrl()).toBe('https://saudidex.onrender.com');
  });

  it('detects whether Gemini is configured', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
    const { getGeminiApiKey, isGeminiConfigured } = await import('./runtime');

    expect(getGeminiApiKey()).toBe('test-key');
    expect(isGeminiConfigured()).toBe(true);
  });

  it('treats same-origin production API as local backend mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://saudidex.vercel.app',
        hostname: 'saudidex.vercel.app',
      },
    });
    const { getBackendMode } = await import('./runtime');

    expect(getBackendMode()).toBe('local');
  });

  it('treats cross-origin configured API as remote backend mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.saudidex.vercel.app');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://saudidex.vercel.app',
        hostname: 'saudidex.vercel.app',
      },
    });
    const { getBackendMode } = await import('./runtime');

    expect(getBackendMode()).toBe('remote');
  });

  it('reads the Supabase auth redirect from runtime env', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://saudidex.vercel.app' },
      __APP_ENV__: { VITE_SUPABASE_AUTH_REDIRECT_TO: 'https://saudidex-janv4g6cza-ew.a.run.app/' },
    });
    const { getSupabaseAuthRedirectTo } = await import('./runtime');

    expect(getSupabaseAuthRedirectTo()).toBe('https://saudidex-janv4g6cza-ew.a.run.app');
  });
});
