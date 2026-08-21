// ---------------------------------------------------------------------------
// Fase 2 de Prontidão Comercial — Catálogo de planos
//
// Espelha, em código, a estrutura de preços do documento "Análise de
// Custos e Planos" (base sem IA + add-ons de IA individuais + pacote com
// desconto). Antes desta fase, esses valores só existiam no documento
// comercial — nenhuma parte do sistema sabia, por exemplo, que o plano
// Profissional inclui até 4.000 atendimentos/mês, ou quanto custa o
// add-on de Triagem Clínica. Esta é a fonte única de verdade: qualquer
// lugar do backend que precise saber preço, limite ou quais add-ons
// existem consulta este catálogo, em vez de ter o valor espalhado e
// duplicado em várias rotas.
//
// Alterar um preço ou limite de plano é editar este arquivo — não exige
// mudança de schema no banco, porque Subscriptions (ver server/db/dynalite.ts)
// guarda só QUAL plano/add-on foi contratado, nunca o valor em si.
// ---------------------------------------------------------------------------

export type PlanBaseId = "essencial" | "profissional" | "corporativo";

export type AddOnId =
  | "qualificacao_lead"
  | "analise_sentimento"
  | "classificacao_automatica"
  | "triagem_clinica";

export type FidelityPeriod = "mensal" | "trimestral" | "semestral" | "9meses" | "anual";

export interface PlanBaseDefinition {
  id: PlanBaseId;
  label: string;
  monthlyPriceCents: number; // preço de referência mensal, sem desconto de fidelidade
  includedAppointmentsPerMonth: number;
  // Fase 5 de Prontidão Comercial: preço cobrado por atendimento acima do
  // limite incluído no plano — mais caro por atendimento nos planos
  // menores (incentiva upgrade natural quando o uso cresce de verdade,
  // prática comum de SaaS). Calculado como ~1,4x o custo médio por
  // atendimento do próprio plano (monthlyPriceCents ÷
  // includedAppointmentsPerMonth) — número de partida razoável; ajustar
  // depois de observar uso real, não é um valor com significado externo
  // fixo como os preços de plano/add-on do documento comercial.
  overageCentsPerAppointment: number;
}

export interface AddOnDefinition {
  id: AddOnId;
  label: string;
  monthlyPriceCents: number;
  // Nome do endpoint de IA que este add-on libera — usado pela Fase 3
  // (feature gating) para ligar cada add-on à rota real que ele controla.
  gatedFeature: string;
}

// Valores em centavos (evita erro de ponto flutuante em cálculo de preço,
// mesma prática de qualquer sistema que lida com dinheiro).
export const PLAN_CATALOG: Record<PlanBaseId, PlanBaseDefinition> = {
  essencial: {
    id: "essencial",
    label: "Essencial",
    monthlyPriceCents: 24900,
    includedAppointmentsPerMonth: 1000,
    overageCentsPerAppointment: 35,
  },
  profissional: {
    id: "profissional",
    label: "Profissional",
    monthlyPriceCents: 54900,
    includedAppointmentsPerMonth: 4000,
    overageCentsPerAppointment: 19,
  },
  corporativo: {
    id: "corporativo",
    label: "Corporativo",
    monthlyPriceCents: 129000,
    includedAppointmentsPerMonth: 15000,
    overageCentsPerAppointment: 12,
  },
};

export const ADDON_CATALOG: Record<AddOnId, AddOnDefinition> = {
  qualificacao_lead: {
    id: "qualificacao_lead",
    label: "Qualificação de Lead por IA",
    monthlyPriceCents: 8900,
    gatedFeature: "qualify-lead",
  },
  analise_sentimento: {
    id: "analise_sentimento",
    label: "Análise de Sentimento por IA",
    monthlyPriceCents: 5900,
    gatedFeature: "sentiment-analysis",
  },
  classificacao_automatica: {
    id: "classificacao_automatica",
    label: "Classificação Automática (Auto-tag)",
    monthlyPriceCents: 7900,
    gatedFeature: "auto-tag",
  },
  triagem_clinica: {
    id: "triagem_clinica",
    label: "Triagem Clínica de Urgência por IA",
    monthlyPriceCents: 14900,
    gatedFeature: "triagem-clinica",
  },
};

