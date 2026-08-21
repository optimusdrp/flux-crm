import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import {
  AddOnId,
  PlanBaseId,
  FidelityPeriod,
  PLAN_CATALOG,
  ADDON_CATALOG,
  getSubscriptionMonthlyPriceCents,
  getSubscriptionMonthlyPriceWithFidelityCents,
  isValidPlanBaseId,
  isValidAddOnId,
  isValidFidelityPeriod,
} from "./planCatalog";
import { getPaymentProvider } from "./providers";
import { checkAppointmentLimit } from "./usageService";

// ---------------------------------------------------------------------------
// Fase 2 de Prontidão Comercial — Serviço de assinatura
//
// getClinicSubscription(clinicId) é a função central que qualquer parte do
// backend chama para saber "o que esta clínica tem direito a usar" — a
// Fase 3 (feature gating) usa isso para decidir se um endpoint de IA está
// liberado, e a Fase 4 (medição de uso) usa isso para saber o limite de
// atendimentos/mês do plano contratado. Só existe essa função porque, sem
// ela, essa lógica ficaria duplicada rota por rota — exatamente o que o
// plano de implementação pedia para evitar.
// ---------------------------------------------------------------------------

export interface ClinicSubscription {
  clinicId: string;
  planBase: PlanBaseId;
  addOns: AddOnId[];
  fidelityPeriod: FidelityPeriod;
  status: "ativo" | "inadimplente" | "cancelado";
  // Presentes só depois que a Fase 5 (cobrança) começar a preenchê-los de
  // verdade — undefined é um estado válido até lá, não um erro.
  startedAt?: string;
  nextBillingAt?: string;
  // Fase 5 de Prontidão Comercial: identificadores do lado do provedor de
  // pagamento (ver server/billing/providers/paymentProvider.ts) — só
  // existem depois que a clínica passa pelo fluxo de PUT
  // /api/billing/clinics/:id/activate-payment (ver server/routes/billing.ts).
  externalCustomerId?: string;
  externalSubscriptionId?: string;
}

/**
 * Assinatura de reserva usada quando a clínica ainda não tem nenhuma linha
 * em Subscriptions (dado inconsistente/legado) — nunca decide por um plano
 * pago por engano; cai no plano mais restrito, sem nenhum add-on de IA, e
 * marca status "inadimplente" para chamar atenção operacional em vez de
 * passar despercebido.
 */
function fallbackSubscription(clinicId: string): ClinicSubscription {
  console.warn(`[Billing] Clínica ${clinicId} sem assinatura cadastrada — aplicando fallback restrito.`);
  return {
    clinicId,
    planBase: "essencial",
    addOns: [],
    fidelityPeriod: "mensal",
    status: "inadimplente",
  };
}

/**
 * Busca a assinatura ativa de uma clínica. Não lança exceção — em caso de
 * erro de leitura ou dado ausente/corrompido, devolve o fallback restrito
 * acima, seguindo o mesmo princípio "fail-safe, nunca fail-open" já usado
 * nos guardrails clínicos (server/clinical/triageGuardrails.ts): mais vale
 * negar acesso de forma segura do que liberar algo por padrão.
 */
export async function getClinicSubscription(clinicId: string): Promise<ClinicSubscription> {
  try {
    const res = await docClient.send(new GetCommand({ TableName: "Subscriptions", Key: { clinicId } }));
    const item = res.Item;
    if (!item) {
      return fallbackSubscription(clinicId);
    }

    const planBase = isValidPlanBaseId(item.planBase) ? item.planBase : "essencial";
    const addOns = Array.isArray(item.addOns) ? item.addOns.filter(isValidAddOnId) : [];
    const fidelityPeriod = isValidFidelityPeriod(item.fidelityPeriod) ? item.fidelityPeriod : "mensal";
    const status = item.status === "ativo" || item.status === "inadimplente" || item.status === "cancelado" ? item.status : "inadimplente";

    return {
      clinicId,
      planBase,
      addOns,
      fidelityPeriod,
      status,
      startedAt: typeof item.startedAt === "string" ? item.startedAt : undefined,
      nextBillingAt: typeof item.nextBillingAt === "string" ? item.nextBillingAt : undefined,
      externalCustomerId: typeof item.externalCustomerId === "string" ? item.externalCustomerId : undefined,
      externalSubscriptionId: typeof item.externalSubscriptionId === "string" ? item.externalSubscriptionId : undefined,
    };
  } catch (e) {
    console.error(`[Billing] Erro ao consultar assinatura da clínica ${clinicId}:`, e);
    return fallbackSubscription(clinicId);
  }
}

