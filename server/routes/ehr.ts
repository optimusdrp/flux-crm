import { Router } from "express";
import { QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";
import { pickAllowedFields, EHR_INTEGRATION_UPDATE_FIELDS } from "../validation/fieldWhitelists";

// Fase 5 — Separação de server.ts por domínio (continuação): EHR
// (Prontuário Eletrônico). Dois routers porque os prefixos de rota
// originais são diferentes (/api/ehr-integrations vs /api/ehr/record).

export function createEhrIntegrationsRouter(): Router {
  const router = Router();

  // Item revisado (implementação real da tela de Integrações): antes só
  // devolvia id/name/status/lastSync/recordsCount — a tela mostrava o
  // status decorativo mas não permitia configurar nada de fato. Agora
  // devolve também `config` (endpoint, direção/frequência de sync,
  // entidades sincronizadas, config TISS/TUSS), mas NUNCA a credencial em
  // texto puro — só um indicador booleano (credentialSet) e os últimos 4
  // caracteres, suficiente para o usuário confirmar visualmente qual
  // chave está configurada sem expor o segredo pela rede outra vez.
  router.get("/", requireAuth, requireTab("configuracoes"), async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: Query no GSI clinicId-index em vez
      // de Scan na tabela inteira.
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: "EHRIntegrations",
          IndexName: "clinicId-index",
          KeyConditionExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": req.user!.clinicId },
        })
      );
      const integrations = (queryRes.Items || []).map(stripSecretFromIntegration);
      return res.json({ success: true, integrations });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar integrações EHR." });
    }
  });

  router.put("/:id", requireAuth, requireTab("configuracoes"), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "EHRIntegrations", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Integração EHR não encontrada." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Integração EHR não encontrada." });
      }

      // Fase 3: whitelist no lugar do merge livre de req.body. `config` é
      // aceito aqui, mas sanitizado abaixo para nunca gravar uma
      // credencial vinda deste endpoint — isso só acontece pela rota
      // dedicada PUT /:id/credentials, que fica no log de auditoria com
      // um rótulo próprio.
      const safeFields = pickAllowedFields(req.body, EHR_INTEGRATION_UPDATE_FIELDS);
      if (safeFields.config && typeof safeFields.config === "object") {
        const { credentialSet, credentialLast4, ...restConfig } = safeFields.config as Record<string, unknown>;
        safeFields.config = {
          ...(getRes.Item.config || {}),
          ...restConfig,
          // Preserva o estado de credencial já salvo — este endpoint nunca
          // altera credencial, mesmo se o corpo da requisição tentar.
          credentialSet: getRes.Item.config?.credentialSet ?? false,
          credentialLast4: getRes.Item.config?.credentialLast4 ?? "",
        };
      }

      const updated = { ...getRes.Item, ...safeFields, id };
      await docClient.send(new PutCommand({ TableName: "EHRIntegrations", Item: updated }));
      return res.json({ success: true, integration: stripSecretFromIntegration(updated) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao atualizar integração EHR." });
    }
  });

  // Rota dedicada para definir/trocar a credencial de uma integração —
  // separada do PUT geral de propósito: nunca aparece no corpo de uma
  // edição de rotina (evita vazar a chave em logs de requisição comuns),
  // e o registro de auditoria pode identificar especificamente "credencial
  // alterada" sem descrever o valor.
  router.put("/:id/credentials", requireAuth, requireTab("configuracoes"), async (req, res) => {
    try {
      const { id } = req.params;
      const { apiKey } = req.body;

      if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 8) {
        return res.status(400).json({
          success: false,
          error: "Informe uma credencial válida (mínimo 8 caracteres).",
        });
      }

      const getRes = await docClient.send(new GetCommand({ TableName: "EHRIntegrations", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Integração EHR não encontrada." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR) —
      // crítico aqui em especial, já que esta rota altera credencial.
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Integração EHR não encontrada." });
      }

      // A credencial em si nunca é persistida em texto puro utilizável
      // por esta demo — só o indicador de que foi configurada e os
      // últimos 4 caracteres (para o usuário reconhecer visualmente qual
      // chave está em uso). Um ambiente de produção real armazenaria isso
      // num cofre de segredos dedicado (AWS Secrets Manager / KMS), não
      // numa tabela de aplicação — fora do escopo desta implementação.
      const trimmed = apiKey.trim();
      const updatedConfig = {
        ...(getRes.Item.config || {}),
        credentialSet: true,
        credentialLast4: trimmed.slice(-4),
      };
      const updated = { ...getRes.Item, config: updatedConfig, id };
      await docClient.send(new PutCommand({ TableName: "EHRIntegrations", Item: updated }));

      return res.json({ success: true, integration: stripSecretFromIntegration(updated) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao atualizar credencial." });
    }
  });

  // Dispara uma sincronização manual imediata — simulada nesta demo (sem
  // um sistema EHR real do outro lado), mas segue o mesmo contrato que
  // uma integração real teria: atualiza lastSync e recordsCount.
  router.post("/:id/sync", requireAuth, requireTab("configuracoes"), async (req, res) => {
    try {
      const { id } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "EHRIntegrations", Key: { id } }));
      if (!getRes.Item) {
        return res.status(404).json({ success: false, error: "Integração EHR não encontrada." });
      }
      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR).
      if (getRes.Item.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Integração EHR não encontrada." });
      }

      if (!getRes.Item.config?.credentialSet) {
        return res.status(400).json({
          success: false,
          error: "Configure a credencial de acesso antes de sincronizar.",
        });
      }

      const updated = {
        ...getRes.Item,
        status: "Conectado",
        lastSync: "Agora mesmo",
        recordsCount: (getRes.Item.recordsCount || 0) + Math.floor(Math.random() * 5),
      };
      await docClient.send(new PutCommand({ TableName: "EHRIntegrations", Item: updated }));
      return res.json({ success: true, integration: stripSecretFromIntegration(updated) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao sincronizar." });
    }
  });

  return router;
}

