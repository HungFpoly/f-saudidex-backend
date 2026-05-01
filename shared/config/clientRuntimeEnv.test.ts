import { describe, expect, it } from 'vitest';
import { buildClientRuntimeEnvScript, getClientRuntimeEnv } from './clientRuntimeEnv';

describe('client runtime env', () => {
  it('includes only whitelisted public keys', () => {
    const runtimeEnv = getClientRuntimeEnv({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'secret-should-not-leak',
      SUPABASE_SERVICE_ROLE_KEY: 'also-secret',
    });

    expect(runtimeEnv).toEqual({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    });
  });

  it('builds a safe script payload for env.js', () => {
    const script = buildClientRuntimeEnvScript({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: '</script>',
    });

    expect(script).toContain('window.__APP_ENV__ = Object.freeze(');
    expect(script).toContain('\\u003c/script>');
    expect(script).not.toContain('</script>');
  });
});
