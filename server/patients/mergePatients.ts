// ---------------------------------------------------------------------------
// Mesclagem de pacientes duplicados
//
// Recebe dois IDs de paciente e qual dos dois o usuário escolheu como
// "principal" (a escolha NUNCA é automática — ver server/patients/
// duplicateDetection.ts, que só aponta candidatos, e a rota POST
// /:id/merge em server/routes/patients.ts, que exige o campo
// keepPatientId explicitamente no corpo da requisição).
//
// O que a mesclagem faz:
//  1. Reatribui as mensagens de chat do paciente descartado para o
//     principal (ChatMessages tem patientId como referência real, via o
//     índice patientId-index).
//  2. Combina campos informativos do descartado que o principal não
//     tinha preenchido (ex.: CPF, convênio) — nunca sobrescreve um campo
//     que o principal já tinha.
//  3. Remove o registro do paciente descartado.
//
// Limitação conhecida e deliberadamente não resolvida aqui: a tabela
// Appointments guarda "patientName" (texto livre), não um patientId real
// — não existe uma referência que permita reatribuir agendamentos de
// forma confiável por ID. Agendamentos do paciente descartado não são
// reatribuídos automaticamente; ficam associados ao nome antigo, e cabe a
// quem mesclar revisar manualmente se havia agendamentos pendentes. Isso
// é uma lacuna do modelo de dados atual, não desta função — corrigir de
// verdade exigiria adicionar patientId a Appointments, o que está fora do
// escopo desta mudança.
// ---------------------------------------------------------------------------

export interface PatientRecordForMerge {
  id: string;
  [key: string]: unknown;
}

export interface MergeResult {
  mergedPatient: PatientRecordForMerge;
  discardedPatientId: string;
  fieldsFilledFromDiscarded: string[];
}

/**
 * Combina dois registros de paciente: o principal (keepPatient) recebe
 * qualquer campo preenchido no descartado (discardPatient) que o
 * principal não tinha — sem nunca sobrescrever um valor que o principal
 * já possuía. O id final é sempre o do principal.
 */
export function mergePatientRecords(
  keepPatient: PatientRecordForMerge,
  discardPatient: PatientRecordForMerge
): MergeResult {
  const merged: PatientRecordForMerge = { ...keepPatient };
  const fieldsFilledFromDiscarded: string[] = [];

  // Campos que faz sentido herdar do descartado se o principal não tiver
  // — dados cadastrais simples. Deliberadamente NÃO inclui campos de
  // estado operacional (status, stage, urgency, assignedTo, unreadCount)
  // — esses continuam sempre os do principal, para não alterar o estado
  // de atendimento em andamento de forma surpreendente.
  const inheritableFields = ["cpf", "birthDate", "insurance", "planType", "specialty", "phone"];

  for (const field of inheritableFields) {
    const keepValue = merged[field];
    const discardValue = discardPatient[field];
    const keepIsEmpty = keepValue === undefined || keepValue === null || keepValue === "";
    const discardHasValue = discardValue !== undefined && discardValue !== null && discardValue !== "";
    if (keepIsEmpty && discardHasValue) {
      merged[field] = discardValue;
      fieldsFilledFromDiscarded.push(field);
    }
  }

  // Notas internas: concatena em vez de escolher uma — informação
  // registrada por um atendente não deve ser perdida na mesclagem.
  const keepNotes = Array.isArray(merged.internalNotes) ? (merged.internalNotes as string[]) : [];
  const discardNotes = Array.isArray(discardPatient.internalNotes) ? (discardPatient.internalNotes as string[]) : [];
  if (discardNotes.length > 0) {
    merged.internalNotes = [
      ...keepNotes,
      `[Mesclado de paciente duplicado ${discardPatient.id}]`,
      ...discardNotes,
    ];
    fieldsFilledFromDiscarded.push("internalNotes");
  }

  // Tags: união sem duplicatas.
  const keepTags = Array.isArray(merged.tags) ? (merged.tags as string[]) : [];
  const discardTags = Array.isArray(discardPatient.tags) ? (discardPatient.tags as string[]) : [];
  if (discardTags.length > 0) {
    const unionTags = Array.from(new Set([...keepTags, ...discardTags]));
    if (unionTags.length !== keepTags.length) {
      merged.tags = unionTags;
      fieldsFilledFromDiscarded.push("tags");
    }
  }

  return {
    mergedPatient: merged,
    discardedPatientId: discardPatient.id,
    fieldsFilledFromDiscarded,
  };
}
