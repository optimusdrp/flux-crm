// ---------------------------------------------------------------------------
// Fase 2 — Autorização (RBAC) no backend
//
// Antes desta fase, DEFAULT_ROLE_PERMISSIONS existia só em
// src/context/AuthContext.tsx (front-end) e era usada apenas para decidir
// o que a UI escondia/mostrava — o AccessDeniedGuard.tsx era puramente
// visual. Nenhuma rota do server.ts checava se o usuário autenticado tinha
// permissão para aquele recurso; qualquer usuário autenticado (após a Fase
// 1) conseguia ler/escrever qualquer coisa.
//
// Este módulo é a versão "que decide de verdade": cada rota da API é
// mapeada para uma CRMTab, e o middleware requireTab() barra o acesso antes
// de tocar no Dynalite. Administrador sempre tem acesso total, replicando
// a mesma regra que já existe em AuthContext.hasPermission().
//
// Extensão pós-Fase 5 — ações granulares por perfil
//
// CRMTab controla acesso por TELA (ex.: "atendimentos" libera a aba
// inteira). Algumas ações são destrutivas ou sensíveis demais para
// depender só de estar numa tela — excluir um paciente ou mesclar dois
// registros duplicados são exemplos: antes, essas ações eram restritas
// direto ao Administrador (requireAdmin), sem meio-termo.
//
// PermissionAction resolve isso: é uma ação nomeada, independente de tab,
// que o Administrador pode conceder a outros perfis especificamente — sem
// precisar liberar a tela inteira de Configurações para alguém só para
// permitir que essa pessoa também exclua pacientes. Por padrão, nenhum
// perfil além do Administrador tem essas ações (allowedActions vazio),
// preservando o comportamento atual até que um Administrador decida
// conceder algo pela tela de Configurações.
// ---------------------------------------------------------------------------

export type CRMTab =
  | "visao-geral"
  | "atendimentos"
  | "jornadas"
  | "pendencias"
  | "automacoes"
  | "indicadores"
  | "configuracoes"
  | "auditoria";

// Ações granulares concedíveis por perfil, independentes de CRMTab.
// Ao adicionar uma nova ação sensível ao sistema, ela entra aqui.
export type PermissionAction =
  | "patients.delete"
  | "patients.merge";

// Mantido propositalmente idêntico ao DEFAULT_ROLE_PERMISSIONS de
// src/context/AuthContext.tsx. Se um dia divergirem, esta cópia (a do
// backend) é a que vale — o front usa RolePermissions vindo de
// GET /api/auth/permissions, que por sua vez lê da tabela RolePermissions
// no Dynalite, seedada a partir deste mesmo conjunto de valores
// (server/db/seed.ts / SEED_ROLE_PERMISSIONS).
export const DEFAULT_ROLE_PERMISSIONS: Record<string, CRMTab[]> = {
  Administrador: [
    "visao-geral",
    "atendimentos",
    "jornadas",
    "pendencias",
    "automacoes",
    "indicadores",
    "configuracoes",
    "auditoria",
  ],
  Recepção: ["atendimentos", "jornadas", "pendencias"],
  "Contador (financeiro)": ["visao-geral", "pendencias", "indicadores"],
  Terceirizado: ["pendencias"],
  "Profissional de Saúde": [
    "visao-geral",
    "atendimentos",
    "jornadas",
    "pendencias",
    "auditoria",
  ],
};

// Ações concedidas por padrão a cada perfil, além do que o Administrador
// sempre tem por definição (ver requireAction em requireTab.ts). Vazio
// para todos os perfis não-Administrador — precisa ser concedido
// explicitamente pela tela de Configurações.
export const DEFAULT_ROLE_ACTIONS: Record<string, PermissionAction[]> = {
  Administrador: ["patients.delete", "patients.merge"],
  Recepção: [],
  "Contador (financeiro)": [],
  Terceirizado: [],
  "Profissional de Saúde": [],
};
