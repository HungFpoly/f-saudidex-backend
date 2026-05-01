import { Groq } from "groq-sdk";
import { Mistral } from "@mistralai/mistralai";
import { HfInference } from "@huggingface/inference";

/**
 * Lazy singletons for backend AI providers to prevent connection pool exhaustion.
 */
class BackendAIInstances {
  private groq: Groq | null = null;
  private mistral: Mistral | null = null;
  private hf: HfInference | null = null;

  getGroq(apiKey: string): Groq {
    if (!this.groq) {
      console.log("[AI] Initializing Groq singleton...");
      this.groq = new Groq({ apiKey });
    }
    return this.groq;
  }

  getMistral(apiKey: string): Mistral {
    if (!this.mistral) {
      console.log("[AI] Initializing Mistral singleton...");
      this.mistral = new Mistral({ apiKey });
    }
    return this.mistral;
  }

  getHf(apiKey: string): HfInference {
    if (!this.hf) {
      console.log("[AI] Initializing Hugging Face singleton...");
      this.hf = new HfInference(apiKey);
    }
    return this.hf;
  }
}

export const aiInstances = new BackendAIInstances();
