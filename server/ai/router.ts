import { AiProvider, GenerateStructuredParams, ProviderName } from "./providers/types";

// ---------------------------------------------------------------------------
// Roteador de IA — decide qual provider usar por endpoint, com fallback
// cruzado para o outro provider antes de desistir.
//
// Divisão adotada (decisão consciente, não migração cega de tudo para
// Bedrock):
//  - Triagem clínica (analyze-message) → Bedrock (Claude Haiku 4.5) como
//    principal. É o endpoint mais sensível do sistema (guardrails da
//    Fase 4); mantém o mesmo ecossistema AWS/IAM já usado no restante do
//    projeto (Cheleon ERP, ms-crm-agent).
//  - Auto-tag, qualificação de lead, análise de sentimento → Gemini
//    permanece principal, sem motivo forte para migrar tarefas de
//    classificação/rotina que já funcionam bem.
//
// Em qualquer endpoint, se o provider principal falhar (todos os seus
// modelos candidatos esgotados), o roteador tenta o provider secundário
// antes de retornar null — só nesse ponto o chamador cai no fallback
// heurístico local. Isso é ganho de resiliência real: antes, uma falha
// total do Gemini já significava cair direto na heurística; agora só
// acontece se os DOIS providers falharem.
// ---------------------------------------------------------------------------

export type EndpointName = "triagem" | "autoTag" | "qualifyLead" | "sentimentAnalysis";

interface RouterDeps {
  gemini: AiProvider;
  bedrock: AiProvider;
}

const PRIMARY_PROVIDER_BY_ENDPOINT: Record<EndpointName, ProviderName> = {
  triagem: "bedrock",
  autoTag: "gemini",
  qualifyLead: "gemini",
  sentimentAnalysis: "gemini",
};

export function createAiRouter({ gemini, bedrock }: RouterDeps) {
  const providersByName: Record<ProviderName, AiProvider> = { gemini, bedrock };

  /**
   * Gera conteúdo estruturado para um endpoint específico, tentando o
   * provider principal daquele endpoint e, se ele falhar por completo,
   * o provider secundário. Retorna null (e quem chama decide o fallback
   * heurístico local) só se ambos falharem.
   */
  async function generateForEndpoint<T = any>(
    endpoint: EndpointName,
    params: Omit<GenerateStructuredParams, "logLabel"> & { logLabel: string }
  ): Promise<T | null> {
    const primaryName = PRIMARY_PROVIDER_BY_ENDPOINT[endpoint];
    const secondaryName: ProviderName = primaryName === "gemini" ? "bedrock" : "gemini";

    const primary = providersByName[primaryName];
    const result = await primary.generateStructured<T>(params);
    if (result !== null) return result;

    console.warn(
      `[AI Router] Provider principal (${primaryName}) falhou para "${params.logLabel}" — tentando reserva (${secondaryName})...`
    );

    const secondary = providersByName[secondaryName];
    const fallbackResult = await secondary.generateStructured<T>(params);
    if (fallbackResult !== null) return fallbackResult;

    console.error(
      `[AI Router] Ambos os providers (${primaryName} e ${secondaryName}) falharam para "${params.logLabel}" — caindo no fallback local.`
    );
    return null;
  }

  return { generateForEndpoint };
}
