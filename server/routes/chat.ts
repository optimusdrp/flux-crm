import { Router } from "express";
import { QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";

// ---------------------------------------------------------------------------
// Fase 5 — Separação de server.ts por domínio (continuação)
//
// Quarto módulo extraído: mensagens de chat. Preserva a otimização desta
// mesma Fase 5 (Query no GSI patientId-index em vez de Scan+filter).
// ---------------------------------------------------------------------------

export function createChatRouter(): Router {
  const router = Router();

  router.get("/:patientId", requireAuth, requireTab("atendimentos"), async (req, res) => {
    try {
      const { patientId } = req.params;

      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR) —
      // sem isso, qualquer usuário autenticado poderia ler o histórico de
      // chat de um paciente de OUTRA clínica só sabendo o id (o GSI
      // patientId-index, por si só, não impõe esse limite).
      const patientRes = await docClient.send(new GetCommand({ TableName: "Patients", Key: { id: patientId } }));
      if (!patientRes.Item || patientRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }

      // Query no GSI patientId-index em vez de Scan na tabela inteira +
      // filter em memória (ver server/db/dynalite.ts para a definição do
      // índice).
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "ChatMessages",
          IndexName: "patientId-index",
          KeyConditionExpression: "patientId = :pid",
          ExpressionAttributeValues: { ":pid": patientId },
        })
      );
      return res.json({ success: true, messages: queryRes.Items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar mensagens do chat." });
    }
  });

  router.post("/:patientId", requireAuth, requireTab("atendimentos"), async (req, res) => {
    try {
      const { patientId } = req.params;

      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR) —
      // sem isso, seria possível anexar uma mensagem ao histórico de um
      // paciente de outra clínica, e a mensagem nem carregaria clinicId
      // corretamente.
      const patientRes = await docClient.send(new GetCommand({ TableName: "Patients", Key: { id: patientId } }));
      if (!patientRes.Item || patientRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }

      const newMessage = {
        id: req.body.id || `m_${Date.now()}`,
        clinicId: req.user!.clinicId,
        patientId,
        sender: req.body.sender || "attendant",
        senderName: req.body.senderName || "Atendente",
        text: req.body.text || "",
        timestamp: req.body.timestamp || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        attachment: req.body.attachment,
        isInternalComment: req.body.isInternalComment || false,
      };

      await docClient.send(new PutCommand({ TableName: "ChatMessages", Item: newMessage }));

      // Also update lastMessage & lastMessageTime in Patient
      try {
        const updatedPat = {
          ...patientRes.Item,
          lastMessage: newMessage.text,
          lastMessageTime: newMessage.timestamp,
        };
        await docClient.send(new PutCommand({ TableName: "Patients", Item: updatedPat }));
      } catch (patErr) {
        console.warn("[Chat Post] Could not update lastMessage in patient:", patErr);
      }

      return res.json({ success: true, message: newMessage });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao enviar mensagem." });
    }
  });

  return router;
}
