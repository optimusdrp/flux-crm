import dynalite from 'dynalite';
import {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// ---------------------------------------------------------------------------
// Fase 6 — Dynalite (teste) vs DynamoDB real (produção), lado a lado
//
// Os dois modos ficam configurados ao mesmo tempo neste módulo; a troca é
// feita só por variável de ambiente, sem tocar em nenhuma rota do
// server.ts — todas as ~35 rotas importam `docClient` daqui e nunca sabem
// (nem precisam saber) se estão falando com o Dynalite local ou com o
// DynamoDB real da AWS.
//
// DB_MODE=dynalite (ou não definido) -> comportamento atual, sem mudança
//   nenhuma: sobe o Dynalite local na porta 4567, cria as tabelas, roda o
//   seed. Continue usando assim durante os testes.
//
// DB_MODE=dynamodb -> aponta para o DynamoDB real da AWS. Requer as
//   variáveis de ambiente AWS_REGION, AWS_ACCESS_KEY_ID e
//   AWS_SECRET_ACCESS_KEY (ou credenciais via IAM role, se rodando em
//   infra AWS) já configuradas no ambiente — este módulo não inventa
//   fallback de credencial para esse modo. As tabelas (incluindo o GSI
//   patientId-index da Fase 5) precisam existir previamente no DynamoDB
//   real; TABLE_SETUP.md neste mesmo diretório documenta como criá-las.
//
// Quando estiver tudo testado e validado no Dynalite, a troca para
// produção é: definir DB_MODE=dynamodb (+ credenciais AWS) e não rodar
// initDynaliteDatabase() no startup — ver server.ts, que já checa DB_MODE
// antes de decidir se sobe o Dynalite local ou não.
// ---------------------------------------------------------------------------

const DYNALITE_PORT = 4567;
let dynaliteServer: any = null;

export type DbMode = "dynalite" | "dynamodb";

export function getDbMode(): DbMode {
  return process.env.DB_MODE === "dynamodb" ? "dynamodb" : "dynalite";
}

function buildRawClient(): DynamoDBClient {
  if (getDbMode() === "dynamodb") {
    // DynamoDB real: usa a cadeia de resolução de credenciais padrão do
    // AWS SDK (variáveis de ambiente, arquivo ~/.aws/credentials, ou IAM
    // role da instância/task) — nenhuma credencial fake ou hardcoded aqui.
    // AWS_REGION é obrigatória; sem ela o SDK lança erro explícito na
    // primeira chamada, o que é o comportamento correto (fail loud).
    return new DynamoDBClient({
      region: process.env.AWS_REGION,
    });
  }

  // Dynalite local (padrão atual, usado durante os testes).
  return new DynamoDBClient({
    endpoint: `http://localhost:${DYNALITE_PORT}`,
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'fake',
      secretAccessKey: 'fake',
    },
  });
}

export const rawDbClient = buildRawClient();