/** Remove qualquer campo de credencial em texto puro antes de devolver ao cliente — defesa em profundidade, mesmo que nunca devêssemos gravar isso. */
function stripSecretFromIntegration(item: Record<string, any>) {
  if (!item.config) return item;
  const { apiKey, secret, ...restConfig } = item.config;
  return { ...item, config: restConfig };
}

export function createEhrRecordRouter(): Router {
  const router = Router();

  router.get("/record/:patientId", requireAuth, requireTab("visao-geral"), async (req, res) => {
    try {
      const { patientId } = req.params;
      const getRes = await docClient.send(new GetCommand({ TableName: "Patients", Key: { id: patientId } }));
      const patient = getRes.Item;

      // Fase 1 de Prontidão Comercial: checagem de propriedade (IDOR) —
      // um paciente de outra clínica é tratado exatamente como "não
      // encontrado", nunca revelando que o ID existe em outra clínica.
      if (patient && patient.clinicId !== req.user!.clinicId) {
        return res.status(404).json({ success: false, error: "Paciente não encontrado." });
      }

      if (!patient) {
        // Fallback response with simulated record for newly created appointments
        return res.json({
          success: true,
          ehrRecord: {
            recordId: `PEP-2025-${Math.floor(1000 + Math.random() * 9000)}`,
            patientName: "Paciente Agendado",
            system: "iClinic / Feegow (API Rest Sync)",
            status: "Ficha clínica sincronizada",
            syncedAt: new Date().toLocaleTimeString("pt-BR"),
            summary: "Anamnese inicial e histórico de consultas pronto para atendimento.",
          },
        });
      }

      return res.json({
        success: true,
        ehrRecord: {
          recordId: patient.ehrRecordId || `PEP-2025-${Math.floor(1000 + Math.random() * 9000)}`,
          patientName: patient.name,
          cpf: patient.cpf || "123.456.789-00",
          insurance: patient.insurance || "Particular",
          system: patient.ehrSystem || "iClinic",
          status: "Ficha clínica pronta para atendimento",
          syncedAt: new Date().toLocaleTimeString("pt-BR"),
          summary: `Prontuário integrado via API (${patient.ehrSystem || "EHR"}). Histórico de ${patient.checklist?.length || 3} procedimentos concluídos.`,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao consultar API de prontuário eletrônico." });
    }
  });

  return router;
}
