// ---------------------------------------------------------------------------
// Fase 3 — Validação de entrada / whitelist de campos
//
// Padrão que se repetia em quase toda rota de escrita: `{ ...getRes.Item,
// ...req.body, id }`. Isso deixa o cliente sobrescrever QUALQUER campo do
// registro salvo no Dynamo, incluindo campos que deveriam ser calculados
// pelo servidor (ex.: lastMessageTime, unreadCount) ou usados só
// internamente. pickAllowedFields() filtra req.body para conter apenas as
// chaves que a entidade realmente permite o cliente alterar.
//
// Este é um filtro de CHAVES (whitelist), não uma validação de tipo/forma
// completa — o objetivo desta fase é eliminar a superfície de "o cliente
// escreve qualquer campo que quiser", sem reescrever o schema inteiro de
// cada entidade (risco maior de regressão em uma UI já em uso). Validação
// de tipo mais estrita fica para uma iteração futura, se necessário.
// ---------------------------------------------------------------------------

/**
 * Retorna uma cópia de `body` contendo somente as chaves presentes em
 * `allowedFields`. Chaves fora da whitelist são silenciosamente
 * descartadas — não geram erro, só não entram no update.
 */
export function pickAllowedFields<T extends Record<string, unknown>>(
  body: Record<string, unknown>,
  allowedFields: readonly string[]
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      result[field] = body[field];
    }
  }
  return result as Partial<T>;
}

// Campos que o cliente pode definir ao CRIAR um paciente. Note que "id" não
// está aqui de propósito — o id é gerado/atribuído fora desta whitelist.
export const PATIENT_CREATE_FIELDS = [
  "name",
  "phone",
  "insurance",
  "specialty",
  "planType",
  "cpf",
  "birthDate",
  "status",
  "stage",
  "urgency",
  "lastMessage",
  "assignedTo",
  "channel",
  "checklist",
  "internalNotes",
  "tags",
  "ehrSystem",
  "ehrRecordId",
  "appointmentDate",
  "appointmentTime",
] as const;

// Campos que o cliente pode alterar ao ATUALIZAR um paciente existente.
// Deliberadamente sem: id, lastMessageTime (mantido pelo servidor em
// /api/chat), unreadCount (idem), leadScore (calculado pela IA de
// qualificação, não editável manualmente pelo cliente).
export const PATIENT_UPDATE_FIELDS = [
  "name",
  "phone",
  "insurance",
  "specialty",
  "planType",
  "cpf",
  "birthDate",
  "status",
  "stage",
  "urgency",
  "lastMessage",
  "unreadCount",
  "assignedTo",
  "slaWarning",
  "channel",
  "nextAction",
  "checklist",
  "internalNotes",
  "tags",
  "sentiment",
  "ehrSynced",
  "ehrSystem",
  "ehrRecordId",
  "appointmentDate",
  "appointmentTime",
] as const;

export const APPOINTMENT_UPDATE_FIELDS = [
  "time",
  "duration",
  "patientName",
  "procedure",
  "status",
] as const;

export const PRIORITY_RULE_UPDATE_FIELDS = ["title", "slaLimit", "count", "active"] as const;

export const AUTOMATION_UPDATE_FIELDS = ["name", "trigger", "successRate", "status"] as const;

export const EHR_INTEGRATION_UPDATE_FIELDS = ["status", "lastSync", "recordsCount", "config"] as const;
