import { Router } from "express";
import { Type } from "@google/genai";
import { requireAuth } from "../auth/requireAuth";
import { requireTab, requireAnyTab } from "../auth/requireTab";
import { requireFeature } from "../auth/requireFeature";
import { aiEndpointsRateLimiter } from "../auth/rateLimiters";
import { recordAiCallUsage } from "../billing/usageService";
import { sanitizeForPrompt } from "../security/promptSanitizer";
import { applyHumanReviewGate, buildFailSafeFallback } from "../clinical/triageGuardrails";
import type { createAiRouter } from "../ai/router";

// ---------------------------------------------------------------------------
// Fase 5 — Separação de server.ts por domínio (item pendente concluído)
//
// Os três endpoints de IA que ficaram deliberadamente no server.ts durante
// a Fase 5 — triagem clínica (analyze-message), categorização automática de
// conversas (auto-tag) e qualificação de lead (qualify-lead) — agora vivem
// aqui, em seu próprio router.
//
// Continuam juntos ENTRE SI (não foram espalhados em três arquivos
// separados), pelo mesmo motivo de sempre: compartilham diretamente os
// guardrails clínicos (server/clinical/triageGuardrails.ts) e o roteador de
// providers de IA (server/ai/router.ts) — mantê-los próximos facilita
// revisar a lógica de segurança clínica de uma só vez. O que mudou é que
// deixaram de estar misturados com o bootstrap do servidor em server.ts.
// ---------------------------------------------------------------------------

