# MediFlux CRM Health — mediflux-dev

CRM de atendimento para clínicas de saúde, com front-end React + Vite +
TypeScript e backend Express + DynamoDB (Dynalite local para
desenvolvimento, DynamoDB real da AWS para produção). Cobre o fluxo
completo de atendimento — caixa de entrada por WhatsApp/Telegram/
Instagram/Site, jornadas em Kanban, triagem clínica assistida por IA,
qualificação de lead, agendamento, indicadores, auditoria LGPD — e
suporta múltiplas clínicas isoladas entre si, cada uma com seu próprio
plano contratado e add-ons de inteligência artificial.

Usa duas IAs externas — Google Gemini e Claude via Amazon Bedrock —
divididas por endpoint conforme o perfil de risco de cada funcionalidade
(ver seção "Providers de IA" abaixo), e um mecanismo de reserva cruzada
entre elas para o sistema continuar respondendo mesmo se uma das duas
falhar.

Este repositório reflete o estado do projeto depois de: uma auditoria de
segurança e as 6 fases de correção que ela gerou; a integração do Amazon
Bedrock como segunda IA; permissões granulares por ação; uma auditoria
completa de interface; as telas de configuração do administrador; a
edição de cadastro de paciente; e as 5 fases de prontidão comercial
(multi-tenancy, planos, restrição de add-ons de IA por contratação,
medição de uso, integração de cobrança). A lista completa de documentos
que detalham cada etapa está em "Documentos de apoio", no fim deste
README.

## Setup rápido (ambiente de testes — Dynalite local)

**Pré-requisito:** Node.js (o `package.json` não fixa uma versão mínima;
qualquer versão LTS recente funciona — testado com Node 22).

```bash
npm install
cp .env.example .env
# editar .env e preencher pelo menos GEMINI_API_KEY e AWS_REGION
# (ver seção "Providers de IA" abaixo para o que cada variável faz)
npm run dev
```

O servidor sobe em `http://localhost:3000`, com o Dynalite local rodando
na porta 4567 e o banco de dados populado automaticamente com dados
fictícios de uma clínica de demonstração (ver `server/db/seed.ts`) — não
é necessário criar nada manualmente para começar a testar.

> **Usando a conexão real de WhatsApp?** Esse setup acima é suficiente
> para todo o resto do sistema, mas a conexão de WhatsApp (Configurações
> → Canais de Atendimento) precisa de um passo extra — ver a seção
> "Conexão real com WhatsApp" mais abaixo antes de tentar conectar.

Se as variáveis de IA não estiverem preenchidas, o sistema continua
funcionando: os endpoints de IA caem no mecanismo de reserva heurística
local em vez de travar (ver "Providers de IA").

### Scripts disponíveis

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o servidor de desenvolvimento (front-end + back-end juntos), com Dynalite local e recarregamento automático. |
| `npm run build` | Gera o build de produção — ver seção "Build de produção" abaixo. |
| `npm start` | Roda o servidor a partir do build já gerado (`dist/server.cjs`) — use depois de `npm run build`, não substitui o `npm run dev` em desenvolvimento. |
| `npm run lint` | Só checa os tipos TypeScript (`tsc --noEmit`), sem gerar nenhum arquivo. |
| `npm run clean` | Remove a pasta `dist/` e qualquer `server.js` residual de builds anteriores. |
| `npm run whatsapp:install-browser` | Baixa o Chromium usado pela conexão real de WhatsApp — necessário rodar uma vez antes de usar essa funcionalidade (ver "Conexão real com WhatsApp" abaixo). |

### Usuários de demonstração

Todos pertencem à clínica fictícia "Clínica Santa Helena", criada
automaticamente pelo seed. As senhas seguem o padrão `<perfil>123` e
estão em texto puro em `server/db/seed.ts` (`SEED_USERS_PLAIN`) — é
esperado num ambiente de demonstração, nunca reaproveitar essas mesmas
senhas em produção.

