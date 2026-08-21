import { PaymentProvider } from "./paymentProvider";
import { MockPaymentProvider } from "./mockProvider";

// ---------------------------------------------------------------------------
// Fase 5 de Prontidão Comercial — Seletor de provedor ativo
//
// Único ponto do sistema que decide QUAL implementação de PaymentProvider
// está em uso. Hoje só existe MockPaymentProvider (ver esse arquivo para
// o porquê); quando a decisão de negócio sobre o provedor real for
// tomada, a nova implementação entra aqui, selecionada por
// PAYMENT_PROVIDER (variável de ambiente) — nenhuma rota ou serviço
// precisa mudar, porque todos dependem só da interface PaymentProvider.
// ---------------------------------------------------------------------------

export function getPaymentProvider(): PaymentProvider {
  const providerName = process.env.PAYMENT_PROVIDER || "mock";

  switch (providerName) {
    case "mock":
      return new MockPaymentProvider();
    // case "stripe": return new StripePaymentProvider();
    // case "pagarme": return new PagarMePaymentProvider();
    default:
      console.warn(`[Billing] PAYMENT_PROVIDER="${providerName}" desconhecido — usando MockPaymentProvider.`);
      return new MockPaymentProvider();
  }
}
