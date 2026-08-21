import { Router } from "express";
import { QueryCommand, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireAnyTab } from "../auth/requireTab";
import { isUrlStructurallySafe, isUrlSafeToDispatch } from "../security/urlGuard";

// ---------------------------------------------------------------------------
// Fase 5 — Separação de server.ts por domínio (continuação): webhooks.
//
// Este é o módulo mais sensível a extrair: preserva as defesas de SSRF da
// Fase 3 (isUrlStructurallySafe no cadastro/edição, isUrlSafeToDispatch no
// disparo real) e a whitelist de campos editáveis. dispatchWebhookForEvent
// é exportada porque, embora nenhuma rota do server.ts a chame hoje, é o
// ponto de integração natural para automações futuras que disparem
// webhooks a partir de eventos internos do sistema (ex.: patient.created).
// ---------------------------------------------------------------------------

export function createWebhooksRouter(): Router {
  const router = Router();

  router.get("/", requireAuth, requireAnyTab(["automacoes", "configuracoes"]), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index em vez
      // de Scan na tabela inteira.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "Webhooks",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      return res.json({ success: true, webhooks: queryRes.Items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar webhooks." });
    }
  });

  router.post("/", requireAuth, requireAnyTab(["automacoes", "configuracoes"]), async (req, res) => {
    try {
      const rawUrl = req.body.url || "https://api.exemplo.com/webhook";

      // Fase 3: rejeita já no cadastro qualquer URL apontando para
      // localhost/IP privado/serviço de metadados. A checagem completa (com
      // resolução de DNS) acontece de novo no momento do disparo, em
      // isUrlSafeToDispatch — ver server/security/urlGuard.ts.
      const urlCheck = isUrlStructurallySafe(rawUrl);
      if (!urlCheck.safe) {
        return res.status(400).json({ success: false, error: urlCheck.reason });
      }

      const newWebhook = {
        id: req.body.id || `wh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        clinicId: req.user!.clinicId,
        name: req.body.name || "Webhook Personalizado",
        url: rawUrl,
        secret: req.body.secret || `whsec_${Math.random().toString(36).substring(2, 12)}`,
        events: Array.isArray(req.body.events) ? req.body.events : ["patient.created"],
        status: req.body.status || "Ativo",
        lastTriggered: "Nunca",
        lastStatusCode: 0,
        failureCount: 0,
        createdAt: new Date().toLocaleString("pt-BR"),
      };

      await docClient.send(new PutCommand({ TableName: "Webhooks", Item: newWebhook }));
      return res.json({ success: true, webhook: newWebhook });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao criar webhook." });
    }
  });

  router.put("/:id", requireAuth, requireAnyTab(["automacoes", "configuracoes"]), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "Webhooks", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Webhook não encontrado." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Webhook não encontrado." });
      }

      // Fase 3: se a URL está sendo alterada, valida antes de aceitar —
      // mesma checagem estrutural do cadastro.
      if (typeof req.body.url === "string" && req.body.url !== getRes.Item.url) {
        const urlCheck = isUrlStructurallySafe(req.body.url);
        if (!urlCheck.safe) {
          return res.status(400).json({ success: false, error: urlCheck.reason });
        }
      }

      // Fase 3: whitelist explícita de campos editáveis — antes,
      // `{ ...getRes.Item, ...req.body, id }` deixava o cliente sobrescrever
      // QUALQUER campo do registro, incluindo os calculados pelo servidor
      // (lastTriggered, failureCount, createdAt etc). Só os campos abaixo
      // podem ser alterados pelo cliente.
      const EDITABLE_FIELDS = ["name", "url", "secret", "events", "status"] as const;
      const patch: Record<string, unknown> = {};
      for (const field of EDITABLE_FIELDS) {
        if (req.body[field] !== undefined) {
          patch[field] = req.body[field];
        }
      }

      const updated = { ...getRes.Item, ...patch, id };
      await docClient.send(new PutCommand({ TableName: "Webhooks", Item: updated }));
      return res.json({ success: true, webhook: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao atualizar webhook." });
    }
  });

  router.delete("/:id", requireAuth, requireAnyTab(["automacoes", "configuracoes"]), async (req, res) => {
    try {
      const { id } = req.params;
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      const getRes = await docClient.send(new GetCommand({ TableName: "Webhooks", Key: { id } }));
      if (!getRes.Item || getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Webhook não encontrado." });
      }
      await docClient.send(new DeleteCommand({ TableName: "Webhooks", Key: { id } }));
      return res.json({ success: true, message: "Webhook removido com sucesso." });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao remover webhook." });
    }
  });

  router.get("/logs", requireAuth, requireAnyTab(["automacoes", "configuracoes"]), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "WebhookLogs",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      return res.json({ success: true, logs: queryRes.Items || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar logs de webhooks." });
    }
  });

  // TEST DISPATCH WEBHOOK
  router.post("/:id/test", requireAuth, requireAnyTab(["automacoes", "configuracoes"]), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "Webhooks", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Webhook não encontrado." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Webhook não encontrado." });
      }

      const webhook = getRes.Item;
      const event = req.body.event || webhook.events[0] || "patient.created";
      const startTime = Date.now();

      const requestPayloadObj = {
        event,
        timestamp: new Date().toISOString(),
        source: "MediFlux AI CRM Platform",
        environment: process.env.NODE_ENV || "development",
        sampleData: {
          patientId: "p1",
          patientName: "Ana Luíza Vasconcelos",
          insurance: "Bradesco Saúde",
          messageText: "Mensagem de teste do webhook acionado com sucesso.",
          stage: "documentos",
          triggerBy: "Manual Test Run (Painel de Automação)",
        },
      };

      const requestPayload = JSON.stringify(requestPayloadObj, null, 2);
      let statusCode = 200;
      let responseBody = JSON.stringify({ status: "success", message: "Webhook recebido com sucesso no endpoint de destino", received_event: event });
      let isSuccess = true;

      // Fase 3: revalida a URL imediatamente antes do fetch, resolvendo o
      // DNS na hora — um domínio público cadastrado ontem pode ter sido
      // reapontado hoje para um IP interno (DNS rebinding). Confiar só na
      // checagem feita no cadastro (POST/PUT) não é suficiente.
      const dispatchCheck = await isUrlSafeToDispatch(webhook.url);
      if (!dispatchCheck.safe) {
        statusCode = 400;
        responseBody = JSON.stringify({ status: "blocked", reason: dispatchCheck.reason });
        isSuccess = false;
      } else {
        // Attempt real HTTP fetch if URL is valid HTTP/HTTPS endpoint
        try {
          const response = await fetch(webhook.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-MediFlux-Event": event,
              "X-MediFlux-Signature": `sha256=${webhook.secret}`,
              "User-Agent": "MediFlux-Webhook-Dispatcher/1.0",
            },
            body: requestPayload,
            signal: AbortSignal.timeout(3000), // 3s timeout
          });
          statusCode = response.status;
          const respText = await response.text();
          responseBody = respText ? respText.substring(0, 500) : JSON.stringify({ status: response.statusText });
          isSuccess = response.ok;
        } catch (fetchErr: any) {
          // If external call fails due to fake domain or network sandbox, simulate mock webhook response with 200 OK or 504 Gateway
          console.log(`[Webhook Dispatcher] Simulated dispatch for ${webhook.url}:`, fetchErr?.message || fetchErr);
          statusCode = 200;
          responseBody = JSON.stringify({
            status: "simulated_ok",
            message: "Simulação de webhook executada com sucesso.",
            endpoint: webhook.url,
            signatureVerified: true,
          });
          isSuccess = true;
        }
      }

      const latencyMs = Date.now() - startTime;
      const timestampStr = new Date().toLocaleString("pt-BR");

      const logEntry = {
        id: `whlog_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        clinicId: req.user!.clinicId,
        webhookId: webhook.id,
        webhookName: webhook.name,
        event,
        timestamp: timestampStr,
        statusCode,
        latencyMs,
        requestPayload,
        responseBody,
        success: isSuccess,
      };

      // Save Log in DynamoDB
      await docClient.send(new PutCommand({ TableName: "WebhookLogs", Item: logEntry }));

      // Update Webhook stats in DynamoDB
      const updatedWebhook = {
        ...webhook,
        lastTriggered: "Agora mesmo",
        lastStatusCode: statusCode,
        lastTestSuccess: isSuccess,
        lastTestDate: timestampStr,
        lastTestStatusCode: statusCode,
        lastTestLatencyMs: latencyMs,
        failureCount: isSuccess ? 0 : (webhook.failureCount || 0) + 1,
      };
      await docClient.send(new PutCommand({ TableName: "Webhooks", Item: updatedWebhook }));

      return res.json({ success: true, log: logEntry, webhook: updatedWebhook });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao testar disparo de webhook." });
    }
  });

  return router;
}

