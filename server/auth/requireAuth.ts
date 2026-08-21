import { Request, Response, NextFunction } from "express";
import { verifyToken, AuthTokenPayload } from "./authService";

// Estende o Request do Express para carregar o usuário autenticado.
// Rotas protegidas passam a ler `req.user` em vez de confiar em campos
// enviados livremente pelo cliente no body (ex.: req.body.user, hoje usado
// em /api/audit-logs para o campo "user" do log — isso será corrigido na
// Fase 2, mas o req.user já fica disponível a partir desta Fase 1).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

/**
 * Exige um Bearer token válido. Se ausente ou inválido, responde 401 e
 * interrompe a cadeia — a rota protegida nunca chega a tocar no Dynalite.
 *
 * Este é o middleware que faltava no projeto original: nenhuma rota (nem
 * /api/patients, nem /api/auth/permissions) validava token antes desta
 * fase. A proteção por perfil (quem pode ver o quê) é a Fase 2; aqui só
 * garantimos que existe alguém autenticado por trás da requisição.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      success: false,
      error: "Não autenticado. Faça login novamente.",
    });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({
      success: false,
      error: "Sessão inválida ou expirada. Faça login novamente.",
    });
  }

  req.user = payload;
  next();
}