| E-mail | Perfil | Senha |
|---|---|---|
| `admin@clinicasantahelena.com.br` | Administrador | `admin123` |
| `recepcao@clinicasantahelena.com.br` | Recepção | `recepcao123` |
| `financeiro@clinicasantahelena.com.br` | Contador (financeiro) | `financeiro123` |
| `terceirizado@clinicasantahelena.com.br` | Terceirizado | `terceirizado123` |
| `saude@clinicasantahelena.com.br` | Profissional de Saúde | `saude123` |

Cada perfil vê um subconjunto diferente das 8 telas do sistema — ver
`MediFlux_Permissoes_por_Perfil.html` (nos documentos de apoio) para o
detalhamento completo de quem acessa o quê.

## Variáveis de ambiente

Ver `.env.example` para a lista completa e comentada — copie-o para
`.env` antes de rodar o projeto. As principais:

- `GEMINI_API_KEY` — obrigatória para os endpoints de IA que usam Gemini
  como principal (auto-tag, qualificação de lead, análise de sentimento) e
  como reserva da triagem clínica.
- `AWS_REGION` — obrigatória sempre. Usada pelo Amazon Bedrock (triagem
  clínica) e, se `DB_MODE=dynamodb`, também pelo DynamoDB real. As
  credenciais AWS seguem a cadeia de resolução padrão do SDK (variáveis de
  ambiente, `~/.aws/credentials`, ou IAM role) — não são definidas no `.env`.
- `JWT_SECRET` — obrigatória em produção (`NODE_ENV=production`); o servidor
  recusa subir sem ela. Em desenvolvimento, um fallback inseguro é usado
  automaticamente, só para não travar o primeiro `npm run dev`.
- `DB_MODE` — `dynalite` (padrão) para o banco local de testes, ou
  `dynamodb` para o DynamoDB real da AWS. Ver `server/db/TABLE_SETUP.md`
  para o checklist e os comandos de criação das tabelas antes de usar o
  modo de produção.
- `INTERNAL_OPS_KEY` — protege as rotas administrativas de billing
  (cadastro de clínica, ativação de pagamento, mudança de plano, cobrança
  de excedente) — nunca deve ser exposta a uma clínica cliente. Sem essa
  variável definida, essas rotas ficam bloqueadas por padrão.
- `PAYMENT_PROVIDER` — qual implementação de provedor de pagamento usar
  (ver `server/billing/providers/`). O padrão é `mock`, a implementação
  de referência que não move dinheiro real — nunca deve ir para produção
  real sem trocar para o provedor efetivamente contratado.
- `MOCK_PAYMENT_WEBHOOK_SECRET` — segredo usado só pelo `MockPaymentProvider`
  para assinar/validar webhooks de pagamento simulados.

## Providers de IA

O projeto usa duas IAs, cada endpoint com um provider principal e o outro
como reserva cruzada (ver `server/ai/router.ts`):

| Endpoint | Principal | Reserva |
|---|---|---|
| Triagem clínica (`analyze-message`) | Bedrock — Claude Haiku 4.5 | Gemini |
| Auto-tag, qualificação de lead, sentimento | Gemini | Bedrock |

Se o principal falhar (erro de rede, credencial, cota), o roteador tenta o
outro provider antes de cair no fallback heurístico local — só quando os
dois falham é que a heurística assume.

**Antes de usar o Bedrock em produção**, a credencial IAM usada pelo
projeto precisa ter permissão para `bedrock:InvokeModel` (política
gerenciada `AmazonBedrockLimitedAccess`, ou uma política customizada
restrita aos modelos usados). Modelos Anthropic — como o Claude Haiku 4.5
usado aqui — exigem, além disso, um formulário de "First Time Use" da
Anthropic preenchido uma única vez por conta AWS: abra o modelo no
Playground do console do Bedrock e envie uma mensagem de teste, o que
dispara o formulário automaticamente. A antiga página "Model access" foi
descontinuada pela AWS em outubro de 2025 — não é mais necessário
liberar cada modelo manualmente ali. Confirme também que a inference
profile `us.anthropic.claude-haiku-4-5-20251001-v1:0` está disponível na
região configurada em `AWS_REGION`.

## Build de produção

```bash
npm run build
npm start
```

