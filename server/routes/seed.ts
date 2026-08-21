import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { requireAdmin } from "../auth/requireTab";
import { seedDatabase } from "../db/seed";

// ---------------------------------------------------------------------------
// Fase 5 — Separação de server.ts por domínio (item pendente concluído)
//
// Rota de repopulação do banco de dados fictício, extraída do server.ts
// principal. Isolada em seu próprio arquivo por ser uma ação administrativa
// de risco elevado (reseta o banco), sem relação direta com os demais
// domínios já extraídos (patients, chat, webhooks...).
//
// Continua restrita ao perfil Administrador (requireAdmin) — essa proteção
// já existia desde a Fase 2 e é preservada aqui sem alteração.
// ---------------------------------------------------------------------------

export function createSeedRouter(): Router {
  const router = Router();

  router.post("/", requireAuth, requireAdmin, async (req, res) => {
    try {
      await seedDatabase(true);
      return res.json({ success: true, message: "Banco de dados Dynalite DynamoDB populado com sucesso!" });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao executar seed." });
    }
  });

  return router;
}
