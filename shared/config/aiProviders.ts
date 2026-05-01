import { isGeminiConfigured, isAIEnabled } from './runtime';

export type AIProvider = 'gemini' | 'webllm' | 'groq' | 'openrouter' | 'mistral' | 'huggingface' | 'deepseek' | 'openai';

export interface ProviderConfig {
  id: AIProvider;
  name: string;
  mode: 'client' | 'backend';
  enabled: boolean;
  strengths: string[];
  recommendedWorkloads: string[];
  models: string[];
  discoveryModel: string;
  enrichmentModel: string;
  researchModel: string;
}

export const AI_PROVIDERS: ProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    mode: 'backend',
    enabled: isGeminiConfigured(),
    strengths: ['Multimodal', 'Large context window', 'Native URL context', 'High speed'],
    recommendedWorkloads: ['Discovery', 'Enrichment', 'Complex reasoning'],
    models: ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    discoveryModel: 'gemini-3-flash-preview',
    enrichmentModel: 'gemini-3-flash-preview',
    researchModel: 'gemini-3-flash-preview'
  },
  {
    id: 'webllm',
    name: 'WebLLM (Browser)',
    mode: 'client',
    enabled: isAIEnabled(), // Runs locally via WebGPU — but respect global disable
    strengths: ['Zero latency', 'Offline capable', 'No API cost', 'Privacy-first'],
    recommendedWorkloads: ['Research queries', 'Text classification', 'Simple extraction'],
    models: ['Llama-3.1-8B-Instruct-q4f32_1-MLC'],
    discoveryModel: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
    enrichmentModel: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
    researchModel: 'Llama-3.1-8B-Instruct-q4f32_1-MLC'
  },
  {
    id: 'groq',
    name: 'Groq (Llama 3)',
    mode: 'backend',
    enabled: isAIEnabled(), // Managed by backend but respect global disable
    strengths: ['Extreme low latency', 'High throughput'],
    recommendedWorkloads: ['Fast classification', 'Simple extraction'],
    models: ['llama-3.3-70b-versatile'],
    discoveryModel: 'llama-3.3-70b-versatile',
    enrichmentModel: 'llama-3.3-70b-versatile',
    researchModel: 'llama-3.3-70b-versatile'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    mode: 'backend',
    enabled: isAIEnabled(),
    strengths: ['Access to any model', 'Unified API'],
    recommendedWorkloads: ['Fallback', 'Specialized models'],
    models: ['google/gemini-2.5-flash', 'mistralai/mistral-7b-instruct:free'],
    discoveryModel: 'google/gemini-2.5-flash',
    enrichmentModel: 'google/gemini-2.5-flash',
    researchModel: 'google/gemini-2.5-flash'
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    mode: 'backend',
    enabled: isAIEnabled(),
    strengths: ['Open weights', 'Strong reasoning'],
    recommendedWorkloads: ['Enrichment', 'Translation'],
    models: ['mistral-large-latest'],
    discoveryModel: 'mistral-large-latest',
    enrichmentModel: 'mistral-large-latest',
    researchModel: 'mistral-large-latest'
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    mode: 'backend',
    enabled: isAIEnabled(),
    strengths: ['Open source models', 'High flexibility'],
    recommendedWorkloads: ['Specialized tasks', 'Research'],
    models: ['Qwen/Qwen2.5-72B-Instruct'],
    discoveryModel: 'Qwen/Qwen2.5-72B-Instruct',
    enrichmentModel: 'Qwen/Qwen2.5-72B-Instruct',
    researchModel: 'Qwen/Qwen2.5-72B-Instruct'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    mode: 'backend',
    enabled: isAIEnabled(),
    strengths: ['Coding', 'Reasoning', 'Efficiency'],
    recommendedWorkloads: ['Research', 'Enrichment'],
    models: ['deepseek-chat'],
    discoveryModel: 'deepseek-chat',
    enrichmentModel: 'deepseek-chat',
    researchModel: 'deepseek-chat'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    mode: 'backend',
    enabled: isAIEnabled(),
    strengths: ['State of the art reasoning', 'Reliability'],
    recommendedWorkloads: ['Enrichment', 'Discovery'],
    models: ['gpt-5', 'gpt-4o', 'gpt-4-turbo'],
    discoveryModel: 'gpt-5',
    enrichmentModel: 'gpt-5',
    researchModel: 'gpt-5'
  }
];

export const getProvider = (id: AIProvider) => AI_PROVIDERS.find(p => p.id === id);

export const isProviderEnabled = (id: AIProvider) => {
  const p = getProvider(id);
  return p ? p.enabled : false;
};

export type WorkloadType = 'discovery' | 'enrichment' | 'research';

export const FALLBACK_CHAINS: Record<WorkloadType, AIProvider[]> = {
  discovery: ['openai', 'gemini', 'webllm', 'openrouter', 'groq'],
  enrichment: ['openai', 'gemini', 'webllm', 'mistral', 'deepseek', 'openrouter'],
  research: ['gemini', 'webllm', 'deepseek', 'openrouter']
};
