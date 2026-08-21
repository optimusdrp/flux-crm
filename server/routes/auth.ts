import { Router } from "express";
import { GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { verifyPassword, issueToken } from "../auth/authService";
import { requireAuth } from "../auth/requireAuth";
import { requireTab } from "../auth/requireTab";

// ---------------------------------------------------------------------------
// Fase 5 — Separação de server.ts por domínio (continuação)
//
// Segundo módulo extraído: autenticação (login/logout/permissions). Mesmo
// comportamento de antes, só reorganizado — nenhuma rota mudou de
// prefixo, middleware ou lógica interna.
// ---------------------------------------------------------------------------

export function createAuthRouter(): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const cleanEmail = email && typeof email === "string" ? email.trim().toLowerCase() : "";

      // Antes, e-mail vazio caía num default e e-mail desconhecido logava
      // automaticamente como "Recepção". Agora ambos são rejeitados: sem
      // e-mail, sem senha ou usuário inexistente => credenciais inválidas.
      if (!cleanEmail || !password || typeof password !== "string") {
        return res.status(400).json({ success: false, error: "E-mail e senha são obrigatórios." });
      }

      const userRes = await docClient.send(new GetCommand({ TableName: "Users", Key: { email: cleanEmail } }));
      const userRecord = userRes.Item;

      // Mesma mensagem genérica tanto para "usuário não existe" quanto para
      // "senha errada" — evita que a resposta sirva para enumerar e-mails
      // válidos cadastrados no sistema.
      const invalidCredentialsResponse = () =>
        res.status(401).json({ success: false, error: "E-mail ou senha inválidos." });

      if (!userRecord) {
        return invalidCredentialsResponse();
      }

      const passwordOk = await verifyPassword(password, userRecord.passwordHash);
      if (!passwordOk) {
        return invalidCredentialsResponse();
      }

      // Fase 1 de Prontidão Comercial: todo usuário pertence a uma
      // clínica — se por algum motivo o registro estiver sem clinicId
      // (dado legado, ou erro de cadastro), tratamos como credencial
      // inválida em vez de deixar o login prosseguir sem esse dado
      // essencial para o isolamento entre clientes.
      const clinicId = userRecord.clinicId;
      if (!clinicId || typeof clinicId !== "string") {
        console.error(`[Auth Login] Usuário ${cleanEmail} sem clinicId associado.`);
        return invalidCredentialsResponse();
      }

      // Fetch permissions matrix from DynamoDB
      let allowedTabs = ["atendimentos", "jornadas", "pendencias"];
      let allowedActions: string[] = [];
      try {
        const permRes = await docClient.send(new GetCommand({ TableName: "RolePermissions", Key: { clinicId, role: userRecord.role } }));
        if (permRes.Item && Array.isArray(permRes.Item.allowedTabs)) {
          allowedTabs = permRes.Item.allowedTabs;
        }
        if (permRes.Item && Array.isArray(permRes.Item.allowedActions)) {
          allowedActions = permRes.Item.allowedActions;
        }
      } catch (e) {
        console.warn("[Auth Login] Falling back to default role tabs:", e);
      }

      // Fase 1 de Prontidão Comercial: nome da clínica devolvido no login,
      // para a interface parar de exibir "Clínica Santa Helena" fixo no
      // código — se a clínica não for encontrada (dado inconsistente), cai
      // para um rótulo genérico em vez de quebrar o login.
      let clinicName = "Minha Clínica";
      try {
        const clinicRes = await docClient.send(new GetCommand({ TableName: "Clinics", Key: { id: clinicId } }));
        if (clinicRes.Item?.name) {
          clinicName = clinicRes.Item.name;
        }
      } catch (e) {
        console.warn("[Auth Login] Falling back to generic clinic name:", e);
      }

      const sessionToken = issueToken({ email: cleanEmail, role: userRecord.role, clinicId });

      return res.json({
        success: true,
        user: {
          id: cleanEmail,
          email: cleanEmail,
          name: userRecord.name,
          role: userRecord.role,
          unit: userRecord.unit,
          clinicId,
          clinicName,
          token: sessionToken,
          allowedTabs,
          allowedActions,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao autenticar." });
    }
  });

  router.post("/logout", (req, res) => {
    // O JWT é stateless (não há sessão no servidor para invalidar aqui);
    // o front-end é responsável por descartar o token. Uma blocklist de
    // tokens revogados fica fora do escopo desta Fase 1.
    return res.json({ success: true, message: "Sessão encerrada com sucesso." });
  });

  router.get("/permissions", requireAuth, async (req, res) => {
    try {
      // Fase 1 de Prontidão Comercial: antes um Scan trazia a matriz de
      // TODAS as clínicas — agora filtramos pela clínica do usuário
      // autenticado (req.user.clinicId, populado pelo requireAuth a
      // partir do JWT), senão a Recepção de uma clínica veria (e
      // conseguiria inferir) a matriz de permissões de outra.
      const clinicId = req.user!.clinicId;
      const permScan = await docClient.send(
        new ScanCommand({
          TableName: "RolePermissions",
          FilterExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": clinicId },
        })
      );
      const result: Record<string, { allowedTabs: string[]; allowedActions: string[] }> = {};
      if (permScan.Items) {
        permScan.Items.forEach((item) => {
          result[item.role] = {
            allowedTabs: item.allowedTabs || [],
            allowedActions: item.allowedActions || [],
          };
        });
      }
      return res.json({ success: true, permissions: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao buscar permissões." });
    }
  });

  // Item revisado: ação sensível concedendo permissões granulares por
  // perfil (ex.: patients.delete, patients.merge) — só o Administrador
  // pode alterar a matriz de permissões, o que já inclui conceder essas
  // ações a outros perfis. Continua exigindo acesso à tela de
  // Configurações (na prática, só o Administrador tem essa tab por
  // padrão).
  router.put("/permissions", requireAuth, requireTab("configuracoes"), async (req, res) => {
    const { role, allowedTabs, allowedActions } = req.body;
    if (!role || !Array.isArray(allowedTabs)) {
      return res.status(400).json({ success: false, error: "Dados de permissão inválidos." });
    }
    // allowedActions é opcional na requisição (compatibilidade com um
    // front-end que só edite abas); quando ausente, preserva o que já
    // estava salvo em vez de apagar — ver o merge com o registro atual
    // logo abaixo.
    if (allowedActions !== undefined && !Array.isArray(allowedActions)) {
      return res.status(400).json({ success: false, error: "allowedActions deve ser uma lista." });
    }

    try {
      // Fase 1 de Prontidão Comercial: a matriz de permissões é por
      // clínica — um Administrador só edita a matriz da própria clínica
      // (req.user.clinicId), nunca de outra, mesmo que soubesse o nome
      // de um perfil de outro cliente.
      const clinicId = req.user!.clinicId;

      // Merge com o registro atual: PutCommand substitui a linha inteira,
      // então buscamos o que já existe primeiro para não apagar
      // allowedActions ao salvar uma edição que só mexeu em allowedTabs
      // (ou vice-versa) — bug real que existia antes desta revisão.
      const currentRes = await docClient.send(new GetCommand({ TableName: "RolePermissions", Key: { clinicId, role } }));
      const currentActions = currentRes.Item?.allowedActions || [];

      await docClient.send(
        new PutCommand({
          TableName: "RolePermissions",
          Item: {
            clinicId,
            role,
            allowedTabs,
            allowedActions: allowedActions !== undefined ? allowedActions : currentActions,
          },
        })
      );

      // Return all updated permissions (só as da própria clínica)
      const permScan = await docClient.send(
        new ScanCommand({
          TableName: "RolePermissions",
          FilterExpression: "clinicId = :clinicId",
          ExpressionAttributeValues: { ":clinicId": clinicId },
        })
      );
      const result: Record<string, { allowedTabs: string[]; allowedActions: string[] }> = {};
      if (permScan.Items) {
        permScan.Items.forEach((item) => {
          result[item.role] = {
            allowedTabs: item.allowedTabs || [],
            allowedActions: item.allowedActions || [],
          };
        });
      }
      return res.json({ success: true, permissions: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Erro ao salvar permissões." });
    }
  });

  return router;
}
