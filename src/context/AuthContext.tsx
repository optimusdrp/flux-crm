import React, { createContext, useContext, useState, useEffect } from 'react';
import { CRMTab, UserRole, UserSession, RolePermissions, PermissionAction } from '../types';
import { sentryTelemetry } from '../services/sentryTelemetry';
import { authFetch } from '../services/authFetch';

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, CRMTab[]> = {
  Administrador: [
    'visao-geral',
    'atendimentos',
    'jornadas',
    'pendencias',
    'automacoes',
    'indicadores',
    'configuracoes',
    'auditoria',
  ],
  Recepção: ['atendimentos', 'jornadas', 'pendencias'],
  'Contador (financeiro)': ['visao-geral', 'pendencias', 'indicadores'],
  Terceirizado: ['pendencias'],
  'Profissional de Saúde': [
    'visao-geral',
    'atendimentos',
    'jornadas',
    'pendencias',
    'auditoria',
  ],
};

// Ações granulares por perfil — item revisado: exclusão e unificação de
// pacientes deixaram de ser restritas categoricamente ao Administrador
// (via requireTab("configuracoes")) e passaram a ser concedíveis
// individualmente, por perfil, através da tela de Configurações. Por
// padrão, só o Administrador tem essas ações; os demais perfis começam
// sem nenhuma, precisando de concessão explícita.
export const DEFAULT_ROLE_ACTIONS: Record<UserRole, PermissionAction[]> = {
  Administrador: ['patients.delete', 'patients.merge'],
  Recepção: [],
  'Contador (financeiro)': [],
  Terceirizado: [],
  'Profissional de Saúde': [],
};

// Fase 1: o antigo DEMO_USERS (senha de cada perfil em texto puro, incluindo
// a do Administrador) foi removido do front-end. As credenciais de demo
// continuam existindo — mas só como seed no backend (server/db/seed.ts),
// nunca visíveis no bundle JS entregue ao navegador. A UI de login
// (LoginPage.tsx) agora exige que a senha seja digitada, mesmo nos botões
// de "perfil de demonstração".

interface AuthContextType {
  user: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loading: boolean;
  rolePermissions: Record<UserRole, CRMTab[]>;
  roleActions: Record<UserRole, PermissionAction[]>;
  login: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  hasPermission: (tab: CRMTab) => boolean;
  hasAction: (action: PermissionAction) => boolean;
  updateRolePermissions: (role: UserRole, newTabs: CRMTab[]) => Promise<void>;
  updateRoleActions: (role: UserRole, newActions: PermissionAction[]) => Promise<void>;
  resetPermissionsToDefault: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem('mediflux_user_session');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [rolePermissions, setRolePermissions] = useState<Record<UserRole, CRMTab[]>>(() => {
    const savedPerms = localStorage.getItem('mediflux_role_permissions');
    if (savedPerms) {
      try {
        return JSON.parse(savedPerms);
      } catch (e) {
        return DEFAULT_ROLE_PERMISSIONS;
      }
    }
    return DEFAULT_ROLE_PERMISSIONS;
  });

  const [roleActions, setRoleActions] = useState<Record<UserRole, PermissionAction[]>>(() => {
    const savedActions = localStorage.getItem('mediflux_role_actions');
    if (savedActions) {
      try {
        return JSON.parse(savedActions);
      } catch (e) {
        return DEFAULT_ROLE_ACTIONS;
      }
    }
    return DEFAULT_ROLE_ACTIONS;
  });

  const [loading, setLoading] = useState(false);

