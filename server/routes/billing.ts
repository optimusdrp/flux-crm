import { Router } from "express";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { requireAuth } from "../auth/requireAuth";
import { requireInternalOpsKey } from "../auth/requireInternalOps";
import { getClinicSubscription, buildSubscriptionSummary, activatePaymentForClinic, changeClinicPlan, chargeOverageForClinic } from "../billing/subscriptionService";
import { isValidPlanBaseId, isValidFidelityPeriod, PLAN_CATALOG } from "../billing/planCatalog";
import { getClinicUsage, checkAppointmentLimit, currentPeriodKey } from "../billing/usageService";
import { getPaymentProvider } from "../billing/providers";

// ---------------------------------------------------------------------------
// Fase 2 de Prontidão Comercial — Rotas de plano e assinatura
// ---------------------------------------------------------------------------

export function createBillingRouter(): Router {
  const router = Router();

  // Passo 2.2 do plano: endpoint para o próprio Administrador da clínica
  // consultar o plano e os add-ons contratados — a base de uma futura
  // tela de "Minha Assinatura". Qualquer usuário autenticado da clínica
  // pode consultar (não só o Administrador): saber o que está contratado
  // não é uma ação sensível como alterar o que está contratado.
  router.get("/subscription", requireAuth, async (req, res) => {
    try {
      const subscription = await getClinicSubscription(req.user!.clinicId);
      return res.json({ success: true, subscription: buildSubscriptionSummary(subscription) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar assinatura." });
    }
  });

  // Passo 2.3 do plano: cadastro inicial de clínica. Restrito à chave de
  // operação interna (ver server/auth/requireInternalOps.ts) — decisão de
  // produto registrada no Plano de Prontidão Comercial: mudança de plano
  // passa pelo time interno da MediFlux, nunca pela própria clínica
  // cliente. Não é uma tela pública de auto-cadastro.
  router.post("/clinics", requireInternalOpsKey, async (req, res) => {
    try {
      const { id, name, unit, planBase, addOns, fidelityPeriod } = req.body;

      if (!id || typeof id !== "string" || !name || typeof name !== "string") {
        return res.status(400).json({ success: false, error: "Informe id e name da clínica." });
      }

      const existing = await docClient.send(new GetCommand({ TableName: "Clinics", Key: { id } }));
      if (existing.Item) {
        return res.status(409).json({ success: false, error: "Já existe uma clínica com este id." });
      }

      const resolvedPlanBase = isValidPlanBaseId(planBase) ? planBase : "essencial";
      const resolvedFidelity = isValidFidelityPeriod(fidelityPeriod) ? fidelityPeriod : "mensal";
      // addOns não passa por whitelist de valores inválidos silenciosamente
      // descartados aqui — getClinicSubscription() já filtra qualquer add-on
      // desconhecido na leitura, então um valor malformado no cadastro
      // nunca chega a liberar uma funcionalidade que não deveria.
      const resolvedAddOns = Array.isArray(addOns) ? addOns : [];

      const clinicItem = {
        id,
        name,
        unit: typeof unit === "string" ? unit : "",
        createdAt: new Date().toISOString(),
      };
      const subscriptionItem = {
        clinicId: id,
        planBase: resolvedPlanBase,
        addOns: resolvedAddOns,
        fidelityPeriod: resolvedFidelity,
        status: "ativo" as const,
        startedAt: new Date().toISOString(),
      };

      await docClient.send(new PutCommand({ TableName: "Clinics", Item: clinicItem }));
      await docClient.send(new PutCommand({ TableName: "Subscriptions", Item: subscriptionItem }));

      return res.json({
        success: true,
        clinic: clinicItem,
        subscription: buildSubscriptionSummary(await getClinicSubscription(id)),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao cadastrar clínica." });
    }
  });

  // Passo 5.2 do plano: cria o cliente e a assinatura recorrente no
  // provedor de pagamento ativo (ver server/billing/providers/index.ts)
  // para uma clínica já cadastrada. Separada de POST /clinics de
  // propósito — permite recriar/tentar de novo a ativação de pagamento
  // sem duplicar o cadastro da clínica em si (activatePaymentForClinic é
  // idempotente, mas a criação da clínica no Clinics/Subscriptions não
  // deveria acontecer duas vezes). Mesma proteção de POST /clinics:
  // restrito ao time interno, nunca self-service pela própria clínica.
  router.post("/clinics/:id/activate-payment", requireInternalOpsKey, async (req, res) => {
    try {
      const { id } = req.params;
      const clinicRes = await docClient.send(new GetCommand({ TableName: "Clinics", Key: { id } }));
      if (!clinicRes.Item) {
        return res.status(404).json({ success: false, error: "Clínica não encontrada." });
      }

      const subscription = await activatePaymentForClinic(id, clinicRes.Item.name);
      return res.json({ success: true, subscription: buildSubscriptionSummary(subscription) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao ativar pagamento da clínica." });
    }
  });

  // Consulta do catálogo de planos/add-ons — útil tanto para a rota
  // interna de cadastro (conferir os ids válidos) quanto, no futuro, para
  // uma tela de upgrade de plano.
  router.get("/catalog", requireAuth, async (_req, res) => {
    return res.json({ success: true, plans: PLAN_CATALOG });
  });

  // Passo 4.5 do plano: endpoint para a clínica consultar seu próprio
  // consumo do mês corrente — quantos atendimentos já usou do limite do
  // plano, e quantas chamadas de cada add-on de IA já fez. Qualquer
  // usuário autenticado da clínica pode consultar, mesma lógica de
  // GET /subscription acima (ver informação não é uma ação sensível).
  router.get("/usage", requireAuth, async (req, res) => {
    try {
      const clinicId = req.user!.clinicId;
      const periodKey = currentPeriodKey();
      const [usage, subscription] = await Promise.all([
        getClinicUsage(clinicId, periodKey),
        getClinicSubscription(clinicId),
      ]);
      const included = PLAN_CATALOG[subscription.planBase]?.includedAppointmentsPerMonth ?? 0;
      const limitCheck = await checkAppointmentLimit(clinicId, included, periodKey);

      return res.json({
        success: true,
        usage: {
          periodKey,
          appointments: {
            used: limitCheck.appointmentsCount,
            included: limitCheck.includedAppointmentsPerMonth,
            overLimit: limitCheck.overLimit,
            overageCount: limitCheck.overageCount,
          },
          aiCallsByEndpoint: usage.aiCallsByEndpoint,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar uso da clínica." });
    }
  });

  // Passo 5.2 do plano: recebe eventos do provedor de pagamento
  // (pagamento confirmado, falhou, assinatura cancelada) e atualiza o
  // status da clínica em Subscriptions de acordo. Sem requireAuth — o
  // provedor de pagamento não tem um token de sessão MediFlux, a
  // autenticação aqui é inteiramente pela assinatura HMAC do corpo da
  // requisição (ver provider.verifyWebhookSignature). Formato de evento
  // documentado em server/billing/providers/mockProvider.ts; uma
  // implementação real (Stripe/Pagar.me) tem seu próprio formato de
  // payload — o parsing abaixo mudaria junto com o provider escolhido.
  router.post("/webhook", async (req, res) => {
    try {
      const provider = getPaymentProvider();
      const signatureHeader = req.headers["x-payment-signature"];
      const rawBody = req.rawBody || "";

      const signatureValid = provider.verifyWebhookSignature(
        rawBody,
        typeof signatureHeader === "string" ? signatureHeader : undefined
      );
      if (!signatureValid) {
        console.warn("[Billing Webhook] Assinatura inválida ou ausente — requisição rejeitada.");
        return res.status(401).json({ success: false, error: "Assinatura de webhook inválida." });
      }

      const { eventType, clinicId } = req.body || {};
      if (!clinicId || typeof clinicId !== "string") {
        return res.status(400).json({ success: false, error: "Evento sem clinicId — não é possível identificar a assinatura." });
      }

      let newStatus: "ativo" | "inadimplente" | "cancelado" | undefined;
      if (eventType === "payment.succeeded") newStatus = "ativo";
      else if (eventType === "payment.failed") newStatus = "inadimplente";
      else if (eventType === "subscription.cancelled") newStatus = "cancelado";

      if (!newStatus) {
        // Evento reconhecido pelo provedor mas irrelevante para o status
        // da assinatura (ex.: recibo emitido, cartão atualizado) — 200
        // para o provedor não ficar reenviando, sem gravar nada.
        return res.json({ success: true, ignored: true });
      }

      await docClient.send(
        new PutCommand({
          TableName: "Subscriptions",
          Item: { ...(await getClinicSubscription(clinicId)), status: newStatus },
        })
      );

      return res.json({ success: true, clinicId, status: newStatus });
    } catch (err: any) {
      console.error("[Billing Webhook] Erro ao processar evento:", err);
      return res.status(500).json({ success: false, error: err?.message || "Erro ao processar webhook." });
    }
  });

  // Passo 5.3 do plano — upgrade/downgrade de plano e/ou add-ons. Mesma
  // decisão de produto do cadastro inicial (POST /clinics): restrito ao
  // time interno, nunca self-service pela própria clínica.
  router.put("/clinics/:id/plan", requireInternalOpsKey, async (req, res) => {
    try {
      const { id } = req.params;
      const { planBase, addOns } = req.body;

      if (planBase !== undefined && !isValidPlanBaseId(planBase)) {
        return res.status(400).json({ success: false, error: "planBase inválido." });
      }
      if (addOns !== undefined && !Array.isArray(addOns)) {
        return res.status(400).json({ success: false, error: "addOns deve ser uma lista." });
      }

      const updated = await changeClinicPlan(id, { planBase, addOns });
      return res.json({ success: true, subscription: buildSubscriptionSummary(updated) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao alterar plano da clínica." });
    }
  });

  // Passo 5.3 do plano — dispara a cobrança do excedente de atendimentos
  // do mês corrente de uma clínica específica. Pensada para ser chamada
  // por uma rotina agendada (cron/scheduled job) no fechamento do ciclo
  // de cobrança de cada clínica — não existe, neste projeto, um agendador
  // de tarefas em background (fora do escopo de rotas HTTP); esta rota
  // expõe a AÇÃO em si, para ser acionada por um agendador externo (ex.:
  // AWS EventBridge Scheduler chamando este endpoint) ou manualmente pelo
  // time interno enquanto esse agendador não existir.
  router.post("/clinics/:id/charge-overage", requireInternalOpsKey, async (req, res) => {
    try {
      const { id } = req.params;
      const subscription = await getClinicSubscription(id);
      const included = PLAN_CATALOG[subscription.planBase]?.includedAppointmentsPerMonth ?? 0;
      const limitCheck = await checkAppointmentLimit(id, included);

      const result = await chargeOverageForClinic(id, limitCheck.overageCount);
      return res.json({ success: true, ...result, overageCount: limitCheck.overageCount });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao cobrar excedente da clínica." });
    }
  });

  return router;
}
