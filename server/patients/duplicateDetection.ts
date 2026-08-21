// ---------------------------------------------------------------------------
// Detecção de pacientes potencialmente duplicados
//
// Compara todos os pares de pacientes cadastrados e sinaliza candidatos a
// duplicata por três critérios independentes, do mais para o menos
// confiável:
//   1. CPF idêntico (depois de normalizar pontuação) — praticamente certeza
//      de que é a mesma pessoa, CPF é único por definição.
//   2. Telefone idêntico (depois de normalizar formatação) — forte indício,
//      mas não é garantia absoluta (números podem ser reciclados/
//      compartilhados por familiares).
//   3. Nome muito similar (distância de edição normalizada) — o critério
//      mais fraco dos três, por isso o limiar é conservador (só marca
//      nomes bem próximos, não qualquer semelhança).
//
// A decisão de qual registro vira o principal na mesclagem NUNCA é
// automática — este módulo só aponta candidatos; quem decide é sempre um
// humano na tela de detecção de duplicados (ver server/routes/patients.ts,
// GET /duplicates e POST /:id/merge).
// ---------------------------------------------------------------------------

export interface PatientForDuplicateCheck {
  id: string;
  name: string;
  phone?: string;
  cpf?: string;
}

export type DuplicateMatchReason = "cpf" | "phone" | "name";

export interface DuplicateCandidate {
  patientA: string;
  patientB: string;
  reasons: DuplicateMatchReason[];
  // Quanto maior, mais confiável o candidato — usado só para ordenar a
  // lista exibida ao usuário, nunca para decidir nada automaticamente.
  confidence: number;
}

function normalizeDigits(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

function normalizeName(value: string | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove acentos
}

/**
 * Distância de Levenshtein simples (número mínimo de edições de caractere
 * para transformar uma string na outra). Implementação O(n*m) em memória
 * O(min(n,m)) — suficiente para nomes de pacientes, não precisa de nada
 * mais sofisticado.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow.push(Math.min(currRow[j - 1] + 1, prevRow[j] + 1, prevRow[j - 1] + cost));
    }
    prevRow = currRow;
  }

  return prevRow[b.length];
}

/**
 * Similaridade de nome normalizada entre 0 (totalmente diferentes) e 1
 * (idênticos), baseada na distância de Levenshtein relativa ao tamanho do
 * maior nome.
 */
function nameSimilarity(nameA: string, nameB: string): number {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

// Limiar conservador: só marca como candidato por nome se a similaridade
// for bem alta (ex.: "Ana Luiza Vasconcelos" vs "Ana Luíza Vasconcelo" bate;
// "Ana Silva" vs "Ana Souza" não deveria bater).
const NAME_SIMILARITY_THRESHOLD = 0.86;

/**
 * Varre a lista de pacientes e retorna todos os pares candidatos a
 * duplicata, ordenados do mais para o menos confiável. Não modifica nada —
 * é só leitura/análise; a decisão de mesclar é sempre uma ação separada e
 * explícita do usuário.
 */
export function findDuplicateCandidates(patients: PatientForDuplicateCheck[]): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (let i = 0; i < patients.length; i++) {
    for (let j = i + 1; j < patients.length; j++) {
      const a = patients[i];
      const b = patients[j];
      const reasons: DuplicateMatchReason[] = [];

      const cpfA = normalizeDigits(a.cpf);
      const cpfB = normalizeDigits(b.cpf);
      if (cpfA && cpfB && cpfA === cpfB) {
        reasons.push("cpf");
      }

      const phoneA = normalizeDigits(a.phone);
      const phoneB = normalizeDigits(b.phone);
      if (phoneA && phoneB && phoneA === phoneB) {
        reasons.push("phone");
      }

      const similarity = nameSimilarity(a.name, b.name);
      if (similarity >= NAME_SIMILARITY_THRESHOLD) {
        reasons.push("name");
      }

      if (reasons.length === 0) continue;

      // Confiança: CPF pesa mais que telefone, que pesa mais que nome —
      // reflete o quão determinante cada critério é sozinho.
      let confidence = 0;
      if (reasons.includes("cpf")) confidence += 60;
      if (reasons.includes("phone")) confidence += 30;
      if (reasons.includes("name")) confidence += Math.round(similarity * 20);

      candidates.push({
        patientA: a.id,
        patientB: b.id,
        reasons,
        confidence: Math.min(confidence, 100),
      });
    }
  }

  return candidates.sort((x, y) => y.confidence - x.confidence);
}
