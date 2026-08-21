import { GoogleGenAI } from "@google/genai";
import { AiProvider, GenerateStructuredParams } from "./types";

// ---------------------------------------------------------------------------
// Provider Gemini
//
// Mesma lógica que já existia em server/ai/geminiFallback.ts (tenta cada
// modelo candidato em sequência, usando o mecanismo nativo responseSchema
// do SDK do Gemini para forçar saída JSON), agora encapsulada atrás da
// interface AiProvider comum — para que o roteador (router.ts) possa tratar
// Gemini e Bedrock de forma intercambiável.
// ---------------------------------------------------------------------------

// Mesmos dois modelos usados desde a Fase 5. Se a equipe confirmar (com a
// API key real) que estes nomes precisam mudar, é UM lugar só para
// atualizar.
export const GEMINI_CANDIDATE_MODELS = ["gemini-3.6-flash", "gemini-3.1-flash-lite"] as const;

export function createGeminiProvider(ai: GoogleGenAI): AiProvider {
  return {
    name: "gemini",
    async generateStructured<T = any>({ prompt, schema, logLabel }: GenerateStructuredParams): Promise<T | null> {
      const attemptErrors: string[] = [];

      for (const modelName of GEMINI_CANDIDATE_MODELS) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: schema,
            },
          });

          if (response && response.text) {
            return JSON.parse(response.text) as T;
          }
          attemptErrors.push(`${modelName}: resposta vazia (sem response.text)`);
        } catch (err: any) {
          const errorDetail = err?.message || err?.status || err?.code || String(err);
          attemptErrors.push(`${modelName}: ${errorDetail}`);
          console.warn(`[Gemini ${logLabel} Warning] Modelo ${modelName} falhou (${errorDetail}). Tentando próximo modelo...`);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

      console.error(
        `[Gemini ${logLabel} ALERT] Todos os modelos falharam. Detalhes: ${attemptErrors.join(" | ")}`
      );
      return null;
    },
  };
}
