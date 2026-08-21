export type ViewMode = 'landing' | 'login' | 'crm';

export type UserRole =
  | 'Administrador'
  | 'Recepção'
  | 'Contador (financeiro)'
  | 'Terceirizado'
  | 'Profissional de Saúde';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  unit: string;
  token: string;
  allowedTabs: CRMTab[];
  allowedActions: PermissionAction[];
  // Fase 1 de Prontidão Comercial: identifica a clínica do usuário e o
  // nome a exibir na interface — antes "Clínica Santa Helena" era um
  // texto fixo no código, agora vem da sessão de cada usuário.
  clinicId: string;
  clinicName: string;
}

export interface RolePermissions {
  role: UserRole;
  allowedTabs: CRMTab[];
  allowedActions: PermissionAction[];
  canEditSettings: boolean;
  canExportAudit: boolean;
}

export type CRMTab = 
  | 'visao-geral'
  | 'atendimentos'
  | 'jornadas'
  | 'pendencias'
  | 'automacoes'
  | 'indicadores'
  | 'configuracoes'
  | 'auditoria';

// ---------------------------------------------------------------------------
// Configurações da clínica — telas antes decorativas, agora com
// persistência real (ver server/routes/clinicSettings.ts).
// ---------------------------------------------------------------------------

// Canais de atendimento: cada canal (WhatsApp, Telegram, Instagram, Site)
// pode ser ligado/desligado individualmente, ter sua própria mensagem de
// boas-vindas e horário de atendimento automático fora do expediente.
export type ChannelType = 'WhatsApp' | 'Telegram' | 'Instagram' | 'Site';

export interface ChannelConfig {
  channel: ChannelType;
  enabled: boolean;
  displayName: string;
  connectionIdentifier: string; // número de WhatsApp, @usuário do Telegram, etc — texto livre, não credencial secreta
  welcomeMessage: string;
  outOfHoursMessage: string;
  businessHoursStart: string; // "08:00"
  businessHoursEnd: string;   // "18:00"
  businessDays: number[];     // 0=domingo .. 6=sábado
}

// Campos obrigatórios: por etapa do funil de atendimento, quais campos do
// paciente e quais itens de checklist precisam estar preenchidos antes de
// avançar para a próxima etapa.
export interface RequiredFieldsRule {
  stage: string; // corresponde a Patient.stage ('triagem', 'documentos', etc.)
  stageLabel: string;
  requiredPatientFields: string[]; // ex.: ['cpf', 'phone', 'insurance']
  requiredChecklistItems: string[]; // rótulos de itens de checklist obrigatórios nesta etapa
  blockAdvanceIfIncomplete: boolean; // se true, a UI impede avançar de etapa sem os campos preenchidos
}

// Jornadas e funis: define as etapas disponíveis para cada tipo de funil
// (particular, convênio, comercial, pós-atendimento) — a tela operacional
// de Jornadas (JornadasView) usa essas etapas para montar as colunas do
// Kanban.
export interface FunnelStageConfig {
  id: string;
  label: string;
  order: number;
  color: string; // classe de cor tailwind, ex. 'purple', 'emerald'
}

export interface FunnelConfig {
  id: string;
  name: string; // 'Atendimento inicial', 'Comercial', 'Exames e guias', 'Pós-atendimento', 'Recall'
  stages: FunnelStageConfig[];
  isDefault: boolean;
}

export interface ClinicSettingsBundle {
  channels: ChannelConfig[];
  requiredFields: RequiredFieldsRule[];
  funnels: FunnelConfig[];
}

// Ações granulares concedíveis por perfil, independentes de CRMTab — para
// ações destrutivas/sensíveis demais para depender só de acesso a uma
// tela (ex.: excluir ou mesclar pacientes). Ver server/auth/permissions.ts
// (fonte de verdade no backend; mantido igual aqui).
export type PermissionAction =
  | 'patients.delete'
  | 'patients.merge';

