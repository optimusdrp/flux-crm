import { Request, Response, NextFunction } from "express";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { CRMTab, PermissionAction, DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLE_ACTIONS } from "./permissions";

/**
 * Busca as tabs permitidas para uma role, dentro de uma clínica específica.
 * Prioriza a matriz dinâmica salva em RolePermissions (a mesma tabela que
 * /api/auth/permissions lê/escreve), porque um Administrador pode ter
 * reconfigurado as permissões depois do seed inicial. Cai para
 * DEFAULT_ROLE_PERMISSIONS só se a role ainda não tiver uma linha na
 * tabela para aquela clínica.
 *
 * Fase 1 de Prontidão Comercial: a chave da tabela passou a ser composta
 * (clinicId + role) — cada clínica tem sua própria matriz, mesmo que use
 * os mesmos nomes de perfil que outra clínica.
 */
async function getAllowedTabsForRole(clinicId: string, role: string): Promise<CRMTab[]> {
  try {
    const res = await docClient.send(new GetCommand({ TableName: "RolePermissions", Key: { clinicId, role } }));
    if (res.Item && Array.isArray(res.Item.allowedTabs)) {
      return res.Item.allowedTabs as CRMTab[];
    }
  } catch (e) {
    console.warn("[RBAC] Falha ao consultar RolePermissions, usando default:", e);
  }
  return DEFAULT_ROLE_PERMISSIONS[role] || [];
}

/**
 * Middleware factory: `requireTab('auditoria')` retorna um middleware que
 * só deixa passar se a role do usuário autenticado (req.user, setado pelo
 * requireAuth da Fase 1) tiver a tab informada liberada.
 *
 * Deve ser usado sempre DEPOIS de requireAuth na cadeia de middlewares,
 * já que depende de req.user existir.
 *
 * Administrador tem sempre acesso total — mesma regra que já existe em
 * AuthContext.hasPermission() no front-end, replicada aqui porque agora é
 * o backend que precisa decidir de verdade.
 */
export function requireTab(tab: CRMTab) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      // Não deveria acontecer se requireAuth rodou antes, mas não custa
      // ser explícito em vez de deixar undefined vazar para a checagem.
      return res.status(401).json({ success: false, error: "Não autenticado." });
    }

    if (req.user.role === "Administrador") {
      return next();
    }

    const allowedTabs = await getAllowedTabsForRole(req.user.clinicId, req.user.role);
    if (!allowedTabs.includes(tab)) {
      return res.status(403).json({
        success: false,
        error: `Seu perfil (${req.user.role}) não tem permissão para acessar este recurso.`,
      });
    }

    next();
  };
}

/**
 * Variante de requireTab para rotas consumidas por mais de uma view da UI
 * (ex.: /api/patients é usado tanto por AtendimentosView -> 'atendimentos'
 * quanto por JornadasView -> 'jornadas'). Libera se a role tiver acesso a
 * QUALQUER UMA das tabs informadas.
 */
export function requireAnyTab(tabs: CRMTab[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Não autenticado." });
    }

    if (req.user.role === "Administrador") {
      return next();
    }

    const allowedTabs = await getAllowedTabsForRole(req.user.clinicId, req.user.role);
    const hasAccess = tabs.some((tab) => allowedTabs.includes(tab));
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: `Seu perfil (${req.user.role}) não tem permissão para acessar este recurso.`,
      });
    }

    next();
  };
}

/**
 * Restringe a rota exclusivamente ao perfil Administrador — usado em ações
 * de risco elevado que não se encaixam em nenhuma CRMTab (ex.: resetar o
 * banco via /api/seed).
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "Não autenticado." });
  }
  if (req.user.role !== "Administrador") {
    return res.status(403).json({
      success: false,
      error: "Esta ação é restrita ao perfil Administrador.",
    });
  }
  next();
}

/**
 * Busca as ações granulares concedidas a uma role, dentro de uma clínica
 * específica. Mesma estratégia de getAllowedTabsForRole: prioriza a matriz
 * dinâmica salva em RolePermissions (campo allowedActions, ao lado de
 * allowedTabs na mesma linha), com DEFAULT_ROLE_ACTIONS como reserva se a
 * role ainda não tiver uma linha na tabela para aquela clínica, ou o campo
 * não existir nela ainda (registros seedados antes desta extensão).
 */
async function getAllowedActionsForRole(clinicId: string, role: string): Promise<PermissionAction[]> {
  try {
    const res = await docClient.send(new GetCommand({ TableName: "RolePermissions", Key: { clinicId, role } }));
    if (res.Item && Array.isArray(res.Item.allowedActions)) {
      return res.Item.allowedActions as PermissionAction[];
    }
  } catch (e) {
    console.warn("[RBAC] Falha ao consultar allowedActions, usando default:", e);
  }
  return DEFAULT_ROLE_ACTIONS[role] || [];
}

/**
 * Middleware factory: `requireAction('patients.delete')` retorna um
 * middleware que só deixa passar se a role do usuário autenticado tiver
 * essa ação granular concedida.
 *
 * Diferente de requireTab (que controla acesso a uma tela inteira),
 * requireAction controla uma ação específica, independente de tela — para
 * ações destrutivas ou sensíveis demais para depender só de "estar numa
 * tab". Um Administrador concede essas ações a outros perfis pela tela de
 * Configurações (PUT /api/auth/permissions); por padrão, nenhum perfil
 * além do Administrador tem nenhuma ação concedida.
 *
 * Administrador sempre passa, sem precisar de concessão explícita — mesma
 * regra de acesso total já aplicada em requireTab/requireAnyTab.
 */
export function requireAction(action: PermissionAction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Não autenticado." });
    }

    if (req.user.role === "Administrador") {
      return next();
    }

    const allowedActions = await getAllowedActionsForRole(req.user.clinicId, req.user.role);
    if (!allowedActions.includes(action)) {
      return res.status(403).json({
        success: false,
        error: `Seu perfil (${req.user.role}) não tem permissão para executar esta ação. Um Administrador pode concedê-la em Configurações.`,
      });
    }

    next();
  };
}
