import { Router } from "express";

// ---------------------------------------------------------------------------
// Fase 5 — Separação de server.ts por domínio
//
// Primeiro módulo extraído: telemetria (Sentry). Escolhido por ser o mais
// isolado — não depende de auth, RBAC ou Dynalite, e guarda seu próprio
// estado em memória. Extrair este primeiro minimiza o risco de regressão
// enquanto valida o padrão de divisão (Router do Express) antes de aplicar
// aos módulos com mais dependências cruzadas (patients, chat, etc).
//
// Fase 1 de Prontidão Comercial — nota de escopo: esta rota NÃO recebeu
// clinicId nem checagem de propriedade. Os eventos aqui são telemetria de
// operação do servidor (erros de infraestrutura, não dados de negócio de
// uma clínica cliente) e vivem em memória do processo, não numa tabela do
// banco — não se encaixam no mesmo modelo de isolamento por clínica das
// demais rotas. Ela também nunca teve `requireAuth`, o que é uma lacuna de
// segurança pré-existente e separada (qualquer um pode ler/escrever
// eventos de telemetria sem estar logado) — isso fica registrado aqui
// para não ser confundido com "já resolvido" só porque as demais rotas
// foram migradas nesta mesma fase; corrigir isso é trabalho à parte, de
// segurança geral, não de multi-tenancy.
// ---------------------------------------------------------------------------

interface ServerTelemetryEvent {
  id: string;
  timestamp: string;
  type: string;
  severity: string;
  message: string;
  email?: string;
  breadcrumbs?: any[];
  context?: any;
  stackTrace?: string;
  serverLoggedAt: string;
}

export function createTelemetryRouter(port: number): Router {
  const router = Router();

  let serverTelemetryEvents: ServerTelemetryEvent[] = [
    {
      id: "sent_init_001",
      timestamp: new Date().toLocaleString("pt-BR"),
      type: "SENTRY_INIT",
      severity: "info",
      message: "Sentry Telemetry Monitor iniciado no servidor Node.js/Express com Dynalite DynamoDB.",
      email: "system@mediflux.com.br",
      breadcrumbs: [{ timestamp: "00:00:00", category: "system", message: "Sentry SDK backend hook attached" }],
      context: { environment: process.env.NODE_ENV || "development", port },
      serverLoggedAt: new Date().toISOString(),
    },
  ];

  router.get("/errors", (req, res) => {
    return res.json({ success: true, events: serverTelemetryEvents });
  });

  router.post("/errors", (req, res) => {
    const event = req.body;
    if (!event || !event.message) {
      return res.status(400).json({ success: false, error: "Evento de erro inválido." });
    }

    const serverEvent: ServerTelemetryEvent = {
      ...event,
      id: event.id || `sent_srv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      serverLoggedAt: new Date().toISOString(),
    };

    serverTelemetryEvents.unshift(serverEvent);
    if (serverTelemetryEvents.length > 100) {
      serverTelemetryEvents = serverTelemetryEvents.slice(0, 100);
    }

    console.error(`[SENTRY TELEMETRY LOG] [${serverEvent.severity.toUpperCase()}] ${serverEvent.message}`, serverEvent.context);

    return res.json({ success: true, eventId: serverEvent.id });
  });

  router.post("/test-error", (req, res) => {
    const testException = new Error("Simulated Sentry Exception: Test Error Stream Event");
    const eventId = `sent_test_${Date.now()}`;

    const serverEvent: ServerTelemetryEvent = {
      id: eventId,
      timestamp: new Date().toLocaleString("pt-BR"),
      type: "EXCEPTION",
      severity: "error",
      message: testException.message,
      email: req.body?.email || "admin@clinicasantahelena.com.br",
      stackTrace: testException.stack,
      breadcrumbs: [
        { timestamp: new Date().toLocaleTimeString("pt-BR"), category: "test", message: "User clicked Trigger Sentry Test Error button" },
      ],
      context: { triggerBy: "Admin Telemetry Panel", environment: process.env.NODE_ENV || "development" },
      serverLoggedAt: new Date().toISOString(),
    };

    serverTelemetryEvents.unshift(serverEvent);
    return res.json({ success: true, eventId, event: serverEvent });
  });

  return router;
}
