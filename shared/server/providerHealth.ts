import { AI_PROVIDERS, type AIProvider } from '../config/aiProviders';
import { isAIEnabled } from '../config/runtime';
import { ENV_KEY_MAP } from '../engine/core/utils';
import type { ProviderHealth, ProviderHealthMap } from '../lib/providerHealth';

type ProviderHealthApiResponse =
  | { statusCode: 200; body: ProviderHealth }
  | { statusCode: 200; body: { providers: ProviderHealthMap } }
  | { statusCode: 400; body: { error: string } };

const getEnvValue = (key: string) => {
  const raw = process.env[key] ?? process.env[`VITE_${key}`];
  return typeof raw === 'string' ? raw.trim() : '';
};

const getProviderModel = (providerId: AIProvider) => {
  const provider = AI_PROVIDERS.find((entry) => entry.id === providerId);
  return provider?.discoveryModel;
};

const getProviderHealth = (providerId: AIProvider): ProviderHealth => {
  const model = getProviderModel(providerId);

  if (!isAIEnabled()) {
    return {
      status: 'disabled',
      message: 'AI features are disabled via the admin master toggle.',
      model,
    };
  }

  if (providerId === 'webllm') {
    return {
      status: 'unavailable',
      message: 'WebLLM runs in the browser only and is not available from the backend.',
      model,
    };
  }

  const envKey = ENV_KEY_MAP[providerId];
  if (!envKey) {
    return {
      status: 'error',
      message: `No environment-key mapping is defined for provider "${providerId}".`,
      model,
    };
  }

  return getEnvValue(envKey)
    ? {
      status: 'ready',
      message: `${envKey} is configured.`,
      model,
    }
    : {
      status: 'unconfigured',
      message: `${envKey} is missing.`,
      model,
    };
};

const isKnownProvider = (providerId: string): providerId is AIProvider =>
  AI_PROVIDERS.some((provider) => provider.id === providerId);

export const buildProvidersHealthApiResponse = (providerId?: string): ProviderHealthApiResponse => {
  if (providerId) {
    if (!isKnownProvider(providerId)) {
      return {
        statusCode: 400,
        body: { error: `Unknown provider "${providerId}".` },
      };
    }

    return {
      statusCode: 200,
      body: getProviderHealth(providerId),
    };
  }

  const providers = AI_PROVIDERS.reduce<ProviderHealthMap>((acc, provider) => {
    acc[provider.id] = getProviderHealth(provider.id);
    return acc;
  }, {});

  return {
    statusCode: 200,
    body: { providers },
  };
};
