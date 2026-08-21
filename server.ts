import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import dotenv from "dotenv";
import { initDynaliteDatabase, getDbMode } from "./server/db/dynalite";
import { seedDatabase } from "./server/db/seed";
import { isUsingInsecureDevSecret } from "./server/auth/authService";
import { createGeminiProvider } from "./server/ai/providers/gemini.provider";
import { createBedrockProvider } from "./server/ai/providers/bedrock.provider";
import { createAiRouter } from "./server/ai/router";
import { createTelemetryRouter } from "./server/routes/telemetry";
import { createAuthRouter } from "./server/routes/auth";
import { createPatientsRouter } from "./server/routes/patients";
import { createChatRouter } from "./server/routes/chat";
import { createAppointmentsRouter } from "./server/routes/appointments";
import { createPriorityRulesRouter } from "./server/routes/priorityRules";
import { createAutomationsRouter } from "./server/routes/automations";
import { createEhrIntegrationsRouter, createEhrRecordRouter } from "./server/routes/ehr";
import { createWebhooksRouter } from "./server/routes/webhooks";
import { createAuditLogsRouter } from "./server/routes/auditLogs";
import { createSentimentAnalysisRouter } from "./server/routes/sentimentAnalysis";
import { createSeedRouter } from "./server/routes/seed";
import { createClinicSettingsRouter } from "./server/routes/clinicSettings";
import { createAiClinicalRouter } from "./server/routes/aiClinical";
import { createBillingRouter } from "./server/routes/billing";
import { createWhatsAppRouter } from "./server/routes/whatsappConnection";

dotenv.config();

// Fase 1: falha alto (não só warning) se rodando em produção sem um
// JWT_SECRET próprio. Em dev, seguimos com o fallback inseguro só para não
// travar o primeiro `npm run dev` de quem acabou de clonar o repo.
if (process.env.NODE_ENV === "production" && isUsingInsecureDevSecret()) {
  console.error(
    "[FATAL] JWT_SECRET não definido em produção. Configure a variável de ambiente antes de iniciar o servidor."
  );
  process.exit(1);
}

const app = express();
const PORT = 3000;

// Fase 5 de Prontidão Comercial: estende o Request do Express com
// rawBody, capturado pelo verify() de express.json() logo abaixo — mesmo
// padrão de declare global já usado para req.user em
// server/auth/requireAuth.ts.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

// Fase 5 de Prontidão Comercial: captura o corpo bruto da requisição em
// req.rawBody ANTES do parsing para JSON — necessário para validar a
// assinatura HMAC de webhooks do provedor de pagamento (ver
// server/routes/billing.ts, POST /webhook). Validar a assinatura contra
// o JSON já reserializado por express.json() é frágil (reserialização
// pode não bater byte a byte com o que o provedor assinou — ordem de
// chaves, espaçamento); capturar o raw body no momento do parsing é a
// forma correta e é o único lugar em que ele ainda está disponível.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf.toString("utf8");
    },
  })
);

// Fase 5: rotas de telemetria vivem em server/routes/telemetry.ts — mesmo
// prefixo e comportamento de antes, só reorganizado por domínio.
app.use("/api/telemetry", createTelemetryRouter(PORT));

// Fase 5: rotas de auth vivem em server/routes/auth.ts.
app.use("/api/auth", createAuthRouter());

// Fase 5: rotas de pacientes vivem em server/routes/patients.ts.
app.use("/api/patients", createPatientsRouter());

// Fase 5: rotas de chat vivem em server/routes/chat.ts.
app.use("/api/chat", createChatRouter());

// Fase 5: agendamentos, regras de prioridade, automações e EHR.
app.use("/api/appointments", createAppointmentsRouter());
app.use("/api/priority-rules", createPriorityRulesRouter());
app.use("/api/automations", createAutomationsRouter());
app.use("/api/ehr-integrations", createEhrIntegrationsRouter());
app.use("/api/ehr", createEhrRecordRouter());

// Fase 5: rotas de webhooks — esta montagem estava faltando (o router já
// existia em server/routes/webhooks.ts mas nunca tinha sido conectado, o
// que deixaria /api/webhooks/* inacessível — corrigido aqui).
app.use("/api/webhooks", createWebhooksRouter());