// Item revisado: unificação de pacientes duplicados.
export type DuplicateMatchReason = 'cpf' | 'phone' | 'name';

export interface DuplicateCandidate {
  patientA: Patient;
  patientB: Patient;
  reasons: DuplicateMatchReason[];
  confidence: number;
}

export interface MergePatientsResult {
  success: boolean;
  patient: Patient;
  discardedPatientId: string;
  fieldsFilledFromDiscarded: string[];
  chatMessagesReassigned: number;
  note: string;
}

export type LeadTier = 'VIP / Alto Valor' | 'Ouro (Alta Conversão)' | 'Prata (Padrão)' | 'Bronze (Rotina/Dúvida)';
export type FinancialDisposition = 'Particular (Alto Valor)' | 'Particular (Rotina)' | 'Convênio Premium' | 'Convênio Básico' | 'Indefinido';
export type TreatmentIntentType = 
  | 'Procedimento Estético de Alto Valor'
  | 'Cirurgia / Procedimento Especializado'
  | 'Tratamento Continuado'
  | 'Consulta / Check-up Especializado'
  | 'Consulta Rotineira'
  | 'Dúvida Administrativa / Cobertura';

export interface SmartRoutingInfo {
  recommendedAttendant: string;
  attendantAvatar?: string;
  conversionRate: number;
  routingReason: string;
  routingStatus: 'auto_routed' | 'manual_assigned' | 'ai_handled';
  priorityQueue: boolean;
  assignedAt?: string;
}

export interface LeadScoreData {
  score: number;
  tier: LeadTier;
  financialCategory: FinancialDisposition;
  treatmentIntent: TreatmentIntentType;
  estimatedValueRange: string;
  urgencyLevel: 'Imediata / Hoje' | 'Alta (24-48h)' | 'Moderada' | 'Flexível';
  conversionProbability: number;
  keyBuyingSignals: string[];
  smartRouting: SmartRoutingInfo;
  aiSummaryBriefing: string;
  recommendedSalesPitch: string;
  analyzedAt: string;
  sourceChannel?: string;
}

export interface Patient {
  id: string;
  name: string;
  avatar?: string;
  phone: string;
  insurance: string; // e.g. "Bradesco Saúde", "SulAmérica", "Particular", "Unimed"
  specialty?: string; // e.g. "Cardiologia", "Odontologia / Ortodontia", "Dermatologia", "Ginecologia", "Cirurgia Geral"
  planType?: string; // e.g. "Topázio Nacional"
  cpf?: string;
  birthDate?: string;
  status: 'atendimento' | 'pendente' | 'agendado' | 'resolvido';
  stage: 'triagem' | 'documentos' | 'proposta' | 'agendado' | 'tratamento';
  urgency: 'alta' | 'media' | 'baixa';
  lastMessage: string;
  lastMessageTime: string;
  unreadCount?: number;
  assignedTo: string; // e.g. "Camila", "Mariana", "Fernanda"
  slaWarning?: string;
  channel: 'WhatsApp' | 'Telegram' | 'Instagram' | 'Site';
  nextAction?: string;
  checklist: { id: string; label: string; completed: boolean }[];
  internalNotes?: string[];
  tags?: string[];
  sentiment?: 'frustrated' | 'anxious' | 'neutral' | 'satisfied';
  ehrSynced?: boolean;
  ehrSystem?: 'iClinic' | 'Feegow' | 'HiDoctor' | 'TOTVS';
  ehrRecordId?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  leadScore?: LeadScoreData;
}

export interface ChatMessage {
  id: string;
  sender: 'patient' | 'system' | 'attendant' | 'ai';
  senderName?: string;
  text: string;
  timestamp: string;
  attachment?: {
    type: 'card' | 'document' | 'image';
    title: string;
    subtitle?: string;
    verified?: boolean;
  };
  isInternalComment?: boolean;
  isPendingSync?: boolean;
}

