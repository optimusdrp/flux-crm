import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";
import { startSession, stopSession, getSessionStatus } from "../whatsapp/sessionManager";

// ---------------------------------------------------------------------------
// Rotas de conexão real com WhatsApp (server/whatsapp/sessionManager.ts).
// Mesma proteção da tela de Configurações — conectar/desconectar equivale
// a dar ou revogar o controle do número de WhatsApp real da clínica, uma
// ação tão sensível quanto editar as credenciais de integração EHR (ver
// server/routes/ehr.ts), por isso a mesma exigência de acesso à tab
// "configuracoes".
// ---------------------------------------------------------------------------

export function createWhatsAppRouter(): Router {
  const router = Router();

  // Inicia a conexão — sobe o Chromium headless e começa a gerar o QR
  // code. Devolve imediatamente com status "initializing"; o front-end
  // consulta GET /status em polling até o QR aparecer (ou a conexão
  // completar, se já havia uma sessão salva válida).
  router.post("/connect", requireAuth, requireTab("configuracoes"), async (req, res) => {
    try {
      const clinicId = req.user!.clinicId;
      const entry = await startSession(clinicId);
      return res.json({ success: true, status: entry.status, qrDataUrl: entry.qrDataUrl });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao iniciar conexão com o WhatsApp." });
    }
  });

  // Consulta de status — o front-end faz polling neste endpoint durante
  // o fluxo de conexão (exibindo o QR, depois "conectando...", depois
  // "conectado"). Leve o suficiente para polling frequente: não toca em
  // nada além de ler o estado em memória do processo.
  router.get("/status", requireAuth, requireTab("configuracoes"), async (req, res) => {
    const clinicId = req.user!.clinicId;
    const status = getSessionStatus(clinicId);
    return res.json({ success: true, ...status });
  });

  // Encerra a conexão — desloga de verdade (não é só "parar de usar"), a
  // próxima conexão exige escanear um QR code novo.
  router.post("/disconnect", requireAuth, requireTab("configuracoes"), async (req, res) => {
    try {
      const clinicId = req.user!.clinicId;
      await stopSession(clinicId);
      return res.json({ success: true, status: "disconnected" });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao desconectar o WhatsApp." });
    }
  });

  return router;
}