// Fase 5: rota de seed vive em server/routes/seed.ts.
app.use("/api/seed", createSeedRouter());
app.use("/api/clinic-settings", createClinicSettingsRouter());
// Fase 2 de Prontidão Comercial: rotas de plano e assinatura.
app.use("/api/billing", createBillingRouter());
app.use("/api/whatsapp", createWhatsAppRouter());

// Initialize Google GenAI on the server
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Initialize Amazon Bedrock (Claude) on the server — segunda IA do projeto,
// usada como principal na triagem clínica e como reserva do Gemini nos
// demais endpoints de IA (ver server/ai/router.ts).
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
});

const geminiProvider = createGeminiProvider(ai);
const bedrockProvider = createBedrockProvider(bedrockClient);
const aiRouter = createAiRouter({ gemini: geminiProvider, bedrock: bedrockProvider });

// Fase 1: o antigo USER_DIRECTORY (nome, role, unit, password em texto
// puro) foi removido. Usuários agora vivem na tabela Dynalite "Users",
// populada por server/db/seed.ts com senha já hasheada (bcrypt). Ver
// server/auth/authService.ts para hash/verificação e emissão de JWT.

// Fase 5: rotas de telemetria extraídas para server/routes/telemetry.ts —
// montadas logo abaixo, via app.use("/api/telemetry", createTelemetryRouter(PORT)).

// Fase 5: rota de seed extraída para server/routes/seed.ts — montada via
// app.use("/api/seed", createSeedRouter()).

// Fase 5: rotas de auth (login/logout/permissions) extraídas para
// server/routes/auth.ts — montadas logo abaixo, via
// app.use("/api/auth", createAuthRouter()).

// Fase 5: rotas de pacientes extraídas para server/routes/patients.ts —
// montadas via app.use("/api/patients", createPatientsRouter()).

// Fase 5: rotas de chat extraídas para server/routes/chat.ts — montadas
// via app.use("/api/chat", createChatRouter()).

// Fase 5: rotas de agendamentos, regras de prioridade, automações e EHR
// extraídas para server/routes/{appointments,priorityRules,automations,ehr}.ts
// — montadas acima. Webhooks também extraído (server/routes/webhooks.ts),
// montado junto dos demais no topo do arquivo.

// Fase 5: rotas de sentiment-analysis extraídas para
// server/routes/sentimentAnalysis.ts — depende do aiRouter (Gemini +
// Bedrock) instanciado acima, por isso é montada aqui (não no topo do
// arquivo, junto dos demais routers que não têm essa dependência).
app.use("/api/ai/sentiment-analysis", createSentimentAnalysisRouter(aiRouter));

// Fase 5: rotas de audit-logs extraídas para server/routes/auditLogs.ts.
app.use("/api/audit-logs", createAuditLogsRouter());

// Fase 5: os três endpoints de IA de triagem/qualificação (analyze-message,
// ai/auto-tag, ai/qualify-lead) foram extraídos para
// server/routes/aiClinical.ts — dependem do aiRouter (Gemini + Bedrock)
// instanciado acima, por isso são montados aqui.
app.use("/api", createAiClinicalRouter(aiRouter));

async function startServer() {
  // Fase 6: em DB_MODE=dynalite (padrão, usado durante os testes), o
  // comportamento é idêntico ao de sempre — sobe o Dynalite local e roda o
  // seed automático. Em DB_MODE=dynamodb (produção real), initDynaliteDatabase
  // não faz nada (ver server/db/dynalite.ts) e o seed automático é
  // deliberadamente pulado: popular produção com os pacientes fictícios do
  // seed a cada boot do servidor seria um bug grave, não um recurso. Se um
  // reseed for necessário em DynamoDB real, é uma ação explícita via
  // POST /api/seed (já restrita a Administrador desde a Fase 2).
  try {
    await initDynaliteDatabase();
    if (getDbMode() === "dynalite") {
      await seedDatabase(false);
    } else {
      console.log("[Server Start] DB_MODE=dynamodb — seed automático pulado (use POST /api/seed manualmente se necessário).");
    }
  } catch (dbErr) {
    console.error("[Server Start] Error initializing database:", dbErr);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