/**
 * Verifica se uma clínica tem um add-on de IA específico contratado E a
 * assinatura está com status "ativo" — usado pela Fase 3 (requireFeature).
 * Uma clínica inadimplente ou cancelada não tem acesso a add-ons, mesmo
 * que a lista addOns ainda os contenha (o cancelamento não precisa apagar
 * o histórico do que já foi contratado, só suspender o acesso).
 *
 * Passo 5.4 do plano — decisão de produto sobre o alcance da
 * inadimplência: só os add-ons de IA são suspensos (via este helper); o
 * uso da base do sistema (atendimento, jornadas, pendências etc.)
 * continua funcionando normalmente, sem período de tolerância separado
 * nem bloqueio geral. Consistente com a filosofia já aplicada em
 * checkAppointmentLimit (Fase 4): nunca travar o atendimento ao
 * paciente por causa de um problema comercial — a clínica sente a
 * inadimplência na perda dos recursos de IA contratados, não em ficar
 * sem conseguir atender quem já está no consultório.
 */
export async function clinicHasAddOn(clinicId: string, addOnId: AddOnId): Promise<boolean> {
  const subscription = await getClinicSubscription(clinicId);
  if (subscription.status !== "ativo") return false;
  return subscription.addOns.includes(addOnId);
}

/** Monta um resumo pronto para exibição — preço, limite, add-ons com nome. */
export function buildSubscriptionSummary(subscription: ClinicSubscription) {
  const plan = PLAN_CATALOG[subscription.planBase];
  const addOnDetails = subscription.addOns.map((id) => ADDON_CATALOG[id]).filter(Boolean);

  return {
    clinicId: subscription.clinicId,
    status: subscription.status,
    fidelityPeriod: subscription.fidelityPeriod,
    plan: {
      id: plan.id,
      label: plan.label,
      includedAppointmentsPerMonth: plan.includedAppointmentsPerMonth,
    },
    addOns: addOnDetails.map((a) => ({ id: a.id, label: a.label })),
    pricing: {
      monthlyPriceCents: getSubscriptionMonthlyPriceCents(subscription.planBase, subscription.addOns),
      monthlyPriceWithFidelityCents: getSubscriptionMonthlyPriceWithFidelityCents(
        subscription.planBase,
        subscription.addOns,
        subscription.fidelityPeriod
      ),
    },
    startedAt: subscription.startedAt,
    nextBillingAt: subscription.nextBillingAt,
  };
}

/**
 * Passo 5.2 do plano — cria o cliente e a assinatura recorrente no
 * provedor de pagamento ativo (ver server/billing/providers/index.ts) e
 * grava os identificadores externos + nextBillingAt em Subscriptions.
 *
 * Idempotente: se a clínica já tem externalSubscriptionId, não cria de
 * novo — devolve a assinatura já ativada. Evita duplicar cobrança se a
 * rota for chamada mais de uma vez (ex.: novo clique num botão "Ativar
 * Pagamento" antes da resposta da primeira chamada voltar).
 */
