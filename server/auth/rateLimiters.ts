import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Request } from "express";

// ---------------------------------------------------------------------------
// Fase 4 de Prontidão Comercial — Rate limiting dos endpoints de IA
//
// Resolve o quarto achado da auditoria: os 4 endpoints de IA não tinham
// nenhuma proteção de taxa. Diferente de requireFeature (que bloqueia por
// não ter contratado o add-on) e checkAppointmentLimit (que só sinaliza
// excedente, sem bloquear), este limite é técnico e curto prazo — protege
// contra uso anômalo (loop de integração com erro, script disparando
// chamadas repetidas) que geraria custo real de API sem nenhuma barreira,
// independente do que a clínica contratou ou de quanto já usou no mês.
//
// A chave do limite é a clínica (req.user.clinicId), não o IP: numa
// clínica com vários atendentes atrás do mesmo NAT/proxy, limitar por IP
// penalizaria todos juntos por engano; limitar por clínica reflete a
// unidade de negócio real que está sendo protegida.
// ---------------------------------------------------------------------------

function clinicRateLimitKey(req: Request): string {
  // Se por algum motivo req.user não estiver populado ainda (não deveria
  // acontecer, já que requireAuth roda antes na cadeia), cai para o IP —
  // mais restritivo que deixar sem chave nenhuma, nunca abre uma brecha.
  // ipKeyGenerator normaliza endereços IPv6 (ex.: agrupa por prefixo /64)
  // — sem isso, o express-rate-limit v8 recusa a keyGenerator customizada
  // logo na inicialização (ERR_ERL_KEY_GEN_IPV6), porque um cliente IPv6
  // poderia gerar endereços diferentes a cada requisição e nunca ser
  // limitado.
  return req.user?.clinicId || ipKeyGenerator(req.ip || "unknown");
}

/**
 * Limite por clínica para os 4 endpoints de IA: no máximo 30 chamadas por
 * minuto, somando os quatro endpoints. Generoso o suficiente para uso
 * humano normal (mesmo uma recepção movimentada não dispara triagem,
 * auto-tag, qualificação e sentimento 30 vezes em 60 segundos de forma
 * legítima), mas barra um loop de erro ou script indevido antes que ele
 * gere um custo real de API relevante.
 */
export const aiEndpointsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clinicRateLimitKey,
  message: {
    success: false,
    error: "Limite de chamadas de IA por minuto excedido para esta clínica. Aguarde um instante e tente novamente.",
  },
});
