import { Router } from "express";
import { Type } from "@google/genai";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";
import { requireFeature } from "../auth/requireFeature";
import { aiEndpointsRateLimiter } from "../auth/rateLimiters";
import { recordAiCallUsage } from "../billing/usageService";
import { sanitizeConversationForPrompt } from "../security/promptSanitizer";
import type { createAiRouter } from "../ai/router";

// ---------------------------------------------------------------------------
// Fase 5 — Separação de server.ts por domínio (continuação): análise de
// sentimento.
//
// Pequeno ajuste ao extrair: este era o único dos 4 endpoints de IA que
// tentava só UM modelo (gemini-3.6-flash), sem o fallback para o segundo
// modelo que os outros três já tinham. Alinhado aqui para usar o mesmo
// generateWithFallbackModels dos demais — mesmo comportamento observável
// em caso de sucesso, só ganha mais uma tentativa antes de cair no
// fallback heurístico fixo.
//
// Atualização: agora usa o aiRouter (Gemini + Bedrock), em vez de falar
// só com o Gemini — Gemini continua como principal deste endpoint
// (classificação de humor não é decisão clínica), com Bedrock como
// reserva cruzada. Ver server/ai/router.ts.
// ---------------------------------------------------------------------------

export function createSentimentAnalysisRouter(aiRouter: ReturnType<typeof createAiRouter>): Router {
  const router = Router();

  // Fase 3 de Prontidão Comercial: requireFeature("analise_sentimento").
  router.post("/", requireAuth, requireTab("atendimentos"), requireFeature("analise_sentimento"), aiEndpointsRateLimiter, async (req, res) => {
    try {
      // Fase 4 de Prontidão Comercial: ver comentário equivalente na rota
      // de triagem clínica (server/routes/aiClinical.ts) — "melhor
      // esforço", nunca bloqueante.
      recordAiCallUsage(req.user!.clinicId, "analise_sentimento");

      const { messages, patientName } = req.body;
      // Fase 3: sanitiza cada mensagem antes de compor o bloco de texto
      // que vai para o prompt do Gemini.
      const conversationText = Array.isArray(messages) && messages.length > 0
        ? sanitizeConversationForPrompt(messages)
        : `Paciente: Olá, estou esperando há muito tempo o agendamento do exame!
IA: Sinto muito pela demora. Vou localizar um horário prioritário na agenda agora mesmo.
Paciente: Ótimo, preciso para esta semana sem falta.
IA: Encontrei uma vaga para quinta-feira às 09h. Posso confirmar para você?
Paciente: Perfeito! Agradeço bastante a agilidade!`;

      const prompt = `Analise a evolução de sentimento e humor do paciente (${patientName || "Paciente"}) ao longo das interações no log de atendimento da IA da clínica médica:

${conversationText}

Classifique o nível de satisfação/humor (0 = Frustrado/Irritado, 50 = Neutro, 100 = Muito Satisfeito/Encantado).
Identifique o humor inicial, o humor final, a tendência geral (Melhorando, Estável, Piorando) e forneça uma timeline passo a passo da evolução do sentimento.`;

      const schema = {
        type: Type.OBJECT,
        properties: {
          initialHumor: { type: Type.STRING },
          finalHumor: { type: Type.STRING },
          overallTrend: { type: Type.STRING },
          initialScore: { type: Type.NUMBER },
          finalScore: { type: Type.NUMBER },
          overallScore: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          timeline: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                step: { type: Type.STRING },
                speaker: { type: Type.STRING },
                sentimentScore: { type: Type.NUMBER },
                humorLabel: { type: Type.STRING },
                messageSnippet: { type: Type.STRING },
              },
              required: ["step", "sentimentScore", "humorLabel"],
            },
          },
        },
        required: ["initialHumor", "finalHumor", "overallTrend", "overallScore", "summary", "timeline"],
      };

      const parsedData = await aiRouter.generateForEndpoint("sentimentAnalysis", { prompt, schema, logLabel: "Sentiment" });

      if (parsedData) {
        return res.json({ success: true, analysis: parsedData, source: "gemini-nlp-model" });
      }

      return res.json({
        success: true,
        source: "gemini-fallback-engine",
        analysis: {
          initialHumor: "Impaciente",
          finalHumor: "Muito Satisfeito",
          overallTrend: "Melhorando",
          initialScore: 35,
          finalScore: 92,
          overallScore: 78,
          summary: "O paciente iniciou a interação com tom de urgência/impaciência, porém o atendimento ágil da IA resolveu o agendamento em menos de 3 minutos, convertendo a experiência para um nível elevado de satisfação.",
          timeline: [
            { step: "Início (09:00)", speaker: "Paciente", sentimentScore: 35, humorLabel: "Impaciente", messageSnippet: "Aguardando retorno sobre consulta..." },
            { step: "Acolhimento (09:01)", speaker: "IA MediFlux", sentimentScore: 55, humorLabel: "Atendido", messageSnippet: "Compreendo a urgência, localizando agenda..." },
            { step: "Proposta (09:02)", speaker: "Paciente", sentimentScore: 70, humorLabel: "Esperançoso", messageSnippet: "Preciso remarcar pois tive imprevisto..." },
            { step: "Confirmação (09:03)", speaker: "IA MediFlux", sentimentScore: 88, humorLabel: "Satisfeito", messageSnippet: "Vaga para amanhã às 14h reservada." },
            { step: "Conclusão (09:04)", speaker: "Paciente", sentimentScore: 95, humorLabel: "Encantado", messageSnippet: "Perfeito! Muito obrigado pela agilidade!" },
          ],
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao analisar tendência de sentimento." });
    }
  });

  return router;
}
