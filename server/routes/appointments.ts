import { Router } from "express";
import { QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";
import { pickAllowedFields, APPOINTMENT_UPDATE_FIELDS } from "../validation/fieldWhitelists";

// Fase 5 — Separação de server.ts por domínio (continuação): agendamentos.

export function createAppointmentsRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, requireTab("atendimentos"), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index em vez
      // de Scan na tabela inteira — antes trazia os agendamentos de TODAS
      // as clínicas, e o front-end via tudo sem filtro nenhum.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "Appointments",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      return res.json({ success: true, appointments: queryRes.Items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar agendamentos." });
    }
  });

  router.post("/", requireAuth, requireTab("atendimentos"), async (req, res) => {
    try {
      const newAppointment = {
        id: req.body.id || `a_${Date.now()}`,
        clinicId: req.user!.clinicId,
        time: req.body.time || "10:00",
        duration: req.body.duration || "30 min",
        patientName: req.body.patientName || "Paciente",
        procedure: req.body.procedure || "Consulta Geral",
        status: req.body.status || "Pendente",
      };

      await docClient.send(new PutCommand({ TableName: "Appointments", Item: newAppointment }));
      return res.json({ success: true, appointment: newAppointment });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao criar agendamento." });
    }
  });

  router.put("/:id", requireAuth, requireTab("atendimentos"), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "Appointments", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Agendamento não encontrado." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR) —
      // sem isso, alguém de outra clínica poderia editar um agendamento
      // só sabendo/adivinhando o id, já que o id em si não é secreto.
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Agendamento não encontrado." });
      }

      // Fase 3: whitelist no lugar do merge livre de req.body.
      const safeFields = pickAllowedFields(req.body, APPOINTMENT_UPDATE_FIELDS);
      const updated = { ...getRes.Item, ...safeFields, id };
      await docClient.send(new PutCommand({ TableName: "Appointments", Item: updated }));
      return res.json({ success: true, appointment: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao atualizar agendamento." });
    }
  });

  return router;
}
