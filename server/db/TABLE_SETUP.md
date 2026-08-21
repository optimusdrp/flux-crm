# Setup do DynamoDB real (produção)

Este documento existe para o momento em que os testes no Dynalite local
estiverem validados e a equipe decidir migrar para o DynamoDB real da AWS —
ver `server/db/dynalite.ts` para como a troca é feita (variável de ambiente
`DB_MODE`, sem precisar alterar código).

## Como a troca funciona

- **`DB_MODE=dynalite`** (ou variável não definida) — comportamento atual,
  usado durante os testes. Sobe o Dynalite local na porta 4567, cria as
  tabelas automaticamente, roda o seed de dados fictícios a cada boot.
  **Continue usando assim por enquanto.**

- **`DB_MODE=dynamodb`** — aponta o mesmo `docClient` (usado por todas as
  rotas do `server.ts`) para o DynamoDB real da AWS. Não sobe o Dynalite,
  não roda seed automático. Requer:
  1. As 16 tabelas abaixo já criadas no DynamoDB real (comandos nesta página).
  2. `AWS_REGION` definida no ambiente.
  3. Credenciais AWS disponíveis via variáveis de ambiente
     (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), arquivo
     `~/.aws/credentials`, ou IAM role da instância/task — o código usa a
     cadeia de resolução padrão do AWS SDK, não inventa fallback.

Nenhuma rota do `server.ts` precisa mudar: todas importam `docClient` de
`server/db/dynalite.ts`, que decide sozinho qual back-end usar.

## Checklist antes de migrar para produção

- [ ] Todas as tabelas abaixo criadas no DynamoDB real (incluindo o GSI de `ChatMessages`)
- [ ] `JWT_SECRET` definido com um valor forte e único (nunca o fallback de dev — ver `server/auth/authService.ts`)
- [ ] `AWS_REGION` e credenciais AWS configuradas no ambiente de produção
- [ ] Recomendado: a credencial IAM usada pelo projeto restrita só às 16 tabelas listadas abaixo, em vez de acesso irrestrito a todo o DynamoDB da conta (reduz o risco em caso de vazamento da credencial) — exemplo de política:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:*"],
      "Resource": [
        "arn:aws:dynamodb:REGIAO:*:table/Patients",
        "arn:aws:dynamodb:REGIAO:*:table/Patients/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/ChatMessages",
        "arn:aws:dynamodb:REGIAO:*:table/ChatMessages/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/Appointments",
        "arn:aws:dynamodb:REGIAO:*:table/Appointments/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/PriorityRules",
        "arn:aws:dynamodb:REGIAO:*:table/PriorityRules/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/AutomationRules",
        "arn:aws:dynamodb:REGIAO:*:table/AutomationRules/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/EHRIntegrations",
        "arn:aws:dynamodb:REGIAO:*:table/EHRIntegrations/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/AuditLogs",
        "arn:aws:dynamodb:REGIAO:*:table/AuditLogs/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/RolePermissions",
        "arn:aws:dynamodb:REGIAO:*:table/Users",
        "arn:aws:dynamodb:REGIAO:*:table/Users/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/Webhooks",
        "arn:aws:dynamodb:REGIAO:*:table/Webhooks/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/WebhookLogs",
        "arn:aws:dynamodb:REGIAO:*:table/WebhookLogs/index/*",
        "arn:aws:dynamodb:REGIAO:*:table/ClinicSettings",
        "arn:aws:dynamodb:REGIAO:*:table/Clinics",
        "arn:aws:dynamodb:REGIAO:*:table/Subscriptions",
        "arn:aws:dynamodb:REGIAO:*:table/UsageRecords",
        "arn:aws:dynamodb:REGIAO:*:table/WhatsAppSessions"
      ]
    }
  ]
}
```

  Substitua `REGIAO` pela região configurada em `AWS_REGION` (ex.: `us-east-1`).
- [ ] `POST /api/seed` **não** deve ser chamado em produção com dados fictícios — se precisar popular usuários reais da clínica, criar um seed de produção separado (fora do escopo deste documento)
- [ ] Confirmar que `DB_MODE=dynamodb` está definido antes do deploy — sem isso, o servidor volta a tentar subir o Dynalite local, que não deve rodar em produção
- [ ] Conferir a matriz `RolePermissions` em produção: por padrão, nenhum perfil além do Administrador tem as ações granulares `patients.delete`/`patients.merge` concedidas (ver `server/auth/permissions.ts` — `DEFAULT_ROLE_ACTIONS`). Se a operação da clínica exigir que outros perfis também excluam ou unifiquem pacientes, um Administrador precisa conceder isso manualmente pela tela de Configurações → Equipe e Permissões depois do primeiro deploy — não é algo que o seed de produção resolve sozinho.
- [ ] `INTERNAL_OPS_KEY` definida com um valor forte e único — protege as rotas administrativas de billing (`POST /api/billing/clinics`, ativação de pagamento, mudança de plano, cobrança de excedente). Ver `server/auth/requireInternalOps.ts`.
- [ ] `PAYMENT_PROVIDER` decidido e configurado — `"mock"` (o padrão) nunca deve ir para produção real, é só a implementação de referência usada em desenvolvimento (ver `server/billing/providers/`). Escolher e implementar o provedor real (Stripe, Pagar.me, Iugu etc.) é uma decisão de negócio fora do escopo deste documento.

## Comandos de criação das tabelas (AWS CLI)

Rodar uma vez, antes do primeiro deploy com `DB_MODE=dynamodb`. Todos usam
`PAY_PER_REQUEST` (sem provisionar capacidade fixa) — ajustar para
`PROVISIONED` com `--provisioned-throughput` se o time preferir capacidade
fixa por custo previsível.

> Estes comandos espelham exatamente o schema definido em
> `server/db/dynalite.ts` (`createTablesIfNotExist`). Se esse arquivo mudar
> no futuro (nova tabela, novo índice), atualizar este documento junto —
> ele não é gerado automaticamente a partir do código.

### Patients

GSI `clinicId-index` (Fase 1 de Prontidão Comercial) — permite listar só
os pacientes de uma clínica via Query, em vez de Scan na tabela inteira.

```bash
aws dynamodb create-table \
  --table-name Patients \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### ChatMessages