  // Fase 1: authFetch (src/services/authFetch.ts) dispara este evento
  // sempre que o backend responde 401 — token ausente, expirado ou
  // inválido. Reage limpando a sessão local, para não deixar a UI presa
  // mostrando erros de rede genéricos enquanto o usuário parece "logado".
  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null);
    };
    window.addEventListener('mediflux:session-expired', handleSessionExpired);
    return () => window.removeEventListener('mediflux:session-expired', handleSessionExpired);
  }, []);

  // Sync to localstorage and backend
  useEffect(() => {
    localStorage.setItem('mediflux_role_permissions', JSON.stringify(rolePermissions));
  }, [rolePermissions]);

  useEffect(() => {
    localStorage.setItem('mediflux_role_actions', JSON.stringify(roleActions));
  }, [roleActions]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('mediflux_user_session', JSON.stringify(user));
    } else {
      localStorage.removeItem('mediflux_user_session');
    }
  }, [user]);

  // Sync session with current role permissions/actions if they changed
  useEffect(() => {
    if (user) {
      const currentAllowed = rolePermissions[user.role] || [];
      const currentActions = roleActions[user.role] || [];
      const tabsChanged = JSON.stringify(currentAllowed) !== JSON.stringify(user.allowedTabs);
      const actionsChanged = JSON.stringify(currentActions) !== JSON.stringify(user.allowedActions);
      if (tabsChanged || actionsChanged) {
        setUser((prev) => (prev ? { ...prev, allowedTabs: currentAllowed, allowedActions: currentActions } : null));
      }
    }
  }, [rolePermissions, roleActions]);

  const login = async (email: string, password?: string) => {
    setLoading(true);

    const cleanEmail = email ? email.trim().toLowerCase() : '';
    sentryTelemetry.addBreadcrumb('auth', `Tentativa de login para: ${cleanEmail}`);

    // Fase 1: e-mail e senha são obrigatórios — o antigo fallback que
    // autenticava localmente sem contatar o servidor (e sem checar senha
    // nenhuma) foi removido. Sem rede, o login falha explicitamente em vez
    // de fingir sucesso.
    if (!cleanEmail || !password) {
      setLoading(false);
      return { success: false, error: 'Informe e-mail e senha para continuar.' };
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      const data = await response.json();

      if (data.success && data.user) {
        const activeRole = data.user.role as UserRole;
        const activeAllowed = rolePermissions[activeRole] || data.user.allowedTabs;
        const activeActions = roleActions[activeRole] || data.user.allowedActions || [];

        const session: UserSession = {
          ...data.user,
          allowedTabs: activeAllowed,
          allowedActions: activeActions,
        };

        // Corrige uma condição de corrida real: authFetch (src/services/
        // authFetch.ts) lê o token direto do localStorage, de forma
        // síncrona, sem depender do ciclo de render do React. Se a
        // gravação no localStorage só acontecesse no useEffect[user] logo
        // abaixo, uma view que monta e dispara uma chamada de API no
        // mesmo commit (ex.: AtendimentosView carregando pacientes)
        // podia rodar ANTES desse efeito — a chamada saía sem token,
        // recebia 401, e o listener de sessão expirada derrubava a sessão
        // que acabara de ser criada. Gravar aqui, de forma síncrona e
        // antes de setUser, garante que authFetch sempre encontre o token
        // já disponível assim que qualquer componente puder reagir à
        // sessão autenticada.
        try {
          localStorage.setItem('mediflux_user_session', JSON.stringify(session));
        } catch {
          // Se o localStorage falhar aqui, o useEffect[user] abaixo ainda
          // tenta gravar — não é um caminho crítico a esse ponto.
        }

        setUser(session);
        sentryTelemetry.setUserContext(session);
        sentryTelemetry.addBreadcrumb('auth', `Autenticação bem-sucedida para ${session.email} (${session.role})`);
        setLoading(false);
        return { success: true };
      }

      setLoading(false);
      sentryTelemetry.addBreadcrumb('auth', `Falha de autenticação para ${cleanEmail}: ${data.error || 'motivo desconhecido'}`);
      return { success: false, error: data.error || 'Credenciais inválidas. Verifique seu e-mail e senha.' };
    } catch (err: any) {
      setLoading(false);
      sentryTelemetry.addBreadcrumb('auth', `Erro de rede ao autenticar ${cleanEmail}`);
      return { success: false, error: 'Não foi possível conectar ao servidor. Tente novamente.' };
    }
  };

  const logout = () => {
    if (user) {
      sentryTelemetry.addBreadcrumb('auth', `Sessão encerrada voluntariamente por ${user.email}`);
    }
    sentryTelemetry.setUserContext(null);
    setUser(null);
    localStorage.removeItem('mediflux_user_session');
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  };

  const hasPermission = (tab: CRMTab): boolean => {
    if (!user) return false;
    if (user.role === 'Administrador') return true;
    return user.allowedTabs.includes(tab);
  };

  // Item revisado: checagem de ação granular (ex.: excluir/mesclar
  // pacientes), independente de o perfil ter acesso à tela onde a ação
  // aparece. Administrador sempre tem todas as ações, igual a
  // hasPermission — mesma regra de acesso total.
  const hasAction = (action: PermissionAction): boolean => {
    if (!user) return false;
    if (user.role === 'Administrador') return true;
    return user.allowedActions.includes(action);
  };

  const updateRolePermissions = async (role: UserRole, newTabs: CRMTab[]) => {
    setRolePermissions((prev) => {
      const updated = { ...prev, [role]: newTabs };
      localStorage.setItem('mediflux_role_permissions', JSON.stringify(updated));
      return updated;
    });

    // Notify backend
    try {
      await authFetch('/api/auth/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, allowedTabs: newTabs }),
      });
    } catch (e) {
      // local update persisted
    }
  };

  // Item revisado: concede/revoga uma ação granular para um perfil (ex.:
  // permitir que Recepção também exclua pacientes). Só chamada pela tela
  // de Configurações, que por sua vez só é acessível a quem já tem a tab
  // "configuracoes" — na prática, hoje só o Administrador.
  const updateRoleActions = async (role: UserRole, newActions: PermissionAction[]) => {
    setRoleActions((prev) => {
      const updated = { ...prev, [role]: newActions };
      localStorage.setItem('mediflux_role_actions', JSON.stringify(updated));
      return updated;
    });

    try {
      await authFetch('/api/auth/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, allowedTabs: rolePermissions[role] || [], allowedActions: newActions }),
      });
    } catch (e) {
      // local update persisted
    }
  };

  const resetPermissionsToDefault = () => {
    setRolePermissions(DEFAULT_ROLE_PERMISSIONS);
    setRoleActions(DEFAULT_ROLE_ACTIONS);
    localStorage.setItem('mediflux_role_permissions', JSON.stringify(DEFAULT_ROLE_PERMISSIONS));
    localStorage.setItem('mediflux_role_actions', JSON.stringify(DEFAULT_ROLE_ACTIONS));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading: loading,
        loading,
        rolePermissions,
        roleActions,
        login,
        logout,
        hasPermission,
        hasAction,
        updateRolePermissions,
        updateRoleActions,
        resetPermissionsToDefault,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