// Pacote Completo de IA: os 4 add-ons contratados juntos saem por um preço
// fixo (não é simplesmente 20% de desconto sobre a soma calculado em tempo
// de execução — o documento comercial já arredondou esse valor para R$ 299,
// terminando em 9 por prática comercial). Fixar o valor aqui, em vez de
// recalcular, evita qualquer divergência de centavos entre o que foi
// comunicado ao cliente e o que o sistema cobra.
export const FULL_AI_PACKAGE_PRICE_CENTS = 29900;
export const ALL_ADDON_IDS: AddOnId[] = [
  "qualificacao_lead",
  "analise_sentimento",
  "classificacao_automatica",
  "triagem_clinica",
];

// Desconto sobre o preço mensal de referência, por período de fidelidade
// — mesma escala aplicada tanto ao plano base quanto a cada add-on
// (e ao pacote completo), ver documento comercial.
export const FIDELITY_DISCOUNT: Record<FidelityPeriod, number> = {
  mensal: 0,
  trimestral: 0.05,
  semestral: 0.1,
  "9meses": 0.13,
  anual: 0.18,
};

export const FIDELITY_MONTHS: Record<FidelityPeriod, number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  "9meses": 9,
  anual: 12,
};

/**
 * Preço mensal (em centavos) de uma lista de add-ons, já aplicando o
 * preço fixo do Pacote Completo de IA quando os 4 add-ons estão presentes
 * — não é preciso que o cliente "escolha o pacote" explicitamente; ter
 * os 4 add-ons contratados É o pacote completo, e o preço fixo se aplica
 * automaticamente, no lugar da soma dos 4 preços avulsos.
 */
export function getAddOnsPriceCents(addOnIds: AddOnId[]): number {
  const uniqueIds = Array.from(new Set(addOnIds));

  const hasAllFourAddOns = ALL_ADDON_IDS.every((id) => uniqueIds.includes(id));
  if (hasAllFourAddOns) {
    return FULL_AI_PACKAGE_PRICE_CENTS;
  }

  return uniqueIds.reduce((total, id) => total + (ADDON_CATALOG[id]?.monthlyPriceCents ?? 0), 0);
}

/**
 * Preço mensal total (em centavos) de uma assinatura — plano base + add-ons
 * de IA contratados — antes de aplicar o desconto de fidelidade do período.
 */
export function getSubscriptionMonthlyPriceCents(planBase: PlanBaseId, addOnIds: AddOnId[]): number {
  const basePrice = PLAN_CATALOG[planBase]?.monthlyPriceCents ?? 0;
  return basePrice + getAddOnsPriceCents(addOnIds);
}

/**
 * Preço mensal (em centavos) já com o desconto do período de fidelidade
 * aplicado — é o valor cobrado por mês durante aquele período, não o
 * total do período inteiro (ver getSubscriptionPeriodTotalCents).
 */
export function getSubscriptionMonthlyPriceWithFidelityCents(
  planBase: PlanBaseId,
  addOnIds: AddOnId[],
  period: FidelityPeriod
): number {
  const monthlyPrice = getSubscriptionMonthlyPriceCents(planBase, addOnIds);
  const discount = FIDELITY_DISCOUNT[period] ?? 0;
  return Math.round(monthlyPrice * (1 - discount));
}

/** Valor total cobrado ao longo de todo o período de fidelidade escolhido. */
export function getSubscriptionPeriodTotalCents(
  planBase: PlanBaseId,
  addOnIds: AddOnId[],
  period: FidelityPeriod
): number {
  const monthlyWithFidelity = getSubscriptionMonthlyPriceWithFidelityCents(planBase, addOnIds, period);
  const months = FIDELITY_MONTHS[period] ?? 1;
  return monthlyWithFidelity * months;
}

export function isValidPlanBaseId(value: unknown): value is PlanBaseId {
  return typeof value === "string" && value in PLAN_CATALOG;
}

export function isValidAddOnId(value: unknown): value is AddOnId {
  return typeof value === "string" && value in ADDON_CATALOG;
}

export function isValidFidelityPeriod(value: unknown): value is FidelityPeriod {
  return typeof value === "string" && value in FIDELITY_DISCOUNT;
}
