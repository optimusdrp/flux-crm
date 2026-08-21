import { Router } from "express";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";

// ---------------------------------------------------------------------------
// Implementação real das telas de Configurações que antes eram decorativas
// (só abriam um modal genérico com um campo de texto sem persistência):
// Canais de Atendimento, Campos Obrigatórios e Jornadas & Funis.
//
// As 3 categorias vivem na mesma tabela (ClinicSettings), uma linha por
// categoria — são configurações singleton da clínica, sem necessidade de
// tabelas separadas. Cada categoria é editada e lida independentemente.
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ["channels", "requiredFields", "funnels"] as const;
type SettingsCategory = (typeof VALID_CATEGORIES)[number];

function isValidCategory(value: unknown): value is SettingsCategory {
  return typeof value === "string" && (VALID_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Validação estrutural mínima por categoria — não é uma whitelist de
 * campos como em fieldWhitelists.ts (aqui a entidade inteira é
 * substituída a cada edição, não faz sentido whitelist parcial), mas
 * garante que o formato básico esperado pelo front-end não seja quebrado
 * por um payload malformado.
 */
function validatePayloadShape(category: SettingsCategory, items: unknown): string | null {
  if (!Array.isArray(items)) {
    return "O campo 'items' deve ser uma lista.";
  }

  if (category === "channels") {
    const valid = items.every(
      (i) =>
        i && typeof i.channel === "string" && typeof i.enabled === "boolean" && typeof i.displayName === "string"
    );
    if (!valid) return "Cada canal precisa de 'channel', 'enabled' e 'displayName'.";
  }

  if (category === "requiredFields") {
    const valid = items.every(
      (i) => i && typeof i.stage === "string" && Array.isArray(i.requiredPatientFields) && Array.isArray(i.requiredChecklistItems)
    );
    if (!valid) return "Cada regra precisa de 'stage', 'requiredPatientFields' e 'requiredChecklistItems'.";
  }

  if (category === "funnels") {
    const valid = items.every((i) => i && typeof i.id === "string" && typeof i.name === "string" && Array.isArray(i.stages));
    if (!valid) return "Cada funil precisa de 'id', 'name' e 'stages'.";
  }

  return null;
}

export function createClinicSettingsRouter(): Router {
  const router = Router();

  // Leitura liberada para a área de Configurações — qualquer perfil com
  // acesso a essa tab pode CONSULTAR (ex.: para a tela de Jornadas exibir
  // as colunas do funil corretamente), mas só quem pode editar
  // Configurações pode alterar (ver PUT abaixo).
  router.get("/", requireAuth, requireTab("configuracoes"), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query pela partition key clinicId
      // (a chave da tabela passou a ser composta clinicId+category) — em
      // vez de Scan trazendo as configurações de TODAS as clínicas.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "ClinicSettings",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      const result: Record<string, unknown[]> = {};
      (queryRes.Items || []).forEach((item) => {
        result[item.category] = item.items || [];
      });
      return res.json({ success: true, settings: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar configurações da clínica." });
    }
  });

  // Rota específica de leitura para Jornadas (funis) — liberada também
  // para quem tem acesso à tab "jornadas", já que JornadasView precisa
  // consultar os funis configurados para montar o Kanban, mesmo sem
  // acesso à tela de Configurações.
  router.get("/funnels", requireAuth, async (req, res) => {
    try {
      const getRes = await docClient.send(
        new GetCommand({ TableName: "ClinicSettings", Key: { clinicId: req.user!.clinicId, category: "funnels" } })
      );
      return res.json({ success: true, funnels: getRes.Item?.items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar funis." });
    }
  });

  router.put("/:category", requireAuth, requireTab("configuracoes"), async (req, res) => {
    const { category } = req.params;
    if (!isValidCategory(category)) {
      return res.status(400).json({
        success: false,
        error: `Categoria inválida. Use uma de: ${VALID_CATEGORIES.join(", ")}.`,
      });
    }

    const { items } = req.body;
    const validationError = validatePayloadShape(category, items);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    try {
      const clinicId = req.user!.clinicId;
      await docClient.send(new PutCommand({ TableName: "ClinicSettings", Item: { clinicId, category, items } }));
      return res.json({ success: true, category, items });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao salvar configuração." });
    }
  });

  return router;
}
