export const PROVIDER_HEALTH_STATUSES = [
  'ready',
  'unconfigured',
  'disabled',
  'unavailable',
  'unreachable',
  'error',
  'loading',
] as const;

export type ProviderHealthStatus = (typeof PROVIDER_HEALTH_STATUSES)[number];

export interface ProviderHealth {
  status: ProviderHealthStatus;
  message?: string;
  model?: string;
}

export type ProviderHealthMap = Record<string, ProviderHealth>;
