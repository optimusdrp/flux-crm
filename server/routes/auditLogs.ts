import { Router } from "express";
import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";

// Fase 5 — Separação de server.ts por domínio (continuação): logs de
// auditoria (aba Auditoria LGPD).

export function createAuditLogsRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, requireTab("auditoria"), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index — antes
      // um Scan trazia os logs de auditoria de TODAS as clínicas, o que é
      // especialmente grave numa tela que existe justamente para
      // conformidade e proteção de dados sensíveis.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "AuditLogs",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      return res.json({ success: true, logs: queryRes.Items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar logs de auditoria." });
    }
  });

  router.post("/", requireAuth, requireTab("auditoria"), async (req, res) => {
    try {
      // Fase 2: "user" e "role" vêm do token verificado (req.user), nunca
      // do body enviado pelo cliente — antes, req.body.user/role eram
      // aceitos como texto livre e qualquer requisição podia registrar um
      // log de auditoria atribuído a outra pessoa. "encryptionMethod"
      // também deixou de ser um campo arbitrário do cliente: era só um
      // rótulo decorativo, não representava criptografia real.
      const newLog = {
        id: req.body.id || `log-${Date.now()}`,
        clinicId: req.user!.clinicId,
        timestamp: req.body.timestamp || new Date().toLocaleString("pt-BR"),
        user: req.user!.email,
        role: req.user!.role,
        action: req.body.action || "Ação registrada",
        patientName: req.body.patientName || "N/A",
        recordId: req.body.recordId || "N/A",
        ipAddress: req.ip || "desconhecido",
        status: req.body.status || "Autorizado",
      };

      await docClient.send(new PutCommand({ TableName: "AuditLogs", Item: newLog }));
      return res.json({ success: true, log: newLog });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao criar log de auditoria." });
    }
  });

  return router;
}
