import { Request, Response, NextFunction } from "express";
import { AddOnId, ADDON_CATALOG } from "../billing/planCatalog";
import { clinicHasAddOn } from "../billing/subscriptionService";

// ---------------------------------------------------------------------------
// Fase 3 de Prontidão Comercial — Feature gating por add-on de IA
//
// Resolve o achado da auditoria: os 4 endpoints de IA (triagem clínica,
// classificação automática, qualificação de lead, análise de sentimento)
// não tinham NENHUMA restrição por add-on contratado — qualquer usuário
// com acesso à tela de Atendimentos podia chamar qualquer um deles,
// independente do que a clínica pagou.
//
// requireFeature() segue o mesmo padrão de requireTab/requireAction (ver
// server/auth/requireTab.ts), com uma diferença deliberada: aqui a
// restrição é por CLÍNICA (o que foi contratado), não por PERFIL de
// usuário dentro da clínica — então, ao contrário de requireTab/
// requireAction, o Administrador da clínica NÃO passa automaticamente.
// Um Administrador de uma clínica no plano Essencial não deveria
// conseguir usar Triagem Clínica só por ser Administrador; isso furaria
// o próprio modelo de negócio que este middleware existe para impor.
// ---------------------------------------------------------------------------

/**
 * Middleware factory: `requireFeature('triagem_clinica')` retorna um
 * middleware que só deixa passar se a CLÍNICA do usuário autenticado
 * (não o perfil dele) tiver esse add-on de IA contratado e a assinatura
 * estiver ativa (ver clinicHasAddOn, que já trata inadimplência/
 * cancelamento como "não tem o add-on", mesmo que a lista addOns ainda o
 * contenha).
 *
 * Deve ser usado sempre DEPOIS de requireAuth (e, tipicamente, depois de
 * requireTab/requireAnyTab também — ver os 4 endpoints de IA) na cadeia
 * de middlewares, já que depende de req.user existir.
 */
export function requireFeature(addOnId: AddOnId) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Não autenticado." });
    }

    const hasAddOn = await clinicHasAddOn(req.user.clinicId, addOnId);
    if (!hasAddOn) {
      const addOnLabel = ADDON_CATALOG[addOnId]?.label || addOnId;
      return res.status(403).json({
        success: false,
        error: `Este recurso (${addOnLabel}) não está incluído no plano contratado pela sua clínica. Fale com o time comercial para adicionar este add-on.`,
        addOnRequired: addOnId,
      });
    }

    next();
  };
}
