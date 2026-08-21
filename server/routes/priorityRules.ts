import { Router } from "express";
import { QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";
import { pickAllowedFields, PRIORITY_RULE_UPDATE_FIELDS } from "../validation/fieldWhitelists";

// Fase 5 — Separação de server.ts por domínio (continuação): regras de
// prioridade (aba Pendências).

export function createPriorityRulesRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, requireTab("pendencias"), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index em vez
      // de Scan na tabela inteira.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "PriorityRules",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      return res.json({ success: true, rules: queryRes.Items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar regras de prioridade." });
    }
  });

  router.put("/:id", requireAuth, requireTab("pendencias"), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "PriorityRules", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Regra de prioridade não encontrada." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Regra de prioridade não encontrada." });
      }
      // Fase 3: whitelist no lugar do merge livre de req.body.
      const safeFields = pickAllowedFields(req.body, PRIORITY_RULE_UPDATE_FIELDS);
      const updated = { ...getRes.Item, ...safeFields, id };
      await docClient.send(new PutCommand({ TableName: "PriorityRules", Item: updated }));
      return res.json({ success: true, rule: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao atualizar regra." });
    }
  });

  return router;
}
