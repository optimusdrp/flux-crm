// ---------------------------------------------------------------------------
// Fase 5 de Prontidão Comercial — Interface abstrata de provedor de pagamento
//
// A escolha de QUAL provedor usar (Stripe, Pagar.me, Iugu, Asaas etc.) é
// uma decisão de negócio, registrada como fora do escopo técnico deste
// plano de implementação (ver documento "Plano de Implementação —
// Prontidão Comercial", passo 5.1). Esta interface existe para que o
// resto do sistema (rotas, webhooks, lógica de assinatura) dependa só
// deste contrato — nunca de detalhes de um SDK específico — trocar de
// provedor no futuro significa escrever uma nova classe que implemente
// PaymentProvider, sem tocar em mais nada.
//
// server/billing/providers/mockProvider.ts é a implementação de
// referência usada em desenvolvimento e nos testes deste plano — ela
// simula o comportamento de um provedor real (cria assinatura, gera
// cobrança, aceita webhook) sem depender de nenhuma conta externa. Uma
// implementação real (ex.: StripeProvider) troca só o corpo dos métodos,
// mantendo a mesma interface.
// ---------------------------------------------------------------------------

import { FidelityPeriod } from "../planCatalog";

export interface CreateCustomerInput {
  clinicId: string;
  clinicName: string;
}

export interface CreateCustomerResult {
  externalCustomerId: string;
}

export interface CreateSubscriptionInput {
  externalCustomerId: string;
  clinicId: string;
  monthlyPriceWithFidelityCents: number;
  fidelityPeriod: FidelityPeriod;
  /** Rótulos legíveis dos itens cobrados (plano base + cada add-on), para o provedor exibir na fatura — não precisa bater 1:1 com um "produto" cadastrado no provedor. */
  lineItemLabels: string[];
}

export interface CreateSubscriptionResult {
  externalSubscriptionId: string;
  nextBillingAt: string; // ISO 8601
}

export interface CancelSubscriptionInput {
  externalSubscriptionId: string;
}

export interface ChargeOverageInput {
  externalCustomerId: string;
  amountCents: number;
  description: string;
}

export interface ChargeOverageResult {
  externalChargeId: string;
}

/**
 * Todo provedor de pagamento real ou de desenvolvimento implementa este
 * contrato. Nenhum método lança exceção por regra de negócio (ex.: cartão
 * recusado) — devolve um resultado com status, para quem chamar decidir o
 * que fazer; exceções ficam reservadas para falha de infraestrutura
 * (provedor fora do ar, credencial inválida).
 */
export interface PaymentProvider {
  readonly providerName: string;

  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult>;

  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>;

  cancelSubscription(input: CancelSubscriptionInput): Promise<void>;

  chargeOverage(input: ChargeOverageInput): Promise<ChargeOverageResult>;

  /**
   * Valida a assinatura/segredo de um webhook recebido do provedor, antes
   * de qualquer parte do sistema confiar no conteúdo — mesmo princípio já
   * aplicado aos webhooks internos do MediFlux (server/security/urlGuard.ts):
   * nunca processar um payload de webhook sem confirmar a origem primeiro.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean;
}
