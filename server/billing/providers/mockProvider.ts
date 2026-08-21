import crypto from "crypto";
import {
  PaymentProvider,
  CreateCustomerInput,
  CreateCustomerResult,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  CancelSubscriptionInput,
  ChargeOverageInput,
  ChargeOverageResult,
} from "./paymentProvider";
import { FIDELITY_MONTHS } from "../planCatalog";

// ---------------------------------------------------------------------------
// Fase 5 de Prontidão Comercial — Provedor de pagamento de referência
//
// Implementação de PaymentProvider que não depende de nenhuma conta
// externa — gera identificadores determinísticos e calcula a próxima data
// de cobrança de verdade, mas não move dinheiro real. Existe para: (1)
// permitir testar todo o fluxo de assinatura/cobrança deste plano sem
// esperar a decisão de qual provedor real contratar; (2) servir de
// especificação viva de como uma implementação real (ex.: StripeProvider)
// deve se comportar, já que segue o mesmo contrato.
//
// MOCK_WEBHOOK_SECRET simula o segredo de assinatura de webhook que um
// provedor real forneceria — trocar por variável de ambiente própria do
// provedor escolhido quando a integração real for feita.
// ---------------------------------------------------------------------------

const MOCK_WEBHOOK_SECRET = process.env.MOCK_PAYMENT_WEBHOOK_SECRET || "mock-webhook-secret-dev-only";

export class MockPaymentProvider implements PaymentProvider {
  readonly providerName = "mock";

  async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
    return { externalCustomerId: `mock_cus_${input.clinicId}` };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    const months = FIDELITY_MONTHS[input.fidelityPeriod] ?? 1;
    const nextBilling = new Date();
    // Fidelidade mensal cobra todo mês; períodos maiores (trimestral,
    // semestral etc.) só voltam a cobrar no fim do período contratado —
    // reflete o desconto de fidelidade sendo por permanência, não por
    // cobrança antecipada de tudo de uma vez.
    nextBilling.setUTCMonth(nextBilling.getUTCMonth() + months);

    return {
      externalSubscriptionId: `mock_sub_${input.clinicId}_${Date.now()}`,
      nextBillingAt: nextBilling.toISOString(),
    };
  }

  async cancelSubscription(_input: CancelSubscriptionInput): Promise<void> {
    // Mock: nada a fazer do lado do "provedor" — o cancelamento real do
    // lado do MediFlux acontece em Subscriptions (status: "cancelado"),
    // ver server/routes/billing.ts.
    return;
  }

  async chargeOverage(input: ChargeOverageInput): Promise<ChargeOverageResult> {
    return { externalChargeId: `mock_charge_${crypto.randomBytes(6).toString("hex")}` };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = crypto.createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
    // Comparação em tempo constante — mesmo padrão de segurança já usado
    // para segredos de webhook em server/routes/webhooks.ts, evita que a
    // diferença de tempo de resposta vaze informação sobre o segredo
    // correto por comparação caractere a caractere.
    try {
      return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
      // Buffers de tamanho diferente lançam em timingSafeEqual — trata
      // como assinatura inválida, não como erro do sistema.
      return false;
    }
  }
}
