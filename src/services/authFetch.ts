// Fase 1: agora que o backend exige `Authorization: Bearer <token>` em quase
// toda rota /api (ver server/auth/requireAuth.ts), o front-end precisa
// enviar esse header em toda chamada. Em vez de editar cada um dos ~40
// `fetch(...)` espalhados em api.ts, authFetch centraliza a injeção do
// token — api.ts troca `fetch(` por `authFetch(` e mantém a mesma
// assinatura/comportamento em tudo o mais.

const SESSION_STORAGE_KEY = "mediflux_user_session";

function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session?.token || null;
  } catch {
    return null;
  }
}

/**
 * Mesma assinatura do fetch nativo. Adiciona o header Authorization quando
 * existe um token de sessão salvo. Se o servidor responder 401 (token
 * ausente/expirado/inválido), limpa a sessão local e força o usuário de
 * volta para a tela de login — evita ficar "preso" numa sessão morta
 * mostrando erros genéricos de rede.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();

  const headers = new Headers(init.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(input, { ...init, headers });

  if (response.status === 401) {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    // Notifica o restante da aplicação (AuthContext escuta este evento)
    // para derrubar o estado de usuário logado e voltar para a tela de
    // login, sem precisar de um reload forçado da página.
    window.dispatchEvent(new CustomEvent("mediflux:session-expired"));
  }

  return response;
}