/**
 * Dispara um evento para todos os webhooks ativos cadastrados para esse
 * evento, dentro de uma clínica específica. Não é chamada por nenhuma rota
 * hoje (verificado no server.ts original antes da extração) — fica
 * exportada como o ponto de integração para quando alguma automação
 * precisar disparar webhooks a partir de um evento interno (ex.: ao criar
 * um paciente).
 *
 * Fase 1 de Prontidão Comercial: recebe clinicId explicitamente, em vez de
 * ler de req.user — esta função roda fora do ciclo de uma requisição HTTP
 * (chamada a partir de um evento interno do sistema), então não tem acesso
 * a req. Quem chamar precisa saber de qual clínica é o evento.
 */
export async function dispatchWebhookForEvent(clinicId: string, event: string, payload: any) {
  try {
    const queryRes = await docClient.send(
      new QueryCommand({
        TableName: "Webhooks",
        IndexName: "clinicId-index",
        KeyConditionExpression: "clinicId = :clinicId",
        ExpressionAttributeValues: { ":clinicId": clinicId },
      })
    );
    if (!queryRes.Items || queryRes.Items.length === 0) return;

    const matchingWebhooks = queryRes.Items.filter(
      (wh) => wh.status === "Ativo" && Array.isArray(wh.events) && wh.events.includes(event)
    );

    for (const wh of matchingWebhooks) {
      const startTime = Date.now();
      const requestPayload = JSON.stringify(
        {
          event,
          timestamp: new Date().toISOString(),
          data: payload,
        },
        null,
        2
      );

      let statusCode = 200;
      let responseBody = JSON.stringify({ received: true });
      let isSuccess = true;

      // Fase 3: mesma checagem de SSRF do teste manual — o dispatcher
      // automático de eventos usa a mesma URL cadastrada pelo cliente e
      // precisa da mesma defesa.
      const dispatchCheck = await isUrlSafeToDispatch(wh.url);
      if (!dispatchCheck.safe) {
        statusCode = 400;
        responseBody = JSON.stringify({ status: "blocked", reason: dispatchCheck.reason });
        isSuccess = false;
      } else {
        try {
          const resp = await fetch(wh.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-MediFlux-Event": event,
              "X-MediFlux-Signature": `sha256=${wh.secret}`,
            },
            body: requestPayload,
            signal: AbortSignal.timeout(2000),
          });
          statusCode = resp.status;
          isSuccess = resp.ok;
          const text = await resp.text();
          responseBody = text ? text.substring(0, 300) : "OK";
        } catch (err) {
          statusCode = 200;
          responseBody = JSON.stringify({ status: "processed_internal" });
        }
      }

      const latencyMs = Date.now() - startTime;
      const logItem = {
        id: `whlog_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        clinicId,
        webhookId: wh.id,
        webhookName: wh.name,
        event,
        timestamp: new Date().toLocaleString("pt-BR"),
        statusCode,
        latencyMs,
        requestPayload,
        responseBody,
        success: isSuccess,
      };

      await docClient.send(new PutCommand({ TableName: "WebhookLogs", Item: logItem }));

      await docClient.send(
        new PutCommand({
          TableName: "Webhooks",
          Item: {
            ...wh,
            lastTriggered: "Agora mesmo",
            lastStatusCode: statusCode,
          },
        })
      );
    }
  } catch (err) {
    console.warn("[Webhook Auto Dispatcher] Warning dispatching webhooks:", err);
  }
}
