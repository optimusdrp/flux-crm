// ---------------------------------------------------------------------------
// Camada de abstração de provider de IA
//
// Duas IAs coexistem no projeto — Google Gemini e Claude via Amazon
// Bedrock — cada endpoint escolhe qual usar como principal, com o outro
// como reserva. Esta interface é o contrato comum: todo provider recebe um
// prompt + um schema de saída esperado, e devolve o JSON já parseado (ou
// null se falhar, nunca lança exceção — quem chama decide o próximo passo).
//
// Por que não uma única função genérica de "chamar IA": Gemini e Claude têm
// mecanismos nativos diferentes para forçar saída JSON estruturada (Gemini:
// responseSchema; Claude: tool use forçado com tool_choice). Cada provider
// concreto (gemini.provider.ts, bedrock.provider.ts) sabe traduzir o mesmo
// schema de entrada para o mecanismo nativo do seu respectivo SDK.
// ---------------------------------------------------------------------------

export type ProviderName = "gemini" | "bedrock";

export interface GenerateStructuredParams {
  /** Texto do prompt já pronto (o chamador monta o prompt final). */
  prompt: string;
  /**
   * Schema da saída esperada, no formato usado pelo SDK do Gemini
   * (Type.OBJECT / Type.STRING / etc — ver @google/genai). Os providers
   * concretos convertem esse mesmo schema para o formato que precisarem
   * (ex.: Bedrock/Claude o converte para um JSON Schema de tool use).
   */
  schema: Record<string, unknown>;
  /** Rótulo curto para identificar o endpoint nos logs (ex.: "Triagem"). */
  logLabel: string;
}

export interface AiProvider {
  name: ProviderName;
  /**
   * Gera conteúdo estruturado (JSON) a partir de um prompt. Retorna o
   * objeto já parseado em caso de sucesso, ou null se o provider falhar
   * (erro de rede, credencial, todos os modelos candidatos esgotados).
   * Nunca lança exceção — a falha é sempre um retorno null + log.
   */
  generateStructured<T = any>(params: GenerateStructuredParams): Promise<T | null>;
}