export async function activatePaymentForClinic(clinicId: string, clinicName: string): Promise<ClinicSubscription> {
  const subscription = await getClinicSubscription(clinicId);
  if (subscription.externalSubscriptionId) {
    return subscription;
  }

  const provider = getPaymentProvider();

  const { externalCustomerId } = await provider.createCustomer({ clinicId, clinicName });

  const monthlyPriceWithFidelityCents = getSubscriptionMonthlyPriceWithFidelityCents(
    subscription.planBase,
    subscription.addOns,
    subscription.fidelityPeriod
  );
  const lineItemLabels = [
    PLAN_CATALOG[subscription.planBase]?.label,
    ...subscription.addOns.map((id) => ADDON_CATALOG[id]?.label).filter(Boolean),
  ].filter(Boolean) as string[];

  const { externalSubscriptionId, nextBillingAt } = await provider.createSubscription({
    externalCustomerId,
    clinicId,
    monthlyPriceWithFidelityCents,
    fidelityPeriod: subscription.fidelityPeriod,
    lineItemLabels,
  });

  await docClient.send(
    new UpdateCommand({
      TableName: "Subscriptions",
      Key: { clinicId },
      UpdateExpression: "SET externalCustomerId = :cust, externalSubscriptionId = :sub, nextBillingAt = :next",
      ExpressionAttributeValues: {
        ":cust": externalCustomerId,
        ":sub": externalSubscriptionId,
        ":next": nextBillingAt,
      },
    })
  );

  return { ...subscription, externalCustomerId, externalSubscriptionId, nextBillingAt };
}

/**
 * Passo 5.3 do plano — cobra o excedente de atendimentos do mês corrente
 * de uma clínica, se houver. Pensada para ser chamada por uma rotina
 * periódica no fim do ciclo de cobrança (não por uma rota HTTP direta —
 * cobrar excedente não é uma ação que a clínica ou um usuário interno
 * deveria disparar manualmente a qualquer momento, e sim algo que
 * acontece de forma previsível no fechamento do período).
 *
 * Não cobra nada se a clínica ainda não tem pagamento ativado
 * (externalCustomerId ausente) — não existe "onde" cobrar sem isso.
 */
export async function chargeOverageForClinic(
  clinicId: string,
  overageCount: number
): Promise<{ charged: boolean; externalChargeId?: string; amountCents?: number }> {
  if (overageCount <= 0) {
    return { charged: false };
  }

  const subscription = await getClinicSubscription(clinicId);
  if (!subscription.externalCustomerId) {
    console.warn(`[Billing] Clínica ${clinicId} tem excedente mas ainda não ativou pagamento — cobrança adiada.`);
    return { charged: false };
  }

  const overagePricePerAppointment = PLAN_CATALOG[subscription.planBase]?.overageCentsPerAppointment ?? 0;
  const amountCents = overageCount * overagePricePerAppointment;
  if (amountCents <= 0) {
    return { charged: false };
  }

  const provider = getPaymentProvider();
  const { externalChargeId } = await provider.chargeOverage({
    externalCustomerId: subscription.externalCustomerId,
    amountCents,
    description: `Excedente de ${overageCount} atendimento(s) acima do limite do plano ${PLAN_CATALOG[subscription.planBase]?.label}.`,
  });

  return { charged: true, externalChargeId, amountCents };
}

/**
 * Passo 5.3 do plano — muda o plano base e/ou os add-ons contratados por
 * uma clínica. Não recria a assinatura no provedor (isso reiniciaria o
 * ciclo de cobrança e o período de fidelidade já andado); só atualiza o
 * que está registrado em Subscriptions. Uma integração real com o
 * provedor tipicamente tem uma chamada própria de "atualizar assinatura"
 * — ponto de extensão natural quando o provedor real for escolhido (ver
 * PaymentProvider.createSubscription, que poderia ganhar um método
 * `updateSubscription` irmão nesse momento).
 */
export async function changeClinicPlan(
  clinicId: string,
  updates: { planBase?: PlanBaseId; addOns?: AddOnId[] }
): Promise<ClinicSubscription> {
  const current = await getClinicSubscription(clinicId);
  const nextPlanBase = updates.planBase && isValidPlanBaseId(updates.planBase) ? updates.planBase : current.planBase;
  const nextAddOns = updates.addOns ? updates.addOns.filter(isValidAddOnId) : current.addOns;

  await docClient.send(
    new UpdateCommand({
      TableName: "Subscriptions",
      Key: { clinicId },
      UpdateExpression: "SET planBase = :plan, addOns = :addOns",
      ExpressionAttributeValues: { ":plan": nextPlanBase, ":addOns": nextAddOns },
    })
  );

  return { ...current, planBase: nextPlanBase, addOns: nextAddOns };
}