`npm run build` gera `dist/index.html` + `dist/assets/*` (front-end
estático) e `dist/server.cjs` (backend empacotado num único arquivo,
sem depender de `node_modules` além dos pacotes marcados como externos).
`npm start` sobe esse build já gerado — é o comando a usar em produção,
não `npm run dev` (que é só para desenvolvimento local, com
recarregamento automático).

Antes de rodar em produção de verdade, configurar `NODE_ENV=production`,
`DB_MODE=dynamodb` e as demais variáveis de ambiente cobertas acima —
ver também `server/db/TABLE_SETUP.md` para o checklist específico de
migração para o DynamoDB real.

## Estrutura do front-end

```
src/
  components/
    (arquivos soltos: widgets de IA usados dentro das telas — AutoTaggingWidget,
    LeadQualifierWidget, LeadSimulatorModal, PatientEditForm, entre outros)
    auth/        tela de login e componentes de autenticação
    common/      componentes reutilizáveis (tour guiado, etc.)
    landing/     página institucional pública (sem login)
    layout/      cabeçalho, menu lateral e estrutura geral do CRM
    settings/    as 4 telas de configuração implementadas (canais, campos
                 obrigatórios, jornadas/funis, integrações)
    views/       as 8 telas principais do CRM (uma por aba do menu)
  context/       AuthContext (sessão do usuário) e demais contextos React
  data/          dados de exemplo usados como fallback/preview na interface
  services/      apiService (chamadas HTTP ao backend) e authFetch
  types/         tipos TypeScript compartilhados entre componentes
```

## Estrutura do backend

```
server/
  ai/           providers de IA (Gemini + Bedrock) e o roteador que decide qual usar por endpoint
  auth/         autenticação (bcrypt + JWT), middlewares de RBAC (por tela, ação
                granular e add-on de IA contratado) e rate limiting
  billing/      catálogo de planos/add-ons, assinatura por clínica, medição de
                uso mensal, e a integração de cobrança (ver "Prontidão comercial" abaixo)
  clinical/     guardrails de triagem clínica por IA
  db/           conexão Dynalite/DynamoDB e seed de dados
  patients/     detecção de pacientes duplicados e lógica de mesclagem
  routes/       rotas da API organizadas por domínio
  security/     defesa de SSRF e sanitização de prompt injection
  validation/   whitelists de campos editáveis por entidade
server.ts       ponto de entrada — bootstrap do servidor e montagem dos routers
```

Todas as rotas da API vivem em `server/routes/` — nenhuma rota HTTP é
declarada diretamente em `server.ts`.

## Permissões granulares por ação

Além do controle de acesso por tela (`CRMTab`), o sistema tem um segundo
nível de permissão para ações destrutivas específicas, independente de
qual tela o usuário acessa — hoje cobre exclusão e unificação de
pacientes. Por padrão, só o Administrador tem essas ações; qualquer outro
perfil precisa que um Administrador conceda pela tela de Configurações →
Equipe e Permissões (bloco "Ações Sensíveis"). Ver `server/auth/permissions.ts`
(`PermissionAction`, `DEFAULT_ROLE_ACTIONS`) e o middleware `requireAction`
em `server/auth/requireTab.ts`.

## Unificação de pacientes duplicados

Tela de detecção (por CPF, telefone ou nome parecido) e mesclagem
acessível a quem tem a ação `patients.merge` — botão "Ver Pacientes
Duplicados" na tela de Configurações. A escolha de qual registro vira o
principal é sempre feita pelo usuário, nunca automática. Uma limitação
conhecida: agendamentos não são reatribuídos automaticamente na
mesclagem, porque a tabela `Appointments` só guarda o nome do paciente em
texto livre, não uma referência real — fica sinalizado na resposta da API
para revisão manual.

## Telas de configuração (Administrador)

Todas as áreas da tela de Configurações têm persistência real no backend
(nenhuma é decorativa):

- **Canais de atendimento** — ativa/desativa WhatsApp, Telegram,
  Instagram e Site individualmente, com mensagem de boas-vindas, mensagem
  fora do horário, e janela de atendimento (horário + dias da semana) por
  canal. O canal WhatsApp tem, além disso, uma conexão real (ver seção
  "Conexão real com WhatsApp" abaixo).
