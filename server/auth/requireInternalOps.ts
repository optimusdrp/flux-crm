import { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Fase 2 de Prontidão Comercial — Rotas internas da plataforma
//
// Cadastrar uma nova clínica é uma ação anterior a "ser Administrador de
// uma clínica" — ninguém tem esse papel numa clínica que ainda não existe.
// Por isso essa rota não pode usar requireAdmin (que pressupõe um usuário
// já pertencente a uma clínica) nem qualquer papel do RBAC por clínica.
//
// Decisão de produto registrada no Plano de Prontidão Comercial (Fase 2):
// a edição do plano contratado passa por um time interno/operacional da
// própria MediFlux, nunca pelo Administrador da clínica cliente — esta
// chave de API interna é o controle de acesso provisório para isso, até
// existir um mecanismo de autenticação de equipe interna mais robusto
// (ex.: um painel administrativo separado, com login próprio). Não é o
// mesmo nível de proteção que uma sessão de usuário — serve para um
// ambiente onde só a própria equipe da plataforma tem a chave, nunca para
// expor esta rota publicamente sem outra camada de proteção de rede.
// ---------------------------------------------------------------------------

export function requireInternalOpsKey(req: Request, res: Response, next: NextFunction) {
  const expectedKey = process.env.INTERNAL_OPS_KEY;

  if (!expectedKey) {
    // Fail loud, não fail open: sem a chave configurada no ambiente, a
    // rota fica indisponível — nunca aceita "qualquer requisição" só
    // porque a variável não foi definida.
    console.error("[Internal Ops] INTERNAL_OPS_KEY não configurada no ambiente — rota interna bloqueada.");
    return res.status(503).json({
      success: false,
      error: "Rota administrativa interna indisponível nesta configuração de ambiente.",
    });
  }

  const providedKey = req.headers["x-internal-ops-key"];
  if (providedKey !== expectedKey) {
    return res.status(401).json({ success: false, error: "Chave de operação interna inválida ou ausente." });
  }

  next();
}