export const docClient = DynamoDBDocumentClient.from(rawDbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export async function initDynaliteDatabase() {
  if (getDbMode() === "dynamodb") {
    // Fase 6: em modo DynamoDB real, não subimos o servidor local nem
    // recriamos tabelas automaticamente — presume-se que a infraestrutura
    // (tabelas, índices, permissões IAM) já foi provisionada previamente
    // (ex.: via Terraform/CloudFormation/console AWS), do mesmo jeito que
    // já é feito no restante do ecossistema AWS do projeto (Cheleon ERP,
    // ms-crm-agent). Rodar CreateTableCommand contra produção a cada boot
    // do servidor seria arriscado e foge do padrão já adotado.
    console.log('[DynamoDB] DB_MODE=dynamodb — usando DynamoDB real da AWS, tabelas devem já existir.');
    return;
  }

  return new Promise<void>((resolve, reject) => {
    if (dynaliteServer) {
      return resolve();
    }

    dynaliteServer = dynalite({ createTableMs: 0 });
    dynaliteServer.listen(DYNALITE_PORT, async (err: any) => {
      if (err) {
        console.error('[Dynalite DynamoDB] Error starting local database server:', err);
        return reject(err);
      }
      console.log(`[Dynalite DynamoDB] Local DynamoDB server listening on port ${DYNALITE_PORT}`);

      try {
        await createTablesIfNotExist();
        resolve();
      } catch (setupErr) {
        console.error('[Dynalite DynamoDB] Error creating tables:', setupErr);
        reject(setupErr);
      }
    });
  });
}

async function createTablesIfNotExist() {
  const existingTablesResponse = await rawDbClient.send(new ListTablesCommand({}));
  const existingTables = existingTablesResponse.TableNames || [];

  const tablesToCreate = [
    {
      // Fase 1 de Prontidão Comercial: GSI clinicId-index — permite listar
      // só os pacientes de uma clínica (Query) em vez de Scan na tabela
      // inteira filtrando em memória, que vazaria dados de outras clínicas
      // até o filtro ser aplicado.
      TableName: 'Patients',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      // Fase 5: GSI em patientId — antes, GET /api/chat/:patientId fazia
      // Scan na tabela INTEIRA (todas as mensagens de todos os pacientes)
      // e filtrava em memória. Com o índice, a busca vira Query direto por
      // paciente, o pior caso passa de O(total de mensagens do sistema)
      // para O(mensagens daquele paciente).
      // Fase 1 de Prontidão Comercial: segundo GSI em clinicId, para
      // listagens administrativas por clínica (ex.: auditoria) sem
      // precisar passar por paciente — o índice por paciente continua
      // sendo o caminho usado no chat em si, este é complementar.
      TableName: 'ChatMessages',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'patientId', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'patientId-index',
          KeySchema: [{ AttributeName: 'patientId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      TableName: 'Appointments',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      TableName: 'PriorityRules',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      TableName: 'AutomationRules',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      TableName: 'EHRIntegrations',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      TableName: 'AuditLogs',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      TableName: 'RolePermissions',
      // Fase 1 de Prontidão Comercial: chave composta clinicId+role — antes
      // só 'role' era a chave, o que fazia sentido para uma única clínica,
      // mas duas clínicas diferentes precisam de matrizes de permissão
      // independentes para o mesmo nome de perfil (o "Recepção" da Clínica
      // A não deve herdar nem afetar o "Recepção" da Clínica B).
      KeySchema: [
        { AttributeName: 'clinicId', KeyType: 'HASH' },
        { AttributeName: 'role', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'clinicId', AttributeType: 'S' },
        { AttributeName: 'role', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
      // Fase 1: tabela real de usuários, substitui o USER_DIRECTORY hardcoded.
      // Chave primária é o e-mail (lowercase, normalizado no momento do login/seed).
      // Fase 1 de Prontidão Comercial: e-mail continua sendo a chave (login
      // busca direto por e-mail, sem precisar saber a clínica de antemão)
      // — clinicId vira um atributo comum, com um GSI para listar todos os
      // usuários de uma clínica (usado pela tela de Equipe e Permissões).
      TableName: 'Users',
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'email', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      TableName: 'Webhooks',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      TableName: 'WebhookLogs',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'clinicId', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      GlobalSecondaryIndexes: [
        {
          IndexName: 'clinicId-index',
          KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    },
    {
      // Implementação das telas de configuração antes só decorativas:
      // Canais de Atendimento, Campos Obrigatórios e Jornadas & Funis.
      // Uma linha por categoria de configuração da clínica (chave
      // "category": "channels" | "requiredFields" | "funnels"), em vez de
      // três tabelas separadas — são todos dados de configuração singleton
      // por clínica, sem necessidade de consulta relacional entre eles.
      // Fase 1 de Prontidão Comercial: chave composta clinicId+category —
      // cada clínica precisa da sua própria configuração de canais/campos/
      // funis, independente das demais.
      TableName: 'ClinicSettings',
      KeySchema: [
        { AttributeName: 'clinicId', KeyType: 'HASH' },
        { AttributeName: 'category', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'clinicId', AttributeType: 'S' },
        { AttributeName: 'category', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
      // Fase 1 de Prontidão Comercial: entidade Clínica — cada linha é um
      // cliente pagante do MediFlux. Antes desta tabela, "clínica" não
      // existia como conceito no sistema; havia uma única operação
      // (Clínica Santa Helena) com o nome escrito diretamente no código.
      TableName: 'Clinics',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
      // Fase 1 de Prontidão Comercial: relação 1:1 com Clinics — guarda o
      // plano base e os add-ons de IA contratados. O schema completo dos
      // campos (plano, add-ons, período de fidelidade, status) é
      // preenchido na Fase 2 (Modelo de plano e assinatura); a tabela já
      // nasce aqui porque outras partes do sistema precisam conseguir
      // gravar nela desde já (ex.: criar uma clínica nova já grava uma
      // linha inicial, mesmo que só com um plano padrão).
      TableName: 'Subscriptions',
      KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'clinicId', AttributeType: 'S' }],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
      // Fase 4 de Prontidão Comercial: um registro por clínica por mês
      // (chave composta clinicId + periodKey, ex.: "2026-08"), com
      // contadores de atendimentos novos e de chamadas de cada um dos 4
      // endpoints de IA. Separada de Subscriptions de propósito: uso
      // muda a cada requisição (alta taxa de escrita) e configuração de
      // plano muda raramente — misturar as duas na mesma linha geraria
      // contenção de escrita desnecessária sobre o dado de configuração.
      TableName: 'UsageRecords',
      KeySchema: [
        { AttributeName: 'clinicId', KeyType: 'HASH' },
        { AttributeName: 'periodKey', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'clinicId', AttributeType: 'S' },
        { AttributeName: 'periodKey', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
      // Conexão real com WhatsApp via whatsapp-web.js — um registro por
      // clínica, guardando só o ESTADO da conexão (status, QR code
      // pendente, número conectado, timestamps). A autenticação de fato
      // (o par de chaves da sessão do WhatsApp Web) fica em disco, fora
      // do banco — ver server/whatsapp/sessionManager.ts — porque
      // whatsapp-web.js (via LocalAuth) já persiste isso como arquivos, e
      // duplicar em DynamoDB só aumentaria a superfície de risco sem
      // necessidade.
      TableName: 'WhatsAppSessions',
      KeySchema: [{ AttributeName: 'clinicId', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'clinicId', AttributeType: 'S' }],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
  ];

  for (const tableConfig of tablesToCreate) {
    if (!existingTables.includes(tableConfig.TableName)) {
      await rawDbClient.send(new CreateTableCommand(tableConfig as any));
      console.log(`[Dynalite DynamoDB] Created table '${tableConfig.TableName}'`);
    }
  }
}
