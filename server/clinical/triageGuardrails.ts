// ---------------------------------------------------------------------------
// Fase 4 — Guardrails clínicos da IA
//
// /api/analyze-message é o endpoint mais sensível do sistema: ele classifica
// a urgência clínica de uma mensagem de paciente. Antes desta fase, a
// resposta da IA (ou do fallback heurístico) era devolvida como se fosse
// uma decisão pronta, sem nenhum sinalizador de que precisa de confirmação
// humana — e o fallback heurístico decidia "baixa" por padrão sempre que
// nenhuma palavra-chave batia, o que é o pior tipo de erro nesse contexto
// (um falso negativo pode significar não escalar uma emergência real).
//
// Este módulo formaliza duas regras:
//  1. GATE HUMANO: toda resposta de triagem carrega um campo
//     `requiresHumanReview`, sempre true quando a urgência é "alta" —
//     nunca deve ser tratado como decisão automática de fechar o
//     atendimento.
//  2. FAIL-SAFE NO FALLBACK: quando a IA falha e caímos na heurística,
//     a ausência de sinal claro NUNCA deve resultar em "baixa" por
//     padrão. Na dúvida, o fallback sobe para "media" (nunca desce para
//     "baixa" silenciosamente) e sempre marca isFallback + requiresHumanReview.
// ---------------------------------------------------------------------------

export type UrgencyLevel = "alta" | "media" | "baixa";

export interface TriageAnalysis {
  urgency: UrgencyLevel;
  urgencyLabel: string;
  confidenceScore: number;
  category: string;
  urgencyReason: string;
  suggestedProtocol: string[];
  recommendedAction: string;
  suggestedReply: string;
}

export interface GuardedTriageResult extends TriageAnalysis {
  // true quando a classificação NÃO pode ser tratada como decisão final —
  // ou seja, sempre que for "alta" (por segurança) ou sempre que vier do
  // fallback heurístico (porque a IA não confirmou).
  requiresHumanReview: boolean;
  // false quando veio do modelo de IA; true quando veio do fallback local.
  isFallback: boolean;
}

/**
 * Aplica o gate humano sobre um resultado de triagem (vindo da IA ou do
 * fallback): marca requiresHumanReview sempre que a urgência for alta,
 * mesmo que a IA já tenha respondido com alta confiança — a classificação
 * da IA aqui é entrada para a decisão humana, nunca a decisão em si.
 */
export function applyHumanReviewGate(
  analysis: TriageAnalysis,
  isFallback: boolean
): GuardedTriageResult {
  const requiresHumanReview = analysis.urgency === "alta" || isFallback;
  return { ...analysis, requiresHumanReview, isFallback };
}

/**
 * Heurística de fallback FAIL-SAFE: usada somente quando a IA está
 * indisponível. Ao contrário da heurística original (que assumia "baixa"
 * por padrão), esta nunca decide "baixa" sozinha — o padrão quando nenhuma
 * palavra-chave de alto risco bate é "media", forçando revisão humana em
 * vez de arriscar deixar passar uma urgência real não identificada pela
 * lista de palavras-chave.
 *
 * Continua sendo uma heurística simples (mesma limitação documentada no
 * mediflux-agent: não pega formulações indiretas nem trata negação), mas
 * o viés do "não sei" agora é para o lado seguro.
 */
export function buildFailSafeFallback(messageText: string, patientName?: string): GuardedTriageResult {
  const msg = messageText.toLowerCase();

  const highRiskSignals = [
    "dor", "sangue", "sangrando", "cirurgi", "febre", "falta de ar",
    "urgente", "urgência", "emergência", "desmaio", "convuls", "não consigo respirar",
  ];
  const isHigh = highRiskSignals.some((kw) => msg.includes(kw));

  // Fail-safe: se não bateu "alta", o default é "media" (nunca "baixa").
  // "baixa" só é usada quando a mensagem claramente indica algo
  // administrativo e nenhum termo de risco aparece — mesmo assim, o
  // requiresHumanReview do fallback (ver applyHumanReviewGate) garante que
  // um humano ainda revisa antes de qualquer coisa ser fechada.
  const routineSignals = [
    "comprovante", "horário de funcionamento", "endereço", "boleto", "nota fiscal",
  ];
  const looksRoutine = routineSignals.some((kw) => msg.includes(kw));

  const urgency: UrgencyLevel = isHigh ? "alta" : looksRoutine ? "baixa" : "media";

  const analysis: TriageAnalysis = {
    urgency,
    urgencyLabel:
      urgency === "alta"
        ? "Emergência / Alta Urgência (Triagem Local — requer revisão humana)"
        : urgency === "media"
          ? "Atenção Moderada (Triagem Local — requer revisão humana)"
          : "Atendimento de Rotina (Triagem Local — requer revisão humana)",
    confidenceScore: 60, // confiança deliberadamente baixa — é heurística, não IA
    category: isHigh ? "Sintoma Agudo / Possível Emergência" : "Triagem Preliminar (IA indisponível)",
    urgencyReason: `Classificação heurística local (a IA de triagem estava indisponível no momento). Mensagem: "${messageText.substring(0, 70)}...". Revisão humana obrigatória antes de qualquer ação.`,
    suggestedProtocol: [
      "1. ATENÇÃO: esta triagem foi gerada por heurística local (IA indisponível), não pela análise clínica completa.",
      "2. Um profissional deve revisar a mensagem original do paciente antes de decidir a conduta.",
      "3. Em caso de dúvida sobre gravidade, tratar como urgente até confirmação.",
    ],
    recommendedAction: isHigh
      ? "Encaminhar para revisão humana IMEDIATA — possível emergência não confirmada por IA."
      : "Encaminhar para revisão humana antes de responder ao paciente.",
    suggestedReply: `Olá ${patientName || ""}! Recebemos sua mensagem e nossa equipe já está analisando o caso com atenção. Retornaremos em breve.`,
  };

  return applyHumanReviewGate(analysis, true);
}
