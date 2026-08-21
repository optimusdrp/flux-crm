import { Router } from "express";
import { QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";
import { pickAllowedFields, AUTOMATION_UPDATE_FIELDS } from "../validation/fieldWhitelists";

// Fase 5 — Separação de server.ts por domínio (continuação): regras de
// automação.

export function createAutomationsRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, requireTab("automacoes"), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index em vez
      // de Scan na tabela inteira.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "AutomationRules",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      return res.json({ success: true, automations: queryRes.Items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar automações." });
    }
  });

  router.post("/", requireAuth, requireTab("automacoes"), async (req, res) => {
    try {
      const safeFields = pickAllowedFields(req.body, AUTOMATION_UPDATE_FIELDS);
      const newAutomation = {
        id: req.body.id || `ar_${Date.now()}`,
        clinicId: req.user!.clinicId,
        name: "Nova Automação",
        trigger: "Gatilho: manual",
        successRate: "100% ativo",
        status: "Ativa",
        ...safeFields,
      };

      await docClient.send(new PutCommand({ TableName: "AutomationRules", Item: newAutomation }));
      return res.json({ success: true, automation: newAutomation });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao criar automação." });
    }
  });

  router.put("/:id", requireAuth, requireTab("automacoes"), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "AutomationRules", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Automação não encontrada." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Automação não encontrada." });
      }
      // Fase 3: whitelist no lugar do merge livre de req.body.
      const safeFields = pickAllowedFields(req.body, AUTOMATION_UPDATE_FIELDS);
      const updated = { ...getRes.Item, ...safeFields, id };
      await docClient.send(new PutCommand({ TableName: "AutomationRules", Item: updated }));
      return res.json({ success: true, automation: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao atualizar automação." });
    }
  });

  return router;
}