- **Campos obrigatórios** — por etapa do funil, quais campos do paciente
  e quais itens de checklist são exigidos, e se a ausência deles bloqueia
  o avanço de etapa.
- **Jornadas e funis** — cria, renomeia e remove funis; adiciona,
  remove e reordena as etapas (colunas do Kanban) de cada um.
- **Integrações (Prontuários & TISS)** — endpoint, credencial de acesso
  (nunca reexibida em texto puro, só os últimos 4 caracteres),
  direção/frequência de sincronização, quais entidades sincronizar, e
  configuração TISS/TUSS (código ANS, versão TUSS, geração automática de
  guia) para a integração de faturamento.

Backend em `server/routes/clinicSettings.ts` (canais, campos, funis — uma
linha por categoria na tabela `ClinicSettings`) e `server/routes/ehr.ts`
(integrações, estendendo a tabela `EHRIntegrations` já existente).

## Conexão real com WhatsApp

O canal WhatsApp, dentro de Configurações → Canais de Atendimento, tem
uma conexão de verdade via [`whatsapp-web.js`](https://wwebjs.dev/) —
diferente dos demais canais (Telegram, Instagram, Site), que hoje só
guardam um identificador de texto livre para exibição. Fluxo: clicar em
"Conectar WhatsApp" gera um QR code na tela; escanear com **WhatsApp →
Aparelhos conectados → Conectar um aparelho** no celular da clínica
autentica a sessão, que passa a receber as mensagens reais desse número.

**Como testar localmente:**

```bash
npm install                       # não baixa o Chromium (ver nota abaixo)
npm run whatsapp:install-browser  # baixa o Chromium usado pela conexão de WhatsApp
npm run dev
```

O segundo passo só é necessário uma vez (ou de novo se a pasta
`node_modules` for recriada). Sem ele, tudo o resto do sistema funciona
normalmente — só a conexão de WhatsApp falha ao clicar em "Conectar",
com uma mensagem de erro clara em vez de travar o servidor.

Depois de conectar pela primeira vez, a sessão fica salva em
`.wwebjs_auth/` (nunca deve ir para controle de versão — já coberto pelo
`.gitignore` — nem para backup sem criptografia, equivale à senha do
WhatsApp da clínica). Reiniciar o servidor não exige escanear o QR code
de novo, a sessão salva é reaproveitada automaticamente.

**Por que o `npm install` não baixa o Chromium automaticamente:** este
projeto usa `ignore-scripts=true` no `.npmrc` (ver esse arquivo para a
explicação completa) — desabilita os scripts de instalação de toda
dependência, incluindo o `postinstall` do Puppeteer, que tenta baixar o
Chromium sozinho durante o `npm install`. Esse script tem um problema
real: ele carrega uma cadeia de dependências (`cosmiconfig` →
`parse-json` → `error-ex` → `is-arrayish`) só para descobrir se deve ou
não pular o download — e, em ambientes com qualquer instabilidade de
instalação (comum no Windows, com antivírus ou OneDrive sincronizando a
pasta do projeto), essa cadeia pode ficar incompleta e quebrar o
`npm install` inteiro com um erro tipo `Cannot find module
'is-arrayish'`, mesmo sem nenhuma relação com o código do MediFlux em
si. Rodar a instalação do navegador como um passo explícito
(`npm run whatsapp:install-browser`) evita essa classe inteira de falha.

**Se preferir usar um Chrome/Chromium já instalado no sistema** em vez
de baixar um novo: defina `PUPPETEER_EXECUTABLE_PATH` no `.env` (ver
`.env.example`) e pule o passo `whatsapp:install-browser`.

**Arquitetura:** diferente do resto do backend (rotas HTTP sem estado),
uma conexão de WhatsApp é um processo de longa duração — um Chromium
headless por clínica conectada, mantido em memória do processo Node (ver
`server/whatsapp/sessionManager.ts`). Rotas em
`server/routes/whatsappConnection.ts`:

| Rota | O que faz |
|---|---|
| `POST /api/whatsapp/connect` | Inicia a sessão e começa a gerar o QR code (resposta imediata, não espera o Chromium subir). |
| `GET /api/whatsapp/status` | Consultado em polling pelo front-end (a cada 2s) — status atual, QR code (se pendente), número conectado. |
| `POST /api/whatsapp/disconnect` | Encerra a sessão de verdade (`client.logout()`), não é reversível sem escanear um novo QR code. |

Mesma proteção de acesso da tela de Configurações (`requireTab("configuracoes")`)
— conectar/desconectar equivale a controlar o WhatsApp real da clínica,
tratado com o mesmo cuidado de uma credencial de integração EHR.

O estado de exibição (status, número conectado) fica na tabela
`WhatsAppSessions`; a autenticação da sessão em si nunca vai para o banco
de dados, só para `.wwebjs_auth/` em disco.

### Sincronização de mensagens recebidas

Toda mensagem recebida no número conectado aparece automaticamente na
Caixa de Entrada de Atendimentos — sem precisar de nenhuma ação manual.

**Como funciona:** `server/whatsapp/sessionManager.ts` escuta o evento
`message` do client conectado e delega para
`server/whatsapp/messageSync.ts`, que:

1. Ignora mensagens de grupo (`@g.us`) e mensagens enviadas pela própria
   clínica pelo celular (`fromMe: true`) — só processa mensagens novas
   de pacientes.
2. Formata o número de telefone no mesmo padrão usado pelo resto do
   sistema (`(11) 98765-0000`).
3. Busca um paciente existente com esse telefone, na clínica dona da
   sessão — se não encontrar, cria um novo, com o nome vindo do perfil
   do WhatsApp do contato (`pushname`).
4. Grava a mensagem em `ChatMessages` e atualiza `lastMessage`/`lastMessageTime`/`unreadCount`
   do paciente.

**Como a interface fica sabendo:** como a mensagem é gravada diretamente
no banco de dados pelo processo do WhatsApp — fora do ciclo normal de
requisição HTTP de um usuário — a tela de Atendimentos não tem como
"saber" que algo novo chegou sem perguntar de novo. `AtendimentosView.tsx`
consulta a lista de pacientes e a conversa aberta a cada 8 segundos
(polling), o suficiente para uma mensagem nova aparecer em tempo quase
real sem sobrecarregar o servidor.

## Edição de cadastro de paciente

A aba "Dados" do chat de atendimento (em Atendimentos) deixou de ser
somente leitura. Um Administrador ou qualquer perfil com acesso a
Atendimentos/Jornadas pode editar nome, telefone, CPF, data de
nascimento, convênio, plano e especialidade — com validação de campos
obrigatórios e formato antes de salvar. Antes, essa tela só exibia os
dados (inclusive um CPF de exemplo fixo quando o paciente não tinha um
cadastrado, o que podia confundir); a API (`PUT /api/patients/:id`) já
suportava essa edição, só faltava a interface.

Componente em `src/components/PatientEditForm.tsx`, usado tanto na
variante desktop (painel completo) quanto na mobile (painel resumido,
menos campos) da mesma aba.

## Prontidão comercial (multi-tenancy, planos e cobrança)

O sistema deixou de ser mono-cliente e passou a suportar múltiplas
clínicas isoladas entre si, cada uma com seu próprio plano contratado,
add-ons de IA, medição de uso e assinatura de pagamento. Implementado em
5 fases sequenciais (ver `MediFlux_Plano_Prontidao_Comercial.docx` para o
detalhamento completo):

**1 — Multi-tenancy.** As 15 tabelas do DynamoDB (12 originais + `Clinics`,
`Subscriptions` e `UsageRecords`) são filtradas por `clinicId`, propagado
pelo JWT desde o login. Toda rota que busca por ID confirma que o
registro pertence à clínica do usuário autenticado antes de devolver ou
alterar qualquer dado (proteção contra IDOR). Identidade visual (nome da
clínica) vem da sessão, não mais fixa no código.

**2 — Plano e assinatura.** `server/billing/planCatalog.ts` é a fonte
única de verdade dos preços (espelha o documento comercial); `server/billing/subscriptionService.ts`
expõe `getClinicSubscription(clinicId)`, consultada por qualquer parte
do sistema que precise saber o que a clínica contratou. Cadastro de
clínica via `POST /api/billing/clinics`, restrito a uma chave de operação
interna (`INTERNAL_OPS_KEY`) — decisão de produto: mudança de plano
passa pelo time interno, nunca é self-service pela própria clínica.

**3 — Feature gating.** Middleware `requireFeature(addOnId)`
(`server/auth/requireFeature.ts`) aplicado aos 4 endpoints de IA —
diferente de `requireTab`/`requireAction`, aqui nem o Administrador da
clínica passa automaticamente: a restrição é sobre o que a clínica pagou,
não sobre quem está logado.

**4 — Medição de uso.** Tabela `UsageRecords` (um registro por clínica
por mês) conta atendimentos novos e chamadas de cada add-on de IA.
`GET /api/billing/usage` expõe o consumo do mês corrente. Limite de
atendimentos do plano nunca bloqueia a criação de um atendimento — só
sinaliza excedente na resposta, para cobrança posterior. Rate limiting
de 30 chamadas de IA por minuto por clínica (`server/auth/rateLimiters.ts`).

**5 — Integração de cobrança.** Interface `PaymentProvider`
(`server/billing/providers/`) desacopla o sistema de qualquer provedor
específico — a escolha de qual usar (Stripe, Pagar.me, Iugu etc.) é uma
decisão de negócio fora do escopo técnico. `MockPaymentProvider` é a
implementação de referência usada em desenvolvimento. Webhook
(`POST /api/billing/webhook`) processa eventos de pagamento com
validação de assinatura HMAC obrigatória. Inadimplência bloqueia só os
add-ons de IA (via o mesmo mecanismo da Fase 3), nunca a base do sistema.

## Documentos de apoio

Entregues junto com este repositório (não fazem parte do código, são
material de auditoria/planejamento/comercial):

- `MediFlux_Relatorio_Final.docx` — relatório executivo de toda a
  auditoria de segurança, as 6 fases de correção, a integração do
  Bedrock, permissões granulares, auditoria de interface, telas de
  configuração, edição de cadastro de paciente, e as 5 fases de
  prontidão comercial.
- `MediFlux_Plano_Prontidao_Comercial.docx` — relato detalhado de cada
  uma das 5 fases de prontidão comercial (multi-tenancy, plano e
  assinatura, feature gating, medição de uso, integração de cobrança),
  com a evidência de teste específica de cada uma.
- `MediFlux_Plano_Validacao_Final.docx` — o que ainda falta validar com
  ambiente e credenciais reais antes do primeiro uso com pacientes de
  verdade (chave de IA real, banco de produção, provedor de pagamento
  real, piloto controlado).
- `MediFlux_Analise_Custos_e_Planos.docx` — a análise de custo de
  infraestrutura por chamada de IA e a estrutura comercial (planos base +
  add-ons) que `server/billing/planCatalog.ts` implementa.
- `MediFlux_Mapa_de_Arquivos.html` — documento interativo com a
  explicação de cada arquivo do projeto, organizados por pasta (abrir no
  navegador).
- `MediFlux_Arquitetura_Completa.html` — diagramas interativos de como
  front-end, back-end, banco de dados e as duas IAs se conectam (abrir
  no navegador).
- `MediFlux_Correcoes_Seguranca_Interativo.html` — diagramas dos
  principais fluxos de segurança implementados (abrir no navegador).
- `MediFlux_Permissoes_por_Perfil.html` — o que cada um dos 5 perfis de
  usuário pode e não pode acessar, tela por tela e ação por ação (abrir
  no navegador).
- `MediFlux_Checklist_Testes_Completo.html` — checklist interativo com
  313 passos de teste manual, da instalação a um atendimento real
  completo, incluindo a camada de prontidão comercial (abrir no
  navegador).
- `server/db/TABLE_SETUP.md` — comandos para provisionar as 15 tabelas
  do DynamoDB real antes de migrar para produção.
