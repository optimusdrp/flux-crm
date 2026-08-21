<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# MediFlux CRM Health

CRM para clínicas de saúde — Next.js 15 + React 19, com Firebase/Firestore
para autenticação e persistência, e um store em memória (`lib/db/store.ts`)
para o restante dos dados de operação (pacientes, chat, jornadas, etc.).

## Rodando localmente

**Pré-requisitos:** Node.js.

1. Instalar dependências:
   ```bash
   npm install
   ```

2. Copiar `.env.example` para `.env` e preencher as variáveis:
   ```bash
   cp .env.example .env
   ```

   | Variável | Obrigatória? | Para que serve |
   |---|---|---|
   | `GEMINI_API_KEY` | Sim, para as funcionalidades de IA | Chave da API do Gemini, usada pelo roteador de triagem clínica, classificação e qualificação de lead. |
   | `JWT_SECRET` | **Sim, sempre** | Chave de assinatura dos tokens de sessão (`lib/security/jwt.ts`). O servidor recusa iniciar — inclusive `npm run build` — sem essa variável definida. Gere um valor aleatório longo e único por ambiente; nunca reaproveite o mesmo valor entre desenvolvimento e produção. |
   | `APP_URL` | Recomendado | URL onde a aplicação está hospedada — usada para links próprios e callbacks. Em desenvolvimento local, `http://localhost:3000` é suficiente. |

3. Rodar o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```

## Build de produção

```bash
npm run build
npm start
```

`JWT_SECRET` precisa estar definido no ambiente também durante o `build`
(não só em runtime) — o Next.js executa as rotas de API durante a etapa
de "Collecting page data" para determinar quais são estáticas ou
dinâmicas, e isso importa o módulo de autenticação. Sem a variável, o
build falha de propósito (a mesma validação que protege o runtime),
então garanta que ela esteja disponível no ambiente onde o build roda
(pipeline de CI/CD, ou o próprio `.env` local).

## Auditoria de segurança

Este projeto passou por uma auditoria que encontrou e corrigiu 3 falhas
críticas de autenticação (bypass sem token, senha universal, segredo
JWT hardcoded) — ver o histórico de commits para o detalhamento de cada
correção. Ainda há itens de prioridade alta/média pendentes: regras do
Firestore mais permissivas do que deveriam, e o webhook de WhatsApp sem
validação de assinatura do remetente.