export function createAiClinicalRouter(aiRouter: ReturnType<typeof createAiRouter>): Router {
  const router = Router();

  // Helper interno: monta o schema e delega ao roteador de IA (Gemini +
  // Bedrock, com fallback cruzado — ver server/ai/router.ts).
  async function analyzeMessageStructured(prompt: string) {
    const schema = {
      type: Type.OBJECT,
      properties: {
        urgency: { type: Type.STRING, description: "alta, media, ou baixa" },
        urgencyLabel: { type: Type.STRING, description: "Rótulo de urgência" },
        confidenceScore: { type: Type.NUMBER, description: "Pontuação de confiança 0-100" },
        category: { type: Type.STRING, description: "Categoria do atendimento" },
        urgencyReason: { type: Type.STRING, description: "Justificativa da urgência" },
        suggestedProtocol: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Passos do protocolo de triagem",
        },
        recommendedAction: { type: Type.STRING, description: "Ação recomendada para a recepção" },
        suggestedReply: { type: Type.STRING, description: "Sugestão de resposta direta ao paciente" },
      },
      required: [
        "urgency",
        "urgencyLabel",
        "confidenceScore",
        "category",
        "urgencyReason",
        "suggestedProtocol",
        "recommendedAction",
        "suggestedReply",
      ],
    };

    return aiRouter.generateForEndpoint("triagem", { prompt, schema, logLabel: "Triagem" });
  }

  // Endpoint: Analyze message urgency and initial triage protocol
  // Fase 3 de Prontidão Comercial: requireFeature("triagem_clinica") —
  // este é o add-on mais sensível (usa Bedrock, decisão clínica), e o
  // primeiro a ser gateado por ser o mais caro e o de maior risco caso
  // vazasse para clínicas que não contrataram.
  router.post("/analyze-message", requireAuth, requireAnyTab(["atendimentos", "automacoes"]), requireFeature("triagem_clinica"), aiEndpointsRateLimiter, async (req, res) => {
    try {
      const { messageText, patientName, patientInsurance, history } = req.body;

      if (!messageText || typeof messageText !== "string") {
        return res.status(400).json({ error: "O texto da mensagem é obrigatório." });
      }

      // Fase 4 de Prontidão Comercial: registra a chamada do add-on ANTES
      // de acionar a IA — o que conta para uso/faturamento é a tentativa
      // de uso do recurso contratado, não se o provedor de IA respondeu
      // com sucesso (mesmo o fallback heurístico é uma tentativa válida
      // de uso do add-on). "Melhor esforço": nunca bloqueia a resposta.
      recordAiCallUsage(req.user!.clinicId, "triagem_clinica");

      // Fase 3: o texto original (não sanitizado) é preservado para o
      // fallback heurístico abaixo, que só faz .includes() em palavras-chave
      // e não é afetado por prompt injection. Só a versão sanitizada vai
      // para o prompt da IA.
      const safeMessageText = sanitizeForPrompt(messageText);
      const safePatientName = patientName ? sanitizeForPrompt(String(patientName)) : "";
      const safeHistory = history ? sanitizeForPrompt(String(history)) : "";

      const prompt = `Você é um médico auditor especialista em triagem clínica hospitalar e atendimento digital em saúde (com base nas diretrizes do Protocolo de Manchester adaptado para teleatendimento e CRM médico).
Analise a mensagem a seguir enviada por um paciente e determine o grau de urgência, categoria do caso e sugira o protocolo de triagem inicial.

Dados do Paciente:
- Nome: ${safePatientName || "Não informado"}
- Convênio/Plano: ${patientInsurance || "Particular"}
- Mensagem recebida: "${safeMessageText}"
${safeHistory ? `- Histórico recente: ${safeHistory}` : ""}

Responda rigorosamente no formato JSON com os seguintes campos:
1. "urgency": "alta" (para sintomas graves, dor intensa, sangramento, pós-operatório com complicação, febre alta, falta de ar, emergência), "media" (sintoma moderado, dúvida médica com incômodo, agendamento prioritário) ou "baixa" (agendamento rotineiro, dúvidas administrativas, confirmações, comprovante).
2. "urgencyLabel": Rótulo curto em português (ex: "Emergência / Alta Urgência", "Atenção Moderada", "Atendimento de Rotina").
3. "confidenceScore": número inteiro entre 75 e 99.
4. "category": Categoria principal (ex: "Pós-Cirúrgico Agudo", "Sintoma e Dor Local", "Dúvida de Posologia", "Solicitação de Encaixe", "Exame e Laudo", "Agendamento Simples").
5. "urgencyReason": Breve justificativa clínica do nível de risco (1 a 2 frases).
6. "suggestedProtocol": Lista com 3 a 5 etapas objetivas do protocolo de triagem inicial a ser seguido pela recepção/enfermagem.
7. "recommendedAction": Ação prática imediata a ser tomada (ex: "Notificar plantonista e agendar encaixe hoje", "Solicitar foto/laudo do sintoma", "Confirmar dados do convênio e agendar").
8. "suggestedReply": Mensagem inicial empática, profissional e clara para ser enviada diretamente ao paciente via WhatsApp.`;

      const parsedData = await analyzeMessageStructured(prompt);

      if (parsedData) {
        // Fase 4: mesmo quando a IA responde com sucesso, o resultado passa
        // pelo gate humano — que marca requiresHumanReview=true sempre que a
        // urgência classificada for "alta". A classificação da IA nunca é
        // devolvida como decisão pronta para fechar o atendimento sozinha.
        const guarded = applyHumanReviewGate(parsedData, false);
        return res.json({ success: true, analysis: guarded });
      }

      // Fase 4: fallback FAIL-SAFE — nunca decide "baixa" silenciosamente e
      // sempre força revisão humana — ver server/clinical/triageGuardrails.ts.
      const guardedFallback = buildFailSafeFallback(messageText, patientName);
      return res.json({ success: true, analysis: guardedFallback, isFallback: true });
    } catch (error: any) {
      console.warn("Aviso na triagem de mensagens (usando fallback heurístico):", error?.message || error);

      const guardedFallback = buildFailSafeFallback(
        typeof req.body?.messageText === "string" ? req.body.messageText : "",
        req.body?.patientName
      );
      return res.json({ success: true, analysis: guardedFallback, isFallback: true });
    }
  });

  // MACHINE LEARNING AUTO-TAGGING ENDPOINT FOR PATIENT CONVERSATIONS
  // Fase 3 de Prontidão Comercial: requireFeature("classificacao_automatica").
  router.post("/ai/auto-tag", requireAuth, requireTab("atendimentos"), requireFeature("classificacao_automatica"), aiEndpointsRateLimiter, async (req, res) => {
    try {
      // Fase 4 de Prontidão Comercial: ver comentário equivalente na rota
      // de triagem clínica acima — "melhor esforço", nunca bloqueante.
      recordAiCallUsage(req.user!.clinicId, "classificacao_automatica");

      const { messages, conversationText, patientName, patientInsurance } = req.body;

      let fullText = "";
      if (typeof conversationText === "string" && conversationText.trim().length > 0) {
        fullText = conversationText.trim();
      } else if (Array.isArray(messages) && messages.length > 0) {
        fullText = messages
          .map((m: any) => `${m.sender || m.senderName || "Paciente"}: ${m.text || m.messageText || ""}`)
          .join("\n");
      } else {
        fullText = "Paciente: Gostaria de agendar uma consulta de rotina para ver exames pendentes.";
      }

      // Fase 3: fullText original (não sanitizado) é preservado para o
      // fallback heurístico mais abaixo, que só faz .includes() em
      // palavras-chave. Só a versão sanitizada vai para o prompt da IA.
      const safeFullText = sanitizeForPrompt(fullText);
      const safePatientName = patientName ? sanitizeForPrompt(String(patientName)) : "";

      const schema = {
        type: Type.OBJECT,
        properties: {
          primaryLabel: { type: Type.STRING, description: "Etiqueta principal (Urgent, Routine Request, Insurance Issue, Exam Results, Billing / Financial, Post-Op Question)" },
          summary: { type: Type.STRING, description: "Resumo do motivo da conversa" },
          suggestedTags: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                tag: { type: Type.STRING, description: "Nome do rótulo da tag em inglês ou português" },
                tagPt: { type: Type.STRING, description: "Tradução amigável em Português" },
                confidenceScore: { type: Type.NUMBER, description: "Confiança 0-100" },
                category: { type: Type.STRING, description: "Categoria funcional" },
                reason: { type: Type.STRING, description: "Explicação NLP da sugestão" },
                color: { type: Type.STRING, description: "Código Hex da cor" },
              },
              required: ["tag", "confidenceScore", "category", "reason", "color"],
            },
          },
        },
        required: ["primaryLabel", "summary", "suggestedTags"],
      };

      const prompt = `Você é um motor de Machine Learning NLP especialista em classificação automática e etiquetagem de conversas médicas e CRM de saúde.
Analise o conteúdo da conversa abaixo com um paciente e determine as sugestões de etiquetas (tags) com pontuação de confiança.

Possíveis Rótulos Principais de Classificação ML:
- 'Urgent' (Urgência / Emergência: dores agudas, febre, dor no peito, sangramento, complicação grave)
- 'Insurance Issue' (Convênio / Autorização: problemas com carteirinha, guia TISS, carência, autorização prévia)
- 'Routine Request' (Solicitação de Rotina: agendamento simples, horário de funcionamento, localização)
- 'Exam Results' (Exames e Laudos: entrega de resultados, consulta de laudo, preparo pré-exame)
- 'Billing / Financial' (Financeiro / Pagamento: orçamentos, emissão de nota fiscal, cobrança, links de pagamento)
- 'Post-Op Question' (Dúvidas de Pós-Operatório: cuidados pós-cirúrgicos, pontos, medicação de recuperação)

Dados da conversa:
- Paciente: ${safePatientName || "Paciente"}
- Convênio: ${patientInsurance || "Particular"}
- Histórico do Chat:
"${safeFullText}"

Responda rigorosamente em JSON com a lista de tags sugeridas ordenadas por pontuação de confiança (mínimo 2, máximo 4 tags).`;

      const parsedData = await aiRouter.generateForEndpoint("autoTag", { prompt, schema, logLabel: "Auto-Tag" });

      if (parsedData) {
        return res.json({ success: true, ...parsedData, source: "gemini-nlp-model" });
      }

      // Advanced Natural Language Keyword Heuristic Fallback
      const lower = fullText.toLowerCase();
      const isUrgent = lower.includes("dor") || lower.includes("sangue") || lower.includes("febre") || lower.includes("falta de ar") || lower.includes("urgente") || lower.includes("emergência") || lower.includes("forte");
      const isInsurance = lower.includes("convenio") || lower.includes("convênio") || lower.includes("guia") || lower.includes("bradesco") || lower.includes("sulamerica") || lower.includes("unimed") || lower.includes("carteirinha") || lower.includes("autorização") || lower.includes("tiss");
      const isExam = lower.includes("exame") || lower.includes("laudo") || lower.includes("resultado") || lower.includes("sangue") || lower.includes("ultrassom") || lower.includes("raio-x");
      const isFinancial = lower.includes("valor") || lower.includes("preço") || lower.includes("orçamento") || lower.includes("nota fiscal") || lower.includes("pagamento") || lower.includes("pix");
      const isPostOp = lower.includes("pós") || lower.includes("pos") || lower.includes("cirurgia") || lower.includes("ponto") || lower.includes("curativo");

      const suggestedTags: any[] = [];

      if (isUrgent) {
        suggestedTags.push({
          tag: "Urgent",
          tagPt: "Urgent (Sintoma Agudo)",
          confidenceScore: 95,
          category: "Triagem de Risco",
          reason: "Detectada linguagem com termos de urgência clínica/sintoma grave.",
          color: "#e11d48",
        });
      }

      if (isInsurance) {
        suggestedTags.push({
          tag: "Insurance Issue",
          tagPt: "Insurance Issue (Pendência de Convênio)",
          confidenceScore: 92,
          category: "Atendimento TISS",
          reason: "Menção a operadoras, guias ou autorização de plano de saúde.",
          color: "#d97706",
        });
      }

      if (isExam) {
        suggestedTags.push({
          tag: "Exam Results",
          tagPt: "Exam Results (Laudos & Resultados)",
          confidenceScore: 89,
          category: "Diagnósticos",
          reason: "Solicitação ligada a entrega ou envio de laudos e exames.",
          color: "#059669",
        });
      }

      if (isFinancial) {
        suggestedTags.push({
          tag: "Billing / Financial",
          tagPt: "Billing / Financial (Orçamento)",
          confidenceScore: 86,
          category: "Comercial",
          reason: "Consultas relativas a valores, boletos ou formas de pagamento.",
          color: "#7c3aed",
        });
      }

      if (isPostOp) {
        suggestedTags.push({
          tag: "Post-Op Question",
          tagPt: "Post-Op Question (Pós-Operatório)",
          confidenceScore: 91,
          category: "Acompanhamento Clínico",
          reason: "Orientação sobre pós-procedimento cirúrgico ou recuperação.",
          color: "#0284c7",
        });
      }

      // Default Routine Request if no specific urgent or specialized triggers
      if (suggestedTags.length === 0 || !isUrgent) {
        suggestedTags.push({
          tag: "Routine Request",
          tagPt: "Routine Request (Atendimento de Rotina)",
          confidenceScore: 94,
          category: "Agendamento Geral",
          reason: "Interação padrão para agendamento ou dúvidas administrativas de rotina.",
          color: "#2563eb",
        });
      }

      const primaryLabel = isUrgent ? "Urgent" : isInsurance ? "Insurance Issue" : isExam ? "Exam Results" : isFinancial ? "Billing / Financial" : "Routine Request";

      return res.json({
        success: true,
        primaryLabel,
        summary: `Análise ML realizada com base na linguagem natural do texto (${suggestedTags.length} tags identificadas).`,
        suggestedTags,
        source: "heuristic-nlp-engine",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao processar etiquetagem por ML." });
    }
  });

  // AI LEAD QUALIFICATION & SCHEDULING INTENT ANALYZER
  // Fase 3 de Prontidão Comercial: requireFeature("qualificacao_lead").
  router.post("/ai/qualify-lead", requireAuth, requireTab("atendimentos"), requireFeature("qualificacao_lead"), aiEndpointsRateLimiter, async (req, res) => {
    try {
      // Fase 4 de Prontidão Comercial: ver comentário equivalente na rota
      // de triagem clínica acima — "melhor esforço", nunca bloqueante.
      recordAiCallUsage(req.user!.clinicId, "qualificacao_lead");

      const { messageText, conversationHistory, patientName, patientPhone, declaredInsurance, specialty } = req.body;

      let fullMessage = "";
      if (typeof messageText === "string" && messageText.trim().length > 0) {
        fullMessage = messageText.trim();
      } else if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
        fullMessage = conversationHistory.map((m: any) => `${m.sender || m.senderName || "Paciente"}: ${m.text || m.messageText || ""}`).join("\n");
      } else {
        fullMessage = "Olá, gostaria de saber informações sobre implantes dentários particulares.";
      }

      // Fase 3: fullMessage original (não sanitizado) é preservado para o
      // fallback heurístico mais abaixo, que só faz .includes() em
      // palavras-chave. Só a versão sanitizada vai para o prompt da IA.
      const safeFullMessage = sanitizeForPrompt(fullMessage);
      const safePatientName = patientName ? sanitizeForPrompt(String(patientName)) : "";

      const schema = {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER, description: "Lead score de 0 a 100 com base em valor potencial e intenção de compra" },
          tier: { type: Type.STRING, description: "'VIP / Alto Valor', 'Ouro (Alta Conversão)', 'Prata (Padrão)', ou 'Bronze (Rotina/Dúvida)'" },
          financialCategory: { type: Type.STRING, description: "'Particular (Alto Valor)', 'Particular (Rotina)', 'Convênio Premium', 'Convênio Básico', ou 'Indefinido'" },
          treatmentIntent: { type: Type.STRING, description: "'Procedimento Estético de Alto Valor', 'Cirurgia / Procedimento Especializado', 'Tratamento Continuado', 'Consulta / Check-up Especializado', 'Consulta Rotineira', ou 'Dúvida Administrativa / Cobertura'" },
          estimatedValueRange: { type: Type.STRING, description: "Faixa de valor estimado em Reais (ex: 'R$ 6.000,00 - R$ 15.000,00', 'R$ 450,00 (Consulta Particular)')" },
          urgencyLevel: { type: Type.STRING, description: "'Imediata / Hoje', 'Alta (24-48h)', 'Moderada', ou 'Flexível'" },
          conversionProbability: { type: Type.NUMBER, description: "Probabilidade estimada de conversão de 0 a 100%" },
          keyBuyingSignals: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Lista com 2 a 4 sinais claros de intenção de compra ou decisão financeira",
          },
          smartRouting: {
            type: Type.OBJECT,
            properties: {
              recommendedAttendant: { type: Type.STRING, description: "Nome e cargo do atendente recomendado" },
              conversionRate: { type: Type.NUMBER, description: "Taxa percentual de conversão do atendente" },
              routingReason: { type: Type.STRING, description: "Justificativa do roteamento para a recepção" },
              routingStatus: { type: Type.STRING, description: "'auto_routed'" },
              priorityQueue: { type: Type.BOOLEAN, description: "true se o lead deve ser posicionado no topo da fila prioritária" },
            },
            required: ["recommendedAttendant", "conversionRate", "routingReason", "routingStatus", "priorityQueue"],
          },
          aiSummaryBriefing: { type: Type.STRING, description: "Resumo executivo ultra-direto de 1 a 2 frases para o recepcionista ler em 5 segundos" },
          recommendedSalesPitch: { type: Type.STRING, description: "Sugestão de resposta persuasiva personalizada para fechar o agendamento" },
        },
        required: [
          "score",
          "tier",
          "financialCategory",
          "treatmentIntent",
          "estimatedValueRange",
          "urgencyLevel",
          "conversionProbability",
          "keyBuyingSignals",
          "smartRouting",
          "aiSummaryBriefing",
          "recommendedSalesPitch",
        ],
      };

      const prompt = `Você é um motor de Inteligência Artificial especialista em Qualificação Automática de Leads Médicos, Intenção de Agendamento e Roteamento Inteligente em Saúde (Healthtech CRM).
Analise a mensagem do lead abaixo recebida no WhatsApp/Webchat e classifique rigorosamente sua intenção, disposição financeira (Particular vs Convênio, Procedimento de Alto Valor vs Consulta de Rotina) e calcule o Lead Score instantâneo (0 a 100).

Diretrizes de Lead Scoring:
- VIP / Alto Valor (85 a 100): Procedimentos estéticos particulares (Harmonização, Botox, Lipoaspiração, Facetas de porcelana, Implantes dentários, Rinoplastia, Cirurgias particulares, Check-up executivo) ou dúvidas explícitas sobre parcelamento e valores altos. Roteamento: 'Camila Santos (Top Closer / Concierge VIP)' com Fila Prioritária.
- Ouro / Alta Conversão (70 a 84): Consultas particulares especializadas, exames particulares complementares, interesse urgente em marcar (hoje/amanhã). Roteamento: 'Camila Santos (Top Closer Recepção)' ou 'Mariana Costa (Especialista Comercial)'.
- Prata / Padrão (50 a 69): Consultas de convênio (Bradesco, SulAmérica, Unimed, Amil) ou procedimentos cobertos pelo plano de saúde. Roteamento: 'Mariana Costa (Recepção Geral)' ou 'Fernanda Lima (Especialista TISS)' se envolver autorização de guia.
- Bronze / Rotina (0 a 49): Dúvidas básicas de localização, envio simples de comprovante ou consultas rotineiras gerais. Roteamento: 'Mariana Costa (Recepção Geral)'.

Dados do Lead:
- Nome do Paciente: ${safePatientName || "Lead WhatsApp"}
- Telefone: ${patientPhone || "(11) 99999-0000"}
- Convênio Informado: ${declaredInsurance || "Particular"}
- Especialidade de Interesse: ${specialty || "Não especificada"}
- Mensagem recebida: "${safeFullMessage}"

Responda estritamente em formato JSON compatível com o schema.`;

      const parsedData = await aiRouter.generateForEndpoint("qualifyLead", { prompt, schema, logLabel: "Lead Qualify" });

      const timestampNow = new Date().toLocaleString("pt-BR");

      if (parsedData) {
        return res.json({
          success: true,
          qualification: {
            ...parsedData,
            analyzedAt: timestampNow,
          },
          source: "gemini-3.6-flash",
        });
      }

      // Heuristic NLP Intelligence Fallback for Instant Lead Scoring
      const lower = fullMessage.toLowerCase();
      const isAestheticOrSurgery = lower.includes("implante") || lower.includes("faceta") || lower.includes("botox") || lower.includes("harmoniza") || lower.includes("clareamento") || lower.includes("cirurgia") || lower.includes("plastica") || lower.includes("prótese");
      const isParticular = lower.includes("particular") || (!lower.includes("unimed") && !lower.includes("bradesco") && !lower.includes("sulamerica") && !lower.includes("amil") && !lower.includes("convênio") && !lower.includes("convenio"));
      const isFinancing = lower.includes("parcela") || lower.includes("juros") || lower.includes("cartão") || lower.includes("pix") || lower.includes("desconto") || lower.includes("preço") || lower.includes("valor");
      const isUrgent = lower.includes("hoje") || lower.includes("urgente") || lower.includes("amanhã") || lower.includes("esta semana") || lower.includes("vaga");

      let score = 55;
      let tier = "Prata (Padrão)";
      let financialCategory = "Convênio Premium";
      let treatmentIntent = "Consulta / Check-up Especializado";
      let estimatedValueRange = "R$ 450,00 (Consulta)";
      let urgencyLevel = isUrgent ? "Imediata / Hoje" : "Alta (24-48h)";
      let conversionProbability = 75;
      let recommendedAttendant = "Mariana Costa (Recepção Geral)";
      let priorityQueue = false;
      let conversionRate = 85;
      let keyBuyingSignals: string[] = [];

      if (isAestheticOrSurgery && (isParticular || isFinancing)) {
        score = 96;
        tier = "VIP / Alto Valor";
        financialCategory = "Particular (Alto Valor)";
        treatmentIntent = "Procedimento Estético de Alto Valor";
        estimatedValueRange = "R$ 6.500,00 - R$ 18.000,00";
        conversionProbability = 95;
        recommendedAttendant = "Camila Santos (Top Closer / Concierge VIP)";
        priorityQueue = true;
        conversionRate = 96;
        keyBuyingSignals = [
          "Interesse explícito em procedimentos de alto valor/estética",
          "Disposição para pagamento particular ou parcelamento facilitado",
          "Sinal de alta propensão de fechamento na primeira interação",
        ];
      } else if (isAestheticOrSurgery || isParticular) {
        score = 86;
        tier = "Ouro (Alta Conversão)";
        financialCategory = "Particular (Rotina)";
        treatmentIntent = "Procedimento Estético de Alto Valor";
        estimatedValueRange = "R$ 2.800,00 - R$ 6.500,00";
        conversionProbability = 88;
        recommendedAttendant = "Camila Santos (Top Closer Recepção)";
        priorityQueue = true;
        conversionRate = 92;
        keyBuyingSignals = [
          "Procura atendimento particular sem restrição de convênio",
          "Interesse em agendamento de avaliação especializada",
        ];
      } else {
        score = 60;
        tier = "Prata (Padrão)";
        financialCategory = "Convênio Básico";
        treatmentIntent = "Consulta Rotineira";
        estimatedValueRange = "R$ 280,00 (Guia TISS)";
        conversionProbability = 70;
        recommendedAttendant = "Mariana Costa (Recepção Geral)";
        priorityQueue = false;
        conversionRate = 84;
        keyBuyingSignals = [
          "Consulta de rotina com cobertura de convênio",
          "Fluxo padrão de validação de elegibilidade TISS",
        ];
      }

      const fallbackQualification = {
        score,
        tier,
        financialCategory,
        treatmentIntent,
        estimatedValueRange,
        urgencyLevel,
        conversionProbability,
        keyBuyingSignals,
        smartRouting: {
          recommendedAttendant,
          conversionRate,
          routingReason: score >= 85 ? `LEAD VIP DE ALTO VALOR (${estimatedValueRange}). Direcionado diretamente para o melhor atendente humano da recepção.` : "Lead qualificado para atendimento humanizado ágil na recepção.",
          routingStatus: "auto_routed",
          priorityQueue,
        },
        aiSummaryBriefing: `Lead qualificado com Score ${score}/100 para ${treatmentIntent}. Perfil: ${financialCategory}.`,
        recommendedSalesPitch: `Olá! Temos horários especiais nesta semana para avaliação completa com nossos especialistas. Conseguimos condições diferenciadas em até 12x sem juros. Podemos reservar seu horário?`,
        analyzedAt: timestampNow,
      };

      return res.json({
        success: true,
        qualification: fallbackQualification,
        source: "heuristic-nlp-engine",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao qualificar lead por IA." });
    }
  });

  return router;
}