Dois GSIs: `patientId-index` (Fase 5 — sem ele, `GET /api/chat/:patientId`
faz Scan na tabela inteira) e `clinicId-index` (Fase 1 de Prontidão
Comercial — listagens administrativas por clínica, ex. auditoria).

```bash
aws dynamodb create-table \
  --table-name ChatMessages \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "patientId", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "patientId-index", "KeySchema": [{"AttributeName": "patientId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}, {"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### Appointments

```bash
aws dynamodb create-table \
  --table-name Appointments \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### PriorityRules

```bash
aws dynamodb create-table \
  --table-name PriorityRules \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### AutomationRules

```bash
aws dynamodb create-table \
  --table-name AutomationRules \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### EHRIntegrations

```bash
aws dynamodb create-table \
  --table-name EHRIntegrations \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### AuditLogs

```bash
aws dynamodb create-table \
  --table-name AuditLogs \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### RolePermissions

Chave composta `clinicId` + `role` (Fase 1 de Prontidão Comercial) — cada
clínica tem sua própria matriz de permissões, mesmo usando os mesmos
nomes de perfil que outra clínica.

```bash
aws dynamodb create-table \
  --table-name RolePermissions \
  --attribute-definitions '[{"AttributeName": "clinicId", "AttributeType": "S"}, {"AttributeName": "role", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "clinicId", "KeyType": "HASH"}, {"AttributeName": "role", "KeyType": "RANGE"}]' \
  --billing-mode PAY_PER_REQUEST
```

### Users

Tabela criada na Fase 1 — guarda o hash bcrypt da senha (`passwordHash`),
nunca a senha em texto puro. Chave primária é o e-mail (lowercase). GSI
`clinicId-index` (Fase 1 de Prontidão Comercial) lista todos os usuários
de uma clínica, usado pela tela de Equipe e Permissões.

