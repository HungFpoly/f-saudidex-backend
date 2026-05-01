import { GoogleGenAI, Type } from "@google/genai";
import { getGeminiApiKey, isAIEnabled } from "../../config/runtime";
import { logToCloud } from "../../lib/monitoring";

/**
 * Deep Research Agent
 * 
 * Performs multi-step research on a company using Gemini with Google Search grounding.
 * Capability: Fact-checking, Certification verification, and news extraction.
 */

export interface ResearchOptions {
  query: string;
  depth?: number;
  breadth?: number;
  provider?: string;
  focusArea?: 'certifications' | 'news' | 'general' | 'technical';
}

export interface ResearchResult {
  summary: string;
  learnings: string[];
  sources: { title: string; uri: string }[];
  verifiedClaims: { claim: string; status: 'verified' | 'unverified' | 'contradicted'; evidence: string }[];
  suggestedFields?: Partial<Record<string, { value: any; confidence: number; source: string }>>;
}

export async function performDeepResearch(options: ResearchOptions & { currentCompany?: any }): Promise<ResearchResult> {
  const { query, depth = 1, breadth = 3, focusArea = 'general', currentCompany } = options;
  
  if (!isAIEnabled()) {
    throw new Error("AI is disabled in configuration.");
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const genAI = new GoogleGenAI({ apiKey });
  const model = "gemini-2.0-flash";

  logToCloud({
    level: 'INFO',
    category: 'AI',
    message: `Starting deep research for: ${query}`,
    details: { options },
  });

  try {
    // 1. Initial Broad Search & Context Gathering
    const initialPrompt = `Perform a comprehensive research on the following topic/company: "${query}". 
    Focus on: ${focusArea}. 
    Provide a detailed summary and list at least ${breadth * depth} key findings.`;

    const response = await genAI.models.generateContent({
      model,
      contents: initialPrompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const text = response.text ?? '';
    
    // Extract grounding metadata
    const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;
    const sources = groundingMetadata?.groundingChunks?.map((chunk: any) => ({
      title: chunk.web?.title || 'Unknown Source',
      uri: chunk.web?.uri || ''
    })).filter((s: any) => s.uri) || [];

    // 2. Fact Verification (Optional Step if certifications are involved)
    let verifiedClaims: ResearchResult['verifiedClaims'] = [];
    if (focusArea === 'certifications' || text.toLowerCase().includes('iso') || text.toLowerCase().includes('certificate')) {
      const factPrompt = `Based on your research for "${query}", identify any specific certifications (ISO, SASO, etc.) mentioned. 
      For each, verify if there is strong evidence and return a JSON array of objects with: 
      { "claim": string, "status": "verified"|"unverified"|"contradicted", "evidence": string }.`;
      
      const factResult = await genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: factPrompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                claim: { type: Type.STRING },
                status: { type: Type.STRING, enum: ['verified', 'unverified', 'contradicted'] },
                evidence: { type: Type.STRING }
              },
              required: ['claim', 'status', 'evidence']
            }
          }
        }
      });
      
      try {
        verifiedClaims = JSON.parse(factResult.text ?? '[]');
      } catch (e) {
        console.error("Failed to parse verified claims JSON", e);
      }
    }

    // 3. Schema-Aware Field Extraction
    let suggestedFields: ResearchResult['suggestedFields'] = {};
    const missingFields = currentCompany ? 
      Object.keys(currentCompany).filter(k => !currentCompany[k] || currentCompany[k] === '') : 
      ['cr_number', 'vat_number', 'description_en', 'description_ar', 'website_url', 'phone', 'email', 'full_address'];

    if (missingFields.length > 0) {
      const fieldPrompt = `Based on the research above for "${query}", try to find high-confidence values for these specific missing fields: ${missingFields.join(', ')}.
      Return a JSON object mapping the field name to: { "value": any, "confidence": 0-1, "source": string }.
      Only include fields where you are highly confident (>0.7).`;

      const fieldResult = await genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: fieldPrompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: missingFields.reduce((acc, field) => {
              acc[field] = {
                type: Type.OBJECT,
                properties: {
                  value: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  source: { type: Type.STRING }
                }
              };
              return acc;
            }, {} as any)
          }
        }
      });

      try {
        suggestedFields = JSON.parse(fieldResult.text ?? '{}');
      } catch (e) {
        console.error("Failed to parse suggested fields JSON", e);
      }
    }

    // 4. Structured Output
    return {
      summary: text,
      learnings: text.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/^- /, '').trim()),
      sources: sources,
      verifiedClaims,
      suggestedFields
    };

  } catch (error: any) {
    logToCloud({
      level: 'ERROR',
      category: 'AI',
      message: `Research failed for ${query}`,
      details: { error: error.message },
    });
    throw error;
  }
}