export interface Appointment {
  id: string;
  time: string;
  duration: string;
  patientName: string;
  patientAvatar?: string;
  procedure: string;
  status: 'Confirmado' | 'Pendente' | 'Cancelado' | 'Concluído';
}

export interface PriorityRule {
  id: string;
  title: string;
  slaLimit: string;
  count: number;
  active?: boolean;
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  successRate: string;
  status: 'Ativa' | 'Pausada';
}

export interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  role: string;
  action: string;
  patientName: string;
  recordId: string;
  ipAddress: string;
  encryptionMethod: string;
  status: 'Autorizado' | 'Alertado' | 'Bloqueado';
  category?: 'medicamentos' | 'exames' | 'atestado' | 'anamnese' | 'prontuario' | 'exportacao' | 'outro';
  details?: string;
  previousValue?: string;
  newValue?: string;
}

export interface EHRIntegration {
  id: string;
  name: string;
  logo: string;
  status: 'Conectado' | 'Pendente' | 'Desconectado';
  lastSync: string;
  recordsCount: number;
  type: 'Prontuário Eletrônico' | 'Gestão de Clínicas' | 'Faturamento TISS';
  // Item revisado (implementação real da tela de Integrações): antes só
  // status/lastSync/recordsCount eram editáveis, sem nenhuma configuração
  // de fato. Campos abaixo tornam a tela operacionalmente útil.
  config?: EHRIntegrationConfig;
}

export interface EHRIntegrationConfig {
  // Conexão — endpoint e credencial. A credencial nunca é devolvida em
  // texto puro pela API (ver server/routes/ehr.ts); o front-end só recebe
  // um indicador de que existe (credentialSet) e os últimos 4 caracteres
  // para o usuário confirmar visualmente qual chave está configurada.
  apiEndpoint: string;
  credentialSet: boolean;
  credentialLast4: string;
  environment: 'producao' | 'homologacao';

  // Sincronização
  syncDirection: 'bidirecional' | 'somente_leitura' | 'somente_escrita';
  syncFrequencyMinutes: number; // 0 = manual apenas
  syncEntities: EHRSyncEntity[];

  // TISS/TUSS — só relevante para integrações type === 'Faturamento TISS',
  // mas o campo existe em todas por uniformidade (fica vazio/false quando
  // não se aplica).
  tiss: {
    enabled: boolean;
    operatorCode: string; // código ANS da operadora principal configurada
    tussVersion: string; // ex.: "22.03.01"
    autoGenerateGuides: boolean; // gerar guia TISS automaticamente ao confirmar agendamento
  };
}

export type EHRSyncEntity = 'pacientes' | 'agendamentos' | 'prontuarios' | 'financeiro' | 'guias_tiss';

export type WebhookEvent =
  | 'patient.created'
  | 'patient.stage_changed'
  | 'chat.message_received'
  | 'ehr.synced'
  | 'triage.completed'
  | 'appointment.scheduled'
  | 'triage.accuracy_alert';

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  status: 'Ativo' | 'Inativo';
  lastTriggered?: string;
  lastStatusCode?: number;
  lastTestSuccess?: boolean;
  lastTestDate?: string;
  lastTestStatusCode?: number;
  lastTestLatencyMs?: number;
  failureCount: number;
  createdAt: string;
}

export interface WebhookLog {
  id: string;
  webhookId: string;
  webhookName: string;
  event: WebhookEvent | 'webhook.test';
  timestamp: string;
  statusCode: number;
  latencyMs: number;
  requestPayload: string;
  responseBody: string;
  success: boolean;
}

export interface ResponseTemplate {
  id: string;
  title: string;
  category: 'Preparo de Exames' | 'Agendamento' | 'Pós-Operatório' | 'Convênios & Guias' | 'Orientação Médica' | 'Informações Gerais';
  content: string;
  shortcut?: string; // e.g. "/jejum", "/agendar", "/posop"
  targetRole?: 'Todos' | 'Médicos' | 'Recepção';
  usageCount?: number;
  createdByName?: string;
  updatedAt?: string;
}