```bash
aws dynamodb create-table \
  --table-name Users \
  --attribute-definitions '[{"AttributeName": "email", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "email", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### Webhooks

```bash
aws dynamodb create-table \
  --table-name Webhooks \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### WebhookLogs

```bash
aws dynamodb create-table \
  --table-name WebhookLogs \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}, {"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --global-secondary-indexes '[{"IndexName": "clinicId-index", "KeySchema": [{"AttributeName": "clinicId", "KeyType": "HASH"}], "Projection": {"ProjectionType": "ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

### ClinicSettings

Chave composta `clinicId` + `category` (Fase 1 de Prontidão Comercial) —
uma linha por categoria de configuração (`channels`, `requiredFields`,
`funnels`) da clínica, cada clínica com a sua própria.

```bash
aws dynamodb create-table \
  --table-name ClinicSettings \
  --attribute-definitions '[{"AttributeName": "clinicId", "AttributeType": "S"}, {"AttributeName": "category", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "clinicId", "KeyType": "HASH"}, {"AttributeName": "category", "KeyType": "RANGE"}]' \
  --billing-mode PAY_PER_REQUEST
```

### Clinics

Tabela criada na Fase 1 de Prontidão Comercial — cada linha é um cliente
pagante do MediFlux. Antes desta tabela, "clínica" não existia como
conceito no sistema; havia uma única operação com o nome escrito
diretamente no código.

```bash
aws dynamodb create-table \
  --table-name Clinics \
  --attribute-definitions '[{"AttributeName": "id", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "id", "KeyType": "HASH"}]' \
  --billing-mode PAY_PER_REQUEST
```

### Subscriptions

Tabela criada na Fase 1 de Prontidão Comercial, com o schema completo
preenchido na Fase 2 — relação 1:1 com Clinics, guarda o plano base e os
add-ons de IA contratados, período de fidelidade, status
(`ativo`/`inadimplente`/`cancelado`), e os identificadores externos do
provedor de pagamento (`externalCustomerId`, `externalSubscriptionId`,
preenchidos na Fase 5).

```bash
aws dynamodb create-table \
  --table-name Subscriptions \
  --attribute-definitions '[{"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "clinicId", "KeyType": "HASH"}]' \
  --billing-mode PAY_PER_REQUEST
```

### UsageRecords

Tabela criada na Fase 4 de Prontidão Comercial — chave composta `clinicId`
+ `periodKey` (formato `"AAAA-MM"`, ex. `"2026-08"`), um registro por
clínica por mês, com contadores de atendimentos novos e de chamadas de
cada um dos 4 endpoints de IA. Separada de Subscriptions de propósito:
uso muda a cada requisição (alta taxa de escrita) e configuração de
plano muda raramente.

```bash
aws dynamodb create-table \
  --table-name UsageRecords \
  --attribute-definitions '[{"AttributeName": "clinicId", "AttributeType": "S"}, {"AttributeName": "periodKey", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "clinicId", "KeyType": "HASH"}, {"AttributeName": "periodKey", "KeyType": "RANGE"}]' \
  --billing-mode PAY_PER_REQUEST
```

### WhatsAppSessions

Guarda só o ESTADO de exibição da conexão real com WhatsApp
(`status`, `connectedNumber`, `updatedAt`) — nunca a autenticação da
sessão em si, que fica em `.wwebjs_auth/` em disco (ver
`server/whatsapp/sessionManager.ts`). Perder esta tabela não compromete
nenhuma sessão de WhatsApp conectada, só a exibição do status até a
próxima sincronização.

```bash
aws dynamodb create-table \
  --table-name WhatsAppSessions \
  --attribute-definitions '[{"AttributeName": "clinicId", "AttributeType": "S"}]' \
  --key-schema '[{"AttributeName": "clinicId", "KeyType": "HASH"}]' \
  --billing-mode PAY_PER_REQUEST
```
## Depois de criar as tabelas

Popular a tabela `Users` com os usuários reais da clínica (não o seed de
demonstração) é uma etapa separada, fora do escopo deste documento — o
seed atual (`server/db/seed.ts`) foi desenhado para dados fictícios de
teste, incluindo CPFs e nomes de pacientes de exemplo que não devem ir
para produção.
