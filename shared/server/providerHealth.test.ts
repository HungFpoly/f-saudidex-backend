import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAIEnabledOverride } from '../config/runtime';
import { buildProvidersHealthApiResponse } from './providerHealth';

describe('provider health API response builder', () => {
  afterEach(() => {
    setAIEnabledOverride(null);
    vi.unstubAllEnvs();
  });

  it('returns aggregate provider health for all configured providers', () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-test-key');

    const response = buildProvidersHealthApiResponse();

    expect(response.statusCode).toBe(200);
    if (!('providers' in response.body)) {
      throw new Error('Expected aggregate provider response.');
    }

    expect(response.body.providers.groq).toMatchObject({
      status: 'ready',
      model: 'llama3-8b-8192',
    });
    expect(response.body.providers.webllm).toMatchObject({
      status: 'unavailable',
    });
  });

  it('returns single-provider health responses', () => {
    vi.stubEnv('MISTRAL_API_KEY', 'mistral-test-key');

    const response = buildProvidersHealthApiResponse('mistral');

    expect(response).toEqual({
      statusCode: 200,
      body: {
        status: 'ready',
        message: 'MISTRAL_API_KEY is configured.',
        model: 'mistral-small-latest',
      },
    });
  });

  it('reports disabled state when the AI master toggle is off', () => {
    setAIEnabledOverride(false);

    const response = buildProvidersHealthApiResponse('openrouter');

    expect(response).toEqual({
      statusCode: 200,
      body: {
        status: 'disabled',
        message: 'AI features are disabled via the admin master toggle.',
        model: 'google/gemini-pro-1.5',
      },
    });
  });

  it('reports unconfigured providers when API keys are missing', () => {
    const response = buildProvidersHealthApiResponse('huggingface');

    expect(response).toEqual({
      statusCode: 200,
      body: {
        status: 'unconfigured',
        message: 'HUGGINGFACE_API_KEY is missing.',
        model: 'meta-llama/Llama-3.3-70B-Instruct',
      },
    });
  });

  it('rejects unknown provider ids', () => {
    expect(buildProvidersHealthApiResponse('does-not-exist')).toEqual({
      statusCode: 400,
      body: {
        error: 'Unknown provider "does-not-exist".',
      },
    });
  });
});
