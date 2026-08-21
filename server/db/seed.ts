import { docClient } from './dynalite';
import { PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { hashPassword } from '../auth/authService';

// ---------------------------------------------------------------------------
// Fase 1 de Prontidão Comercial: a "Clínica Santa Helena" que todo o seed
// deste arquivo descreve deixou de ser a única clínica possível no sistema
// — agora é a primeira linha real da tabela Clinics, com um id fixo e
// previsível para o ambiente de testes. Todo item seedado (pacientes,
// usuários, permissões, configurações etc.) grava esse clinicId, para o
// sistema conseguir subir e logar normalmente em modo Dynalite depois da
// mudança de schema.
// ---------------------------------------------------------------------------
export const SEED_CLINIC_ID = 'clinic_santa_helena';

export const SEED_CLINIC = {
  id: SEED_CLINIC_ID,
  name: 'Clínica Santa Helena',
  unit: 'Unidade Jardins',
  createdAt: new Date().toISOString(),
};

// Fase 2 de Prontidão Comercial: schema completo agora em uso — antes só
// tinha planBase/addOns/status como placeholder da Fase 1. A clínica seed
// nasce no plano mais completo (Corporativo + os 4 add-ons de IA), para
// não bloquear nenhum teste manual em ambiente de desenvolvimento por
// falta de add-on contratado.
export const SEED_SUBSCRIPTION = {
  clinicId: SEED_CLINIC_ID,
  planBase: 'corporativo',
  addOns: ['qualificacao_lead', 'analise_sentimento', 'classificacao_automatica', 'triagem_clinica'],
  fidelityPeriod: 'anual',
  status: 'ativo',
  startedAt: new Date().toISOString(),
};

export const SEED_PATIENTS = [
  {
    id: 'p1',
    name: 'Ana Luíza Vasconcelos',
    phone: '(11) 98765-4321',
    insurance: 'Bradesco Saúde',
    planType: 'Topázio Nacional',
    cpf: '321.654.987-00',
    birthDate: '14/05/1988',
    status: 'pendente',
    stage: 'documentos',
    urgency: 'alta',
    lastMessage: 'Qual o valor do ecocardiograma caso o meu convênio não cubra totalmente?',
    lastMessageTime: '1h45',
    unreadCount: 1,
    assignedTo: 'Camila',
    slaWarning: 'Ação da clínica pendente há 1h45. O paciente fez uma pergunta. Meta de resposta: 30 minutos.',
    channel: 'WhatsApp',
    nextAction: 'Responder dúvida de cobertura',
    checklist: [
      { id: 'c1', label: 'Carteirinha validada', completed: true },
      { id: 'c2', label: 'Elegibilidade conferida', completed: true },
      { id: 'c3', label: 'Registrar condição informada', completed: false },
    ],
    internalNotes: [
      'Paciente prefere atendimento no período da tarde (Mariana Costa - Hoje, 10:20)',
    ],
    ehrSynced: true,
    ehrSystem: 'iClinic',
    ehrRecordId: 'PEP-2025-0892',
  },
  {
    id: 'p2',
    name: 'Carlos Eduardo Mendes',
    phone: '(11) 97123-8844',
    insurance: 'Particular',
    planType: 'Consulta Especializada',
    cpf: '189.445.672-11',
    birthDate: '22/11/1982',
    status: 'atendimento',
    stage: 'proposta',
    urgency: 'media',
    lastMessage: 'Vocês parcelam em quantas vezes sem juros para implante dentário?',
    lastMessageTime: '38min',
    unreadCount: 0,
    assignedTo: 'Mariana',
    channel: 'WhatsApp',
    nextAction: 'Enviar tabela de parcelamento e orçamento',
    checklist: [
      { id: 'c1', label: 'Anamnese preenchida', completed: true },
      { id: 'c2', label: 'Orçamento gerado', completed: true },
      { id: 'c3', label: 'Confirmação financeira', completed: false },
    ],
    internalNotes: ['Interesse em facetas de porcelana e implante'],
    ehrSynced: true,
    ehrSystem: 'Feegow',
    ehrRecordId: 'PEP-2025-1102',
  },
  {
    id: 'p3',
    name: 'Fernanda Lima Rocha',
    phone: '(11) 96543-2109',
    insurance: 'SulAmérica',
    planType: 'Exato 100',
    cpf: '455.990.123-88',
    birthDate: '03/09/1991',
    status: 'pendente',
    stage: 'triagem',
    urgency: 'media',
    lastMessage: 'Guia de ressonância ainda não foi autorizada pelo convênio?',
    lastMessageTime: '3d',
    unreadCount: 0,
    assignedTo: 'Fernanda',
    channel: 'WhatsApp',
    nextAction: 'Verificar portal SulAmérica TISS',
    checklist: [
      { id: 'c1', label: 'Pedido médico anexado', completed: true },
      { id: 'c2', label: 'Solicitação TISS enviada', completed: true },
      { id: 'c3', label: 'Retorno para paciente', completed: false },
    ],
    internalNotes: ['Aguardando liberação de senha de autorização'],
    ehrSynced: true,
    ehrSystem: 'HiDoctor',
    ehrRecordId: 'PEP-2025-0441',
  },
  {
    id: 'p4',
    name: 'João Victor',
    phone: '(11) 95544-3322',
    insurance: 'Bradesco Saúde',
    planType: 'Perfil Flex',
    cpf: '221.778.334-09',
    birthDate: '19/02/1995',
    status: 'agendado',
    stage: 'agendado',
    urgency: 'baixa',
    lastMessage: 'Consigo agendar para semana que vem a consulta de canal?',
    lastMessageTime: 'Ontem',
    assignedTo: 'Camila',
    channel: 'WhatsApp',
    checklist: [
      { id: 'c1', label: 'Horário selecionado', completed: true },
      { id: 'c2', label: 'Lembrete automático programado', completed: true },
    ],
    ehrSynced: true,
    ehrSystem: 'iClinic',
    ehrRecordId: 'PEP-2025-0990',
  },
  {
    id: 'p5',
    name: 'Beatriz Alves',
    phone: '(11) 94433-2211',
    insurance: 'Unimed',
    status: 'pendente',
    stage: 'triagem',
    urgency: 'media',
    lastMessage: 'Olá, gostaria de saber se atendem Unimed para ortodontia.',
    lastMessageTime: '1h20',
    assignedTo: 'Camila',
    channel: 'WhatsApp',
    checklist: [{ id: 'c1', label: 'Triagem inicial', completed: true }],
    ehrSynced: false,
  },
  {
    id: 'p6',
    name: 'Marta Silva',
    phone: '(11) 93322-1100',
    insurance: 'Amil',
    status: 'atendimento',
    stage: 'documentos',
    urgency: 'baixa',
    lastMessage: 'Enviei a foto da carteirinha e o pedido do clínico.',
    lastMessageTime: '28min',
    assignedTo: 'Mariana',
    channel: 'Telegram',
    checklist: [{ id: 'c1', label: 'Documentação recebida', completed: true }],
    ehrSynced: true,
    ehrSystem: 'TOTVS',
  },
  {
    id: 'p7',
    name: 'Juliana Rocha',
    phone: '(11) 92211-0099',
    insurance: 'Particular',
    status: 'agendado',
    stage: 'agendado',
    urgency: 'baixa',
    lastMessage: 'Confirmado para hoje às 09:00 para clareamento dental.',
    lastMessageTime: 'Hoje, 08:30',
    assignedTo: 'Dra. Juliana',
    channel: 'WhatsApp',
    checklist: [{ id: 'c1', label: 'Confirmado via IA', completed: true }],
    ehrSynced: true,
    ehrSystem: 'iClinic',
  },
];

export const SEED_MESSAGES = [
  {
    id: 'm1',
    patientId: 'p1',
    sender: 'patient',
    text: 'Olá! Vocês aceitam Bradesco Saúde para consulta de cardiologia e exames?',
    timestamp: '10:05',
  },
  {
    id: 'm2',
    patientId: 'p1',
    sender: 'attendant',
    senderName: 'Camila Santos',
    text: 'Olá, Ana! Aceitamos sim. Para verificar sua cobertura, poderia enviar uma foto da carteirinha?',
    timestamp: '10:06',
  },
  {
    id: 'm3',
    patientId: 'p1',
    sender: 'patient',
    text: 'Carteirinha anexada:',
    timestamp: '10:12',
    attachment: {
      type: 'card',
      title: 'Carteirinha identificada',
      subtitle: 'Plano Topázio Nacional • Elegibilidade confirmada com Bradesco TISS',
      verified: true,
    },
  },
  {
    id: 'm4',
    patientId: 'p1',
    sender: 'patient',
    text: 'Qual o valor do ecocardiograma caso o meu convênio não cubra totalmente?',
    timestamp: '10:32',
  },
  {
    id: 'm5',
    patientId: 'p1',
    sender: 'ai',
    senderName: 'Sugestão da IA (MediFlux Copilot)',
    text: 'O valor particular do ecocardiograma é R$ 380,00. Também podemos verificar se há cobertura parcial ou possibilidade de reembolso pelo seu plano Bradesco Topázio.',
    timestamp: 'Agora',
  },
];

export const SEED_APPOINTMENTS = [
  {
    id: 'a1',
    time: '09:00',
    duration: '30 min',
    patientName: 'Juliana Rocha',
    procedure: 'Clareamento dental',
    status: 'Confirmado',
  },
  {
    id: 'a2',
    time: '10:30',
    duration: '60 min',
    patientName: 'Thiago Ferreira',
    procedure: 'Implante dentário',
    status: 'Confirmado',
  },
  {
    id: 'a3',
    time: '14:00',
    duration: '45 min',
    patientName: 'Mariana Costa',
    procedure: 'Avaliação ortodôntica',
    status: 'Confirmado',
  },
  {
    id: 'a4',
    time: '15:30',
    duration: '30 min',
    patientName: 'Carlos Eduardo',
    procedure: 'Clareamento dental',
    status: 'Pendente',
  },
  {
    id: 'a5',
    time: '17:00',
    duration: '30 min',
    patientName: 'Beatriz Oliveira',
    procedure: 'Facetas de porcelana',
    status: 'Confirmado',
  },
];

export const SEED_PRIORITY_RULES = [
  { id: 'pr1', title: 'Pergunta do paciente', slaLimit: 'Prazo: 30 min', count: 5 },
  { id: 'pr2', title: 'Documento ou guia recebido', slaLimit: 'Prazo: 2 horas', count: 3 },
  { id: 'pr3', title: 'Horários enviados', slaLimit: 'Prazo: 24 horas', count: 4 },
  { id: 'pr4', title: 'Paciente vai pensar', slaLimit: 'Prazo: 48 horas', count: 4 },
];

export const SEED_AUTOMATION_RULES = [
  { id: 'ar1', name: 'Confirmação de agendamento', trigger: 'Gatilho: 48h e 24h antes da consulta', successRate: '92% confirmados', status: 'Ativa' },
  { id: 'ar2', name: 'Follow-up de horários', trigger: 'Gatilho: 24h sem resposta do orçamento', successRate: '38% responderam', status: 'Ativa' },
  { id: 'ar3', name: 'Alerta de carteirinha', trigger: 'Gatilho: 2h aguardando documento', successRate: '17 lembretes hoje', status: 'Ativa' },
  { id: 'ar4', name: 'Pesquisa pós-atendimento', trigger: 'Gatilho: 2h após a consulta', successRate: '64% responderam', status: 'Pausada' },
];

export const SEED_EHR_INTEGRATIONS = [
  {
    id: 'ehr1', name: 'iClinic (Afya)', logo: '🏥', status: 'Conectado', lastSync: 'Há 2 minutos', recordsCount: 1420, type: 'Prontuário Eletrônico',
    config: {
      apiEndpoint: 'https://api.iclinic.com.br/v1',
      credentialSet: true,
      credentialLast4: 'x7Kq',
      environment: 'producao',
      syncDirection: 'bidirecional',
      syncFrequencyMinutes: 15,
      syncEntities: ['pacientes', 'agendamentos', 'prontuarios'],
      tiss: { enabled: false, operatorCode: '', tussVersion: '', autoGenerateGuides: false },
    },
  },
  {
    id: 'ehr2', name: 'Feegow Clinic', logo: '🩺', status: 'Conectado', lastSync: 'Há 5 minutos', recordsCount: 980, type: 'Gestão de Clínicas',
    config: {
      apiEndpoint: 'https://api.feegow.com/v1/api',
      credentialSet: true,
      credentialLast4: 'p2Rw',
      environment: 'producao',
      syncDirection: 'bidirecional',
      syncFrequencyMinutes: 30,
      syncEntities: ['pacientes', 'agendamentos', 'financeiro'],
      tiss: { enabled: false, operatorCode: '', tussVersion: '', autoGenerateGuides: false },
    },
  },
  {
    id: 'ehr3', name: 'HiDoctor', logo: '💻', status: 'Conectado', lastSync: 'Há 12 minutos', recordsCount: 750, type: 'Prontuário Eletrônico',
    config: {
      apiEndpoint: 'https://sync.hidoctor.com.br/api/v2',
      credentialSet: true,
      credentialLast4: 'm9Lz',
      environment: 'producao',
      syncDirection: 'somente_leitura',
      syncFrequencyMinutes: 60,
      syncEntities: ['prontuarios'],
      tiss: { enabled: false, operatorCode: '', tussVersion: '', autoGenerateGuides: false },
    },
  },
  {
    id: 'ehr4', name: 'TOTVS Saúde / SIMS', logo: '🛡️', status: 'Pendente', lastSync: 'Aguardando token TISS', recordsCount: 0, type: 'Faturamento TISS',
    config: {
      apiEndpoint: 'https://sims.totvs.com.br/tiss/v3',
      credentialSet: false,
      credentialLast4: '',
      environment: 'homologacao',
      syncDirection: 'somente_escrita',
      syncFrequencyMinutes: 0,
      syncEntities: ['guias_tiss', 'financeiro'],
      tiss: { enabled: true, operatorCode: '', tussVersion: '22.03.01', autoGenerateGuides: false },
    },
  },
];

export const SEED_AUDIT_LOGS = [
  {
    id: 'log-101',
    timestamp: '10/08/2026 10:32:14',
    user: 'Camila Santos',
    role: 'Recepção 01',
    action: 'Visualização de Prontuário & Carteirinha',
    patientName: 'Ana Luíza Vasconcelos',
    recordId: 'PEP-2025-0892',
    ipAddress: '189.120.45.12 (HTTPS / TLS 1.3)',
    encryptionMethod: 'AES-256 E2E',
    status: 'Autorizado',
  },
  {
    id: 'log-102',
    timestamp: '10/08/2026 10:30:00',
    user: 'MediFlux AI Agent',
    role: 'Agente IA Autônomo',
    action: 'Identificação OCR Carteirinha Bradesco',
    patientName: 'Ana Luíza Vasconcelos',
    recordId: 'PEP-2025-0892',
    ipAddress: 'Interno (VPC Secreta)',
    encryptionMethod: 'KMS Tokenizado',
    status: 'Autorizado',
  },
  {
    id: 'log-103',
    timestamp: '10/08/2026 09:45:22',
    user: 'Dra. Juliana Martins',
    role: 'Médica / CRM 129481',
    action: 'Assinatura Digital de Receita TISS',
    patientName: 'Juliana Rocha',
    recordId: 'PEP-2025-0990',
    ipAddress: '177.89.201.05',
    encryptionMethod: 'Certificado ICP-Brasil A3',
    status: 'Autorizado',
  },
  {
    id: 'log-104',
    timestamp: '10/08/2026 08:12:05',
    user: 'Mariana Costa',
    role: 'Atendimento Comercial',
    action: 'Exportação de Histórico de Conversa',
    patientName: 'Carlos Eduardo Mendes',
    recordId: 'PEP-2025-1102',
    ipAddress: '189.120.45.18',
    encryptionMethod: 'AES-256 E2E',
    status: 'Autorizado',
  },
];

export const SEED_ROLE_PERMISSIONS = [
  {
    role: 'Administrador',
    allowedTabs: [
      'visao-geral',
      'atendimentos',
      'jornadas',
      'pendencias',
      'automacoes',
      'indicadores',
      'configuracoes',
      'auditoria',
    ],
    // Ações granulares — ver server/auth/permissions.ts (PermissionAction).
    // Administrador tem tudo por definição (o middleware requireAction já
    // libera automaticamente esse perfil), mas listar aqui explicitamente
    // mantém a tabela consistente com o que a tela de Configurações mostra.
    allowedActions: ['patients.delete', 'patients.merge'],
  },
  {
    role: 'Recepção',
    allowedTabs: ['atendimentos', 'jornadas', 'pendencias'],
    allowedActions: [],
  },
  {
    role: 'Contador (financeiro)',
    allowedTabs: ['visao-geral', 'pendencias', 'indicadores'],
    allowedActions: [],
  },
  {
    role: 'Terceirizado',
    allowedTabs: ['pendencias'],
    allowedActions: [],
  },
  {
    role: 'Profissional de Saúde',
    allowedTabs: [
      'visao-geral',
      'atendimentos',
      'jornadas',
      'pendencias',
      'auditoria',
    ],
    allowedActions: [],
  },
];

// Fase 1: usuários de demonstração da clínica.
// A senha em texto puro existe SOMENTE aqui, em memória, no momento do seed —
// ela é convertida para hash (ver seedUsers()) antes de qualquer PutCommand.
// Nunca reintroduzir um dicionário de senha em texto puro em server.ts ou no
// front-end (era exatamente esse o problema do antigo USER_DIRECTORY /
// DEMO_USERS).
const SEED_USERS_PLAIN = [
  {
    email: 'admin@clinicasantahelena.com.br',
    name: 'Dra. Helena Martins',
    role: 'Administrador',
    unit: 'Unidade Jardins & Matriz',
    password: 'admin123',
  },
  {
    email: 'recepcao@clinicasantahelena.com.br',
    name: 'Camila Santos',
    role: 'Recepção',
    unit: 'Recepção Unidade Jardins',
    password: 'recepcao123',
  },
  {
    email: 'financeiro@clinicasantahelena.com.br',
    name: 'Marcos Vinícius',
    role: 'Contador (financeiro)',
    unit: 'Setor Financeiro & TISS',
    password: 'financeiro123',
  },
  {
    email: 'terceirizado@clinicasantahelena.com.br',
    name: 'Lucas Ferreira',
    role: 'Terceirizado',
    unit: 'Equipe Externa de Exames',
    password: 'terceirizado123',
  },
  {
    email: 'saude@clinicasantahelena.com.br',
    name: 'Dr. Roberto Andrade',
    role: 'Profissional de Saúde',
    unit: 'Corpo Médico / DPO',
    password: 'saude123',
  },
];

async function seedUsers() {
  for (const u of SEED_USERS_PLAIN) {
    const passwordHash = await hashPassword(u.password);
    await docClient.send(
      new PutCommand({
        TableName: 'Users',
        Item: {
          email: u.email,
          clinicId: SEED_CLINIC_ID,
          name: u.name,
          role: u.role,
          unit: u.unit,
          passwordHash, // nunca a senha em texto puro
        },
      })
    );
  }
}

/**
 * Roda o seed de usuários se a tabela Users estiver vazia, ou sempre que
 * `force` for true (mesmo comportamento de idempotência do restante do seed).
 * Existe separado de seedDatabase() para poder ser chamado mesmo quando o
 * resto do banco (Patients etc) já estava seedado antes desta fase.
 */
async function seedUsersIfEmpty(force = false) {
  if (!force) {
    const scanRes = await docClient.send(new ScanCommand({ TableName: 'Users', Limit: 1 }));
    if (scanRes.Items && scanRes.Items.length > 0) {
      return;
    }
  }
  console.log('[Dynalite Seed] Seeding Users table with hashed passwords...');
  await seedUsers();
}

export const SEED_WEBHOOKS = [
  {
    id: 'wh1',
    name: 'N8N - Notificação de Mudança de Etapa em Prontuários',
    url: 'https://n8n.mediflux.com.br/webhook/patient-stage-update',
    secret: 'whsec_n8n_8f9a23b1029c',
    events: ['patient.created', 'patient.stage_changed', 'ehr.synced'],
    status: 'Ativo',
    lastTriggered: 'Há 12 min',
    lastStatusCode: 200,
    lastTestSuccess: true,
    lastTestDate: 'Hoje, 10:15',
    lastTestStatusCode: 200,
    lastTestLatencyMs: 42,
    failureCount: 0,
    createdAt: '10/08/2026 09:00',
  },
  {
    id: 'wh2',
    name: 'Zapier - Nova Mensagem de Paciente no WhatsApp',
    url: 'https://hooks.zapier.com/hooks/catch/91823/mediflux-chat',
    secret: 'whsec_zap_3d8172ea0011',
    events: ['chat.message_received', 'triage.completed'],
    status: 'Ativo',
    lastTriggered: 'Há 35 min',
    lastStatusCode: 200,
    lastTestSuccess: true,
    lastTestDate: 'Hoje, 09:40',
    lastTestStatusCode: 200,
    lastTestLatencyMs: 85,
    failureCount: 0,
    createdAt: '10/08/2026 08:30',
  },
  {
    id: 'wh3',
    name: 'iClinic PEP Bridge - Sincronização Eletrônica',
    url: 'https://api.iclinic.com.br/v2/webhooks/mediflux-sync',
    secret: 'whsec_iclinic_712893ac8801',
    events: ['ehr.synced', 'appointment.scheduled'],
    status: 'Inativo',
    lastTriggered: 'Ontem, 18:20',
    lastStatusCode: 504,
    lastTestSuccess: false,
    lastTestDate: 'Ontem, 18:20',
    lastTestStatusCode: 504,
    lastTestLatencyMs: 3012,
    failureCount: 3,
    createdAt: '09/08/2026 14:20',
  },
  {
    id: 'wh4',
    name: 'Make.com - Disparo de Pesquisa NPS Pós-Consulta',
    url: 'https://hook.us1.make.com/883719283712893',
    secret: 'whsec_make_441290aa9128',
    events: ['appointment.scheduled'],
    status: 'Ativo',
    lastTriggered: 'Há 2 horas',
    lastStatusCode: 500,
    lastTestSuccess: false,
    lastTestDate: 'Hoje, 07:15',
    lastTestStatusCode: 500,
    lastTestLatencyMs: 1250,
    failureCount: 1,
    createdAt: '11/08/2026 11:00',
  },
];

export const SEED_WEBHOOK_LOGS = [
  {
    id: 'whlog-1',
    webhookId: 'wh1',
    webhookName: 'N8N - Notificação de Mudança de Etapa em Prontuários',
    event: 'patient.stage_changed',
    timestamp: '10/08/2026 10:20:15',
    statusCode: 200,
    latencyMs: 42,
    requestPayload: JSON.stringify({
      event: 'patient.stage_changed',
      timestamp: '2026-08-10T10:20:15.000Z',
      patient: {
        id: 'p1',
        name: 'Ana Luíza Vasconcelos',
        insurance: 'Bradesco Saúde',
        stage: 'documentos',
        urgency: 'alta'
      }
    }, null, 2),
    responseBody: JSON.stringify({ success: true, message: 'Workflow N8N iniciado' }),
    success: true,
  },
  {
    id: 'whlog-2',
    webhookId: 'wh2',
    webhookName: 'Zapier - Nova Mensagem de Paciente no WhatsApp',
    event: 'chat.message_received',
    timestamp: '10/08/2026 09:55:02',
    statusCode: 200,
    latencyMs: 88,
    requestPayload: JSON.stringify({
      event: 'chat.message_received',
      timestamp: '2026-08-10T09:55:02.000Z',
      chat: {
        patientId: 'p1',
        sender: 'patient',
        text: 'Qual o valor do ecocardiograma?'
      }
    }, null, 2),
    responseBody: JSON.stringify({ status: 'success', zap_id: 'zap-908123' }),
    success: true,
  },
];

// ---------------------------------------------------------------------------
// Implementação das telas de configuração antes decorativas: Canais de
// Atendimento, Campos Obrigatórios e Jornadas & Funis. Uma linha por
// categoria na tabela ClinicSettings (ver server/db/dynalite.ts).
// ---------------------------------------------------------------------------

export const SEED_CLINIC_CHANNELS = {
  category: 'channels',
  items: [
    {
      channel: 'WhatsApp',
      enabled: true,
      displayName: 'WhatsApp Business — Clínica Santa Helena',
      connectionIdentifier: '+55 11 98765-0000',
      welcomeMessage: 'Olá! Bem-vindo(a) à Clínica Santa Helena. Como podemos ajudar hoje?',
      outOfHoursMessage: 'Nosso horário de atendimento é de segunda a sexta, das 08h às 18h. Deixe sua mensagem que responderemos assim que possível.',
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      businessDays: [1, 2, 3, 4, 5],
    },
    {
      channel: 'Telegram',
      enabled: false,
      displayName: 'Telegram Bot — Clínica Santa Helena',
      connectionIdentifier: '@clinicasantahelena_bot',
      welcomeMessage: 'Olá! Você está falando com a Clínica Santa Helena pelo Telegram.',
      outOfHoursMessage: 'Estamos fora do horário de atendimento. Retornaremos em breve.',
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      businessDays: [1, 2, 3, 4, 5],
    },
    {
      channel: 'Instagram',
      enabled: true,
      displayName: 'Instagram Direct — @clinicasantahelena',
      connectionIdentifier: '@clinicasantahelena',
      welcomeMessage: 'Oi! Obrigado por entrar em contato pelo Instagram da Clínica Santa Helena.',
      outOfHoursMessage: 'No momento estamos fora do horário de atendimento. Já anotamos sua mensagem!',
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      businessDays: [1, 2, 3, 4, 5, 6],
    },
    {
      channel: 'Site',
      enabled: true,
      displayName: 'Chat do Site — clinicasantahelena.com.br',
      connectionIdentifier: 'widget-chat-v2',
      welcomeMessage: 'Bem-vindo(a) ao site da Clínica Santa Helena! Em que podemos ajudar?',
      outOfHoursMessage: 'Nosso time não está online agora, mas deixe sua dúvida que entraremos em contato.',
      businessHoursStart: '08:00',
      businessHoursEnd: '20:00',
      businessDays: [1, 2, 3, 4, 5, 6],
    },
  ],
};

export const SEED_CLINIC_REQUIRED_FIELDS = {
  category: 'requiredFields',
  items: [
    {
      stage: 'triagem',
      stageLabel: 'Triagem',
      requiredPatientFields: ['name', 'phone'],
      requiredChecklistItems: [],
      blockAdvanceIfIncomplete: false,
    },
    {
      stage: 'documentos',
      stageLabel: 'Documentos e Convênio',
      requiredPatientFields: ['cpf', 'insurance'],
      requiredChecklistItems: ['Carteirinha recebida'],
      blockAdvanceIfIncomplete: true,
    },
    {
      stage: 'proposta',
      stageLabel: 'Horários e Proposta',
      requiredPatientFields: ['specialty'],
      requiredChecklistItems: ['Orçamento enviado'],
      blockAdvanceIfIncomplete: false,
    },
    {
      stage: 'agendado',
      stageLabel: 'Agendado',
      requiredPatientFields: ['appointmentDate', 'appointmentTime'],
      requiredChecklistItems: ['Confirmado via IA'],
      blockAdvanceIfIncomplete: true,
    },
    {
      stage: 'tratamento',
      stageLabel: 'Tratamento',
      requiredPatientFields: [],
      requiredChecklistItems: [],
      blockAdvanceIfIncomplete: false,
    },
  ],
};

export const SEED_CLINIC_FUNNELS = {
  category: 'funnels',
  items: [
    {
      id: 'atendimento-inicial',
      name: 'Atendimento inicial',
      isDefault: true,
      stages: [
        { id: 'triagem', label: 'Nova triagem', order: 1, color: 'purple' },
        { id: 'documentos', label: 'Documentos e convênio', order: 2, color: 'amber' },
        { id: 'proposta', label: 'Horários e proposta', order: 3, color: 'blue' },
        { id: 'agendado', label: 'Agendado', order: 4, color: 'emerald' },
      ],
    },
    {
      id: 'comercial',
      name: 'Comercial',
      isDefault: false,
      stages: [
        { id: 'lead-novo', label: 'Lead novo', order: 1, color: 'purple' },
        { id: 'qualificacao', label: 'Qualificação', order: 2, color: 'amber' },
        { id: 'negociacao', label: 'Negociação', order: 3, color: 'blue' },
        { id: 'fechado', label: 'Fechado', order: 4, color: 'emerald' },
      ],
    },
    {
      id: 'exames-guias',
      name: 'Exames e guias',
      isDefault: false,
      stages: [
        { id: 'solicitado', label: 'Exame solicitado', order: 1, color: 'purple' },
        { id: 'autorizacao', label: 'Aguardando autorização', order: 2, color: 'amber' },
        { id: 'agendado-exame', label: 'Agendado', order: 3, color: 'blue' },
        { id: 'laudo', label: 'Laudo entregue', order: 4, color: 'emerald' },
      ],
    },
    {
      id: 'pos-atendimento',
      name: 'Pós-atendimento',
      isDefault: false,
      stages: [
        { id: 'consulta-realizada', label: 'Consulta realizada', order: 1, color: 'purple' },
        { id: 'retorno-pendente', label: 'Retorno pendente', order: 2, color: 'amber' },
        { id: 'pesquisa-enviada', label: 'Pesquisa NPS enviada', order: 3, color: 'blue' },
        { id: 'concluido', label: 'Concluído', order: 4, color: 'emerald' },
      ],
    },
    {
      id: 'recall',
      name: 'Recall',
      isDefault: false,
      stages: [
        { id: 'elegivel', label: 'Elegível para recall', order: 1, color: 'purple' },
        { id: 'contatado', label: 'Contatado', order: 2, color: 'amber' },
        { id: 'reagendado', label: 'Reagendado', order: 3, color: 'emerald' },
      ],
    },
  ],
};

/**
 * Roda o seed das 3 categorias de ClinicSettings (channels, requiredFields,
 * funnels) se a tabela estiver vazia, ou sempre que `force` for true —
 * mesma estratégia de idempotência de seedUsersIfEmpty. Existe separado de
 * seedDatabase() para poder popular a tabela mesmo em um banco que já
 * tinha Patients seedado antes desta funcionalidade existir.
 */
async function seedClinicSettingsIfEmpty(force = false) {
  if (!force) {
    const scanRes = await docClient.send(new ScanCommand({ TableName: 'ClinicSettings', Limit: 1 }));
    if (scanRes.Items && scanRes.Items.length > 0) {
      return;
    }
  }
  console.log('[Dynalite Seed] Seeding ClinicSettings table (canais, campos obrigatórios, funis)...');
  // Fase 1 de Prontidão Comercial: clinicId injetado aqui, no momento da
  // gravação, em vez de editar os 3 literais SEED_CLINIC_* — a chave da
  // tabela agora é composta (clinicId + category), ver server/db/dynalite.ts.
  await docClient.send(new PutCommand({ TableName: 'ClinicSettings', Item: { ...SEED_CLINIC_CHANNELS, clinicId: SEED_CLINIC_ID } }));
  await docClient.send(new PutCommand({ TableName: 'ClinicSettings', Item: { ...SEED_CLINIC_REQUIRED_FIELDS, clinicId: SEED_CLINIC_ID } }));
  await docClient.send(new PutCommand({ TableName: 'ClinicSettings', Item: { ...SEED_CLINIC_FUNNELS, clinicId: SEED_CLINIC_ID } }));
}

export async function seedDatabase(force = false) {
  try {
    // Check if patients already seeded
    if (!force) {
      const scanRes = await docClient.send(new ScanCommand({ TableName: 'Patients', Limit: 1 }));
      if (scanRes.Items && scanRes.Items.length > 0) {
        console.log('[Dynalite Seed] Database already contains seed data. Skipping auto-seed.');
        // Mesmo pulando o restante do seed, garante que a tabela Users e
        // ClinicSettings existam — evita ambiente "meio migrado" onde
        // alguém já tinha Patients seedado antes destas features.
        await seedUsersIfEmpty();
        await seedClinicSettingsIfEmpty();
        return;
      }
    }

    console.log('[Dynalite Seed] Seeding database with initial mock data...');

    // Fase 1 de Prontidão Comercial: a clínica precisa existir antes de
    // qualquer outro dado que a referencie — sem isso, os demais PutCommand
    // abaixo gravariam um clinicId "órfão", sem uma linha correspondente
    // em Clinics/Subscriptions.
    await docClient.send(new PutCommand({ TableName: 'Clinics', Item: SEED_CLINIC }));
    await docClient.send(new PutCommand({ TableName: 'Subscriptions', Item: SEED_SUBSCRIPTION }));

    // Seed Users (senha hasheada — ver seedUsers())
    await seedUsersIfEmpty(force);

    // Seed Patients
    for (const p of SEED_PATIENTS) {
      await docClient.send(new PutCommand({ TableName: "Patients", Item: { ...p, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Messages
    for (const msg of SEED_MESSAGES) {
      await docClient.send(new PutCommand({ TableName: "ChatMessages", Item: { ...msg, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Appointments
    for (const appt of SEED_APPOINTMENTS) {
      await docClient.send(new PutCommand({ TableName: "Appointments", Item: { ...appt, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Priority Rules
    for (const pr of SEED_PRIORITY_RULES) {
      await docClient.send(new PutCommand({ TableName: "PriorityRules", Item: { ...pr, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Automation Rules
    for (const ar of SEED_AUTOMATION_RULES) {
      await docClient.send(new PutCommand({ TableName: "AutomationRules", Item: { ...ar, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed EHR Integrations
    for (const ehr of SEED_EHR_INTEGRATIONS) {
      await docClient.send(new PutCommand({ TableName: "EHRIntegrations", Item: { ...ehr, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Audit Logs
    for (const log of SEED_AUDIT_LOGS) {
      await docClient.send(new PutCommand({ TableName: "AuditLogs", Item: { ...log, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Role Permissions — Fase 1 de Prontidão Comercial: a chave da
    // tabela passou a ser composta (clinicId + role), ver server/db/dynalite.ts.
    for (const perm of SEED_ROLE_PERMISSIONS) {
      await docClient.send(new PutCommand({ TableName: "RolePermissions", Item: { ...perm, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Webhooks
    for (const wh of SEED_WEBHOOKS) {
      await docClient.send(new PutCommand({ TableName: "Webhooks", Item: { ...wh, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Webhook Logs
    for (const whlog of SEED_WEBHOOK_LOGS) {
      await docClient.send(new PutCommand({ TableName: "WebhookLogs", Item: { ...whlog, clinicId: SEED_CLINIC_ID } }));
    }

    // Seed Clinic Settings (Canais, Campos Obrigatórios, Jornadas & Funis)
    await seedClinicSettingsIfEmpty(force);

    console.log('[Dynalite Seed] Seeding completed successfully!');
  } catch (err) {
    console.error('[Dynalite Seed] Error seeding database:', err);
  }
}
