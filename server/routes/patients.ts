import { Router } from "express";
import { QueryCommand, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireAnyTab, requireAction } from "../auth/requireTab";
import { pickAllowedFields, PATIENT_CREATE_FIELDS, PATIENT_UPDATE_FIELDS } from "../validation/fieldWhitelists";
import { findDuplicateCandidates } from "../patients/duplicateDetection";
import { mergePatientRecords } from "../patients/mergePatients";
import { recordAppointmentUsage, checkAppointmentLimit } from "../billing/usageService";
import { getClinicSubscription } from "../billing/subscriptionService";
import { PLAN_CATALOG } from "../billing/planCatalog";

// ---------------------------------------------------------------------------
// Fase 5 — Separação de server.ts por domínio (continuação)
//
// Terceiro módulo extraído: pacientes. Mesmo comportamento de antes,
// incluindo as proteções das Fases 2 e 3 (RBAC por tab, whitelist de
// campos editáveis).
// ---------------------------------------------------------------------------

export function createPatientsRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, requireAnyTab(["atendimentos", "jornadas"]), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index em vez
      // de Scan na tabela inteira — a lista de pacientes é o caso mais
      // grave de vazamento entre clínicas se deixado sem filtro.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "Patients",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      return res.json({ success: true, patients: queryRes.Items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar pacientes." });
    }
  });

  // Item revisado: detecção de pacientes potencialmente duplicados, para
  // a tela de unificação. Precisa vir ANTES de GET /:id na ordem de
  // registro das rotas — senão o Express trataria "duplicates" como um
  // valor de :id.
  //
  // Mesma permissão da mesclagem em si (patients.merge): não faz sentido
  // deixar alguém ver a lista de candidatos a duplicata sem também poder
  // agir sobre ela.
  router.get("/duplicates", requireAuth, requireAction("patients.merge"), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index — a
      // comparação de duplicados PRECISA ficar restrita à mesma clínica;
      // um Scan sem filtro compararia pacientes de clínicas diferentes
      // entre si, o que não faz sentido e vazaria dados de uma clínica
      // para outra através dos "candidatos a duplicata".
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "Patients",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      const patients = queryRes.Items || [];
      const candidates = findDuplicateCandidates(
        patients.map((p) => ({ id: p.id, name: p.name, phone: p.phone, cpf: p.cpf }))
      );

      // Anexa os dados completos dos dois pacientes de cada par, para a
      // tela não precisar de uma segunda chamada por candidato.
      const patientsById = new Map(patients.map((p) => [p.id, p]));
      const enrichedCandidates = candidates
        .map((c) => ({
          ...c,
          patientA: patientsById.get(c.patientA),
          patientB: patientsById.get(c.patientB),
        }))
        .filter((c) => c.patientA && c.patientB);

      return res.json({ success: true, candidates: enrichedCandidates });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar pacientes duplicados." });
    }
  });

  router.get("/:id", requireAuth, requireAnyTab(["atendimentos", "jornadas"]), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "Patients", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }
      return res.json({ success: true, patient: getRes.Item });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar paciente." });
    }
  });

  router.post("/", requireAuth, requireAnyTab(["atendimentos", "jornadas"]), async (req, res) => {
    try {
      // Fase 3: whitelist PATIENT_CREATE_FIELDS — antes, o spread livre de
      // req.body deixava o cliente sobrescrever qualquer campo, incluindo
      // os controlados pelo servidor (lastMessageTime, unreadCount).
      const safeFields = pickAllowedFields(req.body, PATIENT_CREATE_FIELDS);

      const newPatient = {
        id: req.body.id || `p_${Date.now()}`,
        clinicId: req.user!.clinicId,
        name: "Novo Paciente",
        phone: "(11) 90000-0000",
        insurance: "Particular",
        status: "pendente",
        stage: "triagem",
        urgency: "media",
        lastMessage: "Novo atendimento iniciado.",
        lastMessageTime: "Agora",
        unreadCount: 0,
        assignedTo: "Camila",
        channel: "WhatsApp",
        checklist: [],
        internalNotes: [],
        ...safeFields,
      };

      await docClient.send(new PutCommand({ TableName: "Patients", Item: newPatient }));

      // Fase 4 de Prontidão Comercial: um novo paciente conta como um
      // atendimento novo para efeito de uso/faturamento — "melhor
      // esforço", nunca bloqueia a resposta.
      recordAppointmentUsage(req.user!.clinicId);

      // Sinaliza excedente na resposta (não bloqueia a criação — o
      // documento comercial promete "excedente cobrado à parte", nunca
      // corte de atendimento). O cliente pode usar isso para alertar a
      // recepção que o plano está no limite, sem impedir o atendimento.
      let usageWarning: { overLimit: boolean; appointmentsCount: number; includedAppointmentsPerMonth: number } | undefined;
      try {
        const subscription = await getClinicSubscription(req.user!.clinicId);
        const included = PLAN_CATALOG[subscription.planBase]?.includedAppointmentsPerMonth ?? 0;
        const limitCheck = await checkAppointmentLimit(req.user!.clinicId, included);
        if (limitCheck.overLimit) {
          usageWarning = {
            overLimit: true,
            appointmentsCount: limitCheck.appointmentsCount,
            includedAppointmentsPerMonth: limitCheck.includedAppointmentsPerMonth,
          };
        }
      } catch (e) {
        console.warn("[Patients] Falha ao checar limite de uso (não bloqueante):", e);
      }

      return res.json({ success: true, patient: newPatient, ...(usageWarning ? { usageWarning } : {}) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao criar paciente." });
    }
  });

  router.put("/:id", requireAuth, requireAnyTab(["atendimentos", "jornadas"]), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "Patients", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }

      // Fase 3: whitelist PATIENT_UPDATE_FIELDS no lugar do merge livre
      // `{ ...getRes.Item, ...req.body, id }`.
      const safeFields = pickAllowedFields(req.body, PATIENT_UPDATE_FIELDS);
      const updatedPatient = { ...getRes.Item, ...safeFields, id };
      await docClient.send(new PutCommand({ TableName: "Patients", Item: updatedPatient }));
      return res.json({ success: true, patient: updatedPatient });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao atualizar paciente." });
    }
  });

  // Item revisado: exclusão de paciente deixou de ser restrita
  // categoricamente ao Administrador (via requireAdmin, e antes disso via
  // requireTab("configuracoes"), que nem tinha relação real com a ação).
  // Agora usa requireAction("patients.delete") — concedível por perfil na
  // tela de Configurações. Administrador continua tendo a ação sempre,
  // por definição (requireAction libera esse perfil automaticamente);
  // qualquer outro perfil só a executa se um Administrador conceder.
  router.delete("/:id", requireAuth, requireAction("patients.delete"), async (req, res) => {
    try {
      const { id } = req.params;
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR) —
      // sem isso, qualquer clínica com a ação concedida poderia excluir
      // um paciente de OUTRA clínica só sabendo o id.
      const getRes = await docClient.send(new GetCommand({ TableName: "Patients", Key: { id } }));
      if (!getRes.Item || getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }
      await docClient.send(new DeleteCommand({ TableName: "Patients", Key: { id } }));
      return res.json({ success: true, message: "Paciente removido com sucesso." });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao remover paciente." });
    }
  });

  // Item revisado: unificação de pacientes duplicados. O corpo da
  // requisição precisa informar explicitamente qual dos dois pacientes é
  // o principal (keepPatientId) — a escolha é sempre do usuário, feita na
  // tela de detecção de duplicados (GET /duplicates); esta rota nunca
  // decide sozinha qual registro prevalece.
  router.post("/:id/merge", requireAuth, requireAction("patients.merge"), async (req, res) => {
    try {
      const { id } = req.params; // um dos dois pacientes do par (ver rota /duplicates)
      const { otherPatientId, keepPatientId } = req.body;

      if (!otherPatientId || typeof otherPatientId !== "string") {
        return res.status(400).json({ success: false, error: "Informe o outro paciente do par (otherPatientId)." });
      }
      if (!keepPatientId || (keepPatientId !== id && keepPatientId !== otherPatientId)) {
        return res.status(400).json({
          success: false,
          error: "Informe keepPatientId igual a um dos dois pacientes do par — a escolha de qual registro manter é sempre explícita.",
        });
      }

      const discardPatientId = keepPatientId === id ? otherPatientId : id;

      const [keepRes, discardRes] = await Promise.all([
        docClient.send(new GetCommand({ TableName: "Patients", Key: { id: keepPatientId } })),
        docClient.send(new GetCommand({ TableName: "Patients", Key: { id: discardPatientId } })),
      ]);

      if (!keepRes.Item || !discardRes.Item) {
        return res.status(404).json({ success: false, error: "Um dos dois pacientes do par não foi encontrado." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR) —
      // os dois pacientes do par precisam pertencer à clínica do usuário;
      // sem isso, alguém poderia "unificar" um paciente próprio com um
      // paciente de outra clínica, misturando dados entre clientes.
      if (keepRes.Item.clinicId !== req.user!.clinicId || discardRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Um dos dois pacientes do par não foi encontrado." });
      }

      const { mergedPatient, fieldsFilledFromDiscarded } = mergePatientRecords(
        keepRes.Item as any,
        discardRes.Item as any
      );

      // Reatribui as mensagens de chat do paciente descartado para o
      // principal — ChatMessages referencia patientId de verdade (ao
      // contrário de Appointments, que só guarda patientName em texto
      // livre; ver o aviso de limitação em server/patients/mergePatients.ts).
      const chatQueryRes = await docClient.send(
        new QueryCommand({
          TableName: "ChatMessages",
          IndexName: "patientId-index",
          KeyConditionExpression: "patientId = :pid",
          ExpressionAttributeValues: { ":pid": discardPatientId },
        })
      );
      const messagesToReassign = chatQueryRes.Items || [];
      for (const msg of messagesToReassign) {
        await docClient.send(new PutCommand({ TableName: "ChatMessages", Item: { ...msg, patientId: keepPatientId } }));
      }

      await docClient.send(new PutCommand({ TableName: "Patients", Item: mergedPatient }));
      await docClient.send(new DeleteCommand({ TableName: "Patients", Key: { id: discardPatientId } }));

      return res.json({
        success: true,
        patient: mergedPatient,
        discardedPatientId: discardPatientId,
        fieldsFilledFromDiscarded,
        chatMessagesReassigned: messagesToReassign.length,
        note: "Agendamentos do paciente descartado (se houver) não são reatribuídos automaticamente — a tabela de agendamentos não referencia o paciente por ID. Revise manualmente se necessário.",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao unificar pacientes." });
    }
  });

  return router;
}
