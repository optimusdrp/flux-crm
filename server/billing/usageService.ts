import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { AddOnId } from "./planCatalog";

// ---------------------------------------------------------------------------
// Fase 4 de Prontidão Comercial — Medição de uso
//
// Resolve dois achados da auditoria: (1) nenhum contador real respaldava
// o limite de "atendimentos/mês" prometido em cada plano — o único
// usageCount que existia antes era de quantas vezes um modelo de resposta
// rápida foi usado no chat, sem relação com faturamento; (2) ausência de
// qualquer proteção de taxa nos endpoints de IA.
//
// Um "atendimento" é contado uma vez por paciente/conversa nova — não por
// mensagem trocada — seguindo a definição mais simples e defensável do
// plano de implementação: evita que uma conversa longa infle
// artificialmente o consumo do plano.
// ---------------------------------------------------------------------------

export type AiEndpointKey = AddOnId;

export interface UsageRecord {
  clinicId: string;
  periodKey: string; // "AAAA-MM", mês corrente em UTC
  appointmentsCount: number;
  aiCallsByEndpoint: Record<AiEndpointKey, number>;
}

/** Chave do período corrente — um novo registro nasce automaticamente a cada mês, sem migração ou job de virada explícito. */
export function currentPeriodKey(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

const EMPTY_AI_CALLS: Record<AiEndpointKey, number> = {
  triagem_clinica: 0,
  classificacao_automatica: 0,
  qualificacao_lead: 0,
  analise_sentimento: 0,
};

function emptyUsageRecord(clinicId: string, periodKey: string): UsageRecord {
  return { clinicId, periodKey, appointmentsCount: 0, aiCallsByEndpoint: { ...EMPTY_AI_CALLS } };
}

/**
 * Busca o uso do mês corrente de uma clínica. Nunca lança exceção — em
 * caso de erro ou ausência de registro (clínica ainda não gerou nenhum
 * atendimento/chamada de IA neste mês), devolve um registro zerado, nunca
 * um erro que travaria a rota que só quer LER o consumo.
 */
export async function getClinicUsage(clinicId: string, periodKey: string = currentPeriodKey()): Promise<UsageRecord> {
  try {
    const res = await docClient.send(new GetCommand({ TableName: "UsageRecords", Key: { clinicId, periodKey } }));
    if (!res.Item) {
      return emptyUsageRecord(clinicId, periodKey);
    }
    return {
      clinicId,
      periodKey,
      appointmentsCount: typeof res.Item.appointmentsCount === "number" ? res.Item.appointmentsCount : 0,
      aiCallsByEndpoint: { ...EMPTY_AI_CALLS, ...(res.Item.aiCallsByEndpoint || {}) },
    };
  } catch (e) {
    console.error(`[Usage] Erro ao consultar uso da clínica ${clinicId}:`, e);
    return emptyUsageRecord(clinicId, periodKey);
  }
}

/**
 * Incrementa o contador de atendimentos novos do mês corrente. Cria o
 * registro do período se ainda não existir (DynamoDB UpdateCommand com
 * `if_not_exists` cobre isso numa única operação atômica, sem race
 * condition entre "ler se existe" e "criar").
 *
 * Chamado de forma "melhor esforço": se a gravação de uso falhar, isso
 * NUNCA deve impedir a criação do atendimento em si — medição de uso é
 * uma camada auxiliar, não pode travar a operação principal do sistema.
 */
export async function recordAppointmentUsage(clinicId: string, periodKey: string = currentPeriodKey()): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: "UsageRecords",
        Key: { clinicId, periodKey },
        UpdateExpression: "SET appointmentsCount = if_not_exists(appointmentsCount, :zero) + :one",
        ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
      })
    );
  } catch (e) {
    console.warn(`[Usage] Falha ao registrar atendimento da clínica ${clinicId} (não bloqueante):`, e);
  }
}

/**
 * Incrementa o contador de chamadas de um endpoint de IA específico no mês
 * corrente. Mesma filosofia "melhor esforço" de recordAppointmentUsage —
 * uma falha aqui nunca deve impedir a resposta da IA já processada.
 *
 * O DynamoDB não permite atualizar um caminho aninhado (aiCallsByEndpoint.x)
 * quando o mapa aiCallsByEndpoint ainda não existe no item — por isso são
 * duas atualizações em sequência: a primeira garante que o mapa exista
 * (sem sobrescrever um mapa já existente, via if_not_exists no nível
 * raiz), a segunda incrementa o campo específico dentro dele. Não é uma
 * transação atômica única, mas cada passo individual é idempotente o
 * bastante para o propósito de contagem aproximada de uso.
 */
export async function recordAiCallUsage(clinicId: string, endpoint: AiEndpointKey, periodKey: string = currentPeriodKey()): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: "UsageRecords",
        Key: { clinicId, periodKey },
        UpdateExpression: "SET aiCallsByEndpoint = if_not_exists(aiCallsByEndpoint, :emptyMap)",
        ExpressionAttributeValues: { ":emptyMap": { ...EMPTY_AI_CALLS } },
      })
    );
    await docClient.send(
      new UpdateCommand({
        TableName: "UsageRecords",
        Key: { clinicId, periodKey },
        UpdateExpression: `SET aiCallsByEndpoint.#ep = if_not_exists(aiCallsByEndpoint.#ep, :zero) + :one`,
        ExpressionAttributeNames: { "#ep": endpoint },
        ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
      })
    );
  } catch (e) {
    console.warn(`[Usage] Falha ao registrar chamada de IA (${endpoint}) da clínica ${clinicId} (não bloqueante):`, e);
  }
}

/**
 * Compara o uso do mês corrente de uma clínica contra o limite de
 * atendimentos do plano contratado. Não bloqueia nada por si só — devolve
 * a informação para quem chamar decidir o que fazer (ver
 * server/routes/patients.ts, POST /, que usa isso só para sinalizar o
 * excedente na resposta, nunca para impedir a criação do atendimento).
 *
 * Decisão de produto registrada no Plano de Prontidão Comercial (Fase 4):
 * o documento comercial já promete "excedente cobrado à parte" — bloquear
 * o atendimento contradiria essa promessa. A cobrança do excedente em si
 * é trabalho da Fase 5 (Integração de cobrança); esta função só produz o
 * dado que a Fase 5 vai precisar.
 */
export async function checkAppointmentLimit(
  clinicId: string,
  includedAppointmentsPerMonth: number,
  periodKey: string = currentPeriodKey()
): Promise<{ appointmentsCount: number; includedAppointmentsPerMonth: number; overLimit: boolean; overageCount: number }> {
  const usage = await getClinicUsage(clinicId, periodKey);
  const overLimit = usage.appointmentsCount >= includedAppointmentsPerMonth;
  const overageCount = Math.max(0, usage.appointmentsCount - includedAppointmentsPerMonth);
  return {
    appointmentsCount: usage.appointmentsCount,
    includedAppointmentsPerMonth,
    overLimit,
    overageCount,
  };
}

