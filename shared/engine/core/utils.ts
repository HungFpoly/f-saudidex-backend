/**
 * Saudidex Engine Utilities
 * Shared helpers for JSON parsing, AI state, and string cleaning.
 */

/**
 * Robust JSON Parsing Helper
 * Extracts the first valid JSON object or array found in text.
 */
export function safeJsonParse<T = any>(str: string, fallback: T): T {
  if (!str) return fallback;
  
  try {
    return JSON.parse(str);
  } catch (e) {
    const jsonMatch = str.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        let cleaned = jsonMatch[0];
        return JSON.parse(cleaned);
      } catch (innerError) {
        console.warn("[JSON Parse] Failed to parse matched JSON block:", innerError);
      }
    }
    console.warn("[JSON Parse] Could not find valid JSON in response:", str.slice(0, 100));
    return fallback;
  }
}

/**
 * AI Disabled helper function
 */
export function isAIDisabled(): boolean {
  // Check process.env directly for server-side environments without using runtime.ts
  // to avoid circular dependencies if we move this file later.
  const aiDisabled = process.env.AI_DISABLED || process.env.VITE_AI_DISABLED;
  return aiDisabled === 'true';
}

/**
 * Map each backend provider to its required environment variable name.
 */
export const ENV_KEY_MAP: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  openai: 'OPENAI_API_KEY',
};
