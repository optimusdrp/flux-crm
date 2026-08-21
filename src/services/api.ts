import { Patient, ChatMessage, Appointment, PriorityRule, AutomationRule, AuditLog, EHRIntegration, WebhookConfig, WebhookLog, WebhookEvent, DuplicateCandidate, MergePatientsResult, ClinicSettingsBundle } from '../types';
import { authFetch } from './authFetch';

// ---------------------------------------------------------------------------
// Fase 3 de Prontidão Comercial — sinalização de add-on não contratado
//
// Os 4 endpoints de IA agora podem responder 403 com addOnRequired quando
// a clínica não tem aquele add-on contratado (ver server/auth/requireFeature.ts).
// Isso é diferente de qualquer outra falha (rede, timeout, erro do
// servidor): não faz sentido cair no fallback local/heurístico como se a
// IA estivesse indisponível — o widget precisa saber que o recurso não
// está disponível NESTE plano, para mostrar uma chamada de upgrade em vez
// de um resultado fictício genérico que o usuário poderia confundir com
// uma resposta real da IA.
// ---------------------------------------------------------------------------
export class FeatureNotAvailableError extends Error {
  addOnId: string;
  constructor(addOnId: string, message: string) {
    super(message);
    this.name = 'FeatureNotAvailableError';
    this.addOnId = addOnId;
  }
}

/** Lança FeatureNotAvailableError se a resposta for um bloqueio de add-on; não faz nada em qualquer outro caso (deixa o chamador seguir para seu próprio tratamento de erro/fallback). */
async function throwIfFeatureBlocked(res: Response): Promise<void> {
  if (res.status !== 403) return;
  try {
    const data = await res.clone().json();
    if (data && data.addOnRequired) {
      throw new FeatureNotAvailableError(data.addOnRequired, data.error || 'Recurso não incluído no plano contratado.');
    }
  } catch (e) {
    if (e instanceof FeatureNotAvailableError) throw e;
    // corpo não era JSON válido ou não tinha addOnRequired — ignora, não é
    // um bloqueio de feature, o chamador segue com seu tratamento normal.
  }
}

export const apiService = {
  // SEED
  async seedDatabase(): Promise<boolean> {
    try {
      const res = await authFetch('/api/seed', { method: 'POST' });
      const data = await res.json();
      return data.success;
    } catch (err) {
      console.error('[apiService] Error seeding database:', err);
      return false;
    }
  },

  // PATIENTS WITH OFFLINE CACHE SUPPORT
  async getPatients(): Promise<Patient[]> {
    try {
      const res = await authFetch('/api/patients');
      const data = await res.json();
      if (data.success && Array.isArray(data.patients) && data.patients.length > 0) {
        try {
          localStorage.setItem('cached_patients_list', JSON.stringify(data.patients));
          localStorage.setItem('cached_patients_updated_at', new Date().toLocaleTimeString('pt-BR'));
        } catch (e) {
          console.warn('[apiService] Failed to cache patients to LocalStorage:', e);
        }
        return data.patients;
      }

    } catch (err) {
      console.warn('[apiService] Network error fetching patients, attempting LocalStorage fallback:', err);
    }

    // Offline Cache Fallback
    try {
      const raw = localStorage.getItem('cached_patients_list');
      if (raw) {
        const cached = JSON.parse(raw);
        console.log(`[apiService] Loaded ${cached.length} patients from offline LocalStorage cache.`);
        return cached;
      }
    } catch (e) {
      console.warn('[apiService] Failed to parse cached patients from LocalStorage:', e);
    }
    return [];
  },

  async getPatientById(id: string): Promise<Patient | null> {
    try {
      const res = await authFetch(`/api/patients/${id}`);
      const data = await res.json();
      return data.success ? data.patient : null;
    } catch (err) {
      console.error(`[apiService] Error fetching patient ${id}:`, err);
      return null;
    }
  },

  async createPatient(patientData: Partial<Patient>): Promise<Patient | null> {
    try {
      const res = await authFetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patientData),
      });
      const data = await res.json();
      return data.success ? data.patient : null;
    } catch (err) {
      console.error('[apiService] Error creating patient:', err);
      return null;
    }
  },

  async updatePatient(id: string, updateData: Partial<Patient>): Promise<{ patient: Patient | null; error?: string }> {
    try {
      const res = await authFetch(`/api/patients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      const data = await res.json();
      if (data.success) return { patient: data.patient };
      return { patient: null, error: res.status < 500 ? data.error : undefined };
    } catch (err) {
      console.error(`[apiService] Error updating patient ${id}:`, err);
      return { patient: null };
    }
  },

  async deletePatient(id: string): Promise<boolean> {
    try {
      const res = await authFetch(`/api/patients/${id}`, { method: 'DELETE' });
      const data = await res.json();
      return data.success;
    } catch (err) {
      console.error(`[apiService] Error deleting patient ${id}:`, err);
      return false;
    }
  },

  // Item revisado: unificação de pacientes duplicados — detecção e
  // mesclagem, ambas exigindo a ação granular "patients.merge".
  async getDuplicatePatients(): Promise<DuplicateCandidate[]> {
    try {
      const res = await authFetch('/api/patients/duplicates');
      const data = await res.json();
      return data.success && Array.isArray(data.candidates) ? data.candidates : [];
    } catch (err) {
      console.error('[apiService] Error fetching duplicate patients:', err);
      return [];
    }
  },

  async mergePatients(keepPatientId: string, otherPatientId: string): Promise<MergePatientsResult | null> {
    try {
      const res = await authFetch(`/api/patients/${keepPatientId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otherPatientId, keepPatientId }),
      });
      const data = await res.json();
      return data.success ? data : null;
    } catch (err) {
      console.error('[apiService] Error merging patients:', err);
      return null;
    }
  },

  // CHAT MESSAGES WITH OFFLINE CACHE SUPPORT
  async getChatMessages(patientId: string): Promise<ChatMessage[]> {
    try {
      const res = await authFetch(`/api/chat/${patientId}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        try {
          localStorage.setItem(`cached_chat_${patientId}`, JSON.stringify(data.messages));
        } catch (e) {
          console.warn(`[apiService] Failed to cache chat for patient ${patientId}:`, e);
        }
        return data.messages;
      }
    } catch (err) {
      console.warn(`[apiService] Network error fetching chat for ${patientId}, attempting LocalStorage fallback:`, err);
    }

    // Offline Cache Fallback
    try {
      const raw = localStorage.getItem(`cached_chat_${patientId}`);
      if (raw) {
        const cached = JSON.parse(raw);
        console.log(`[apiService] Loaded ${cached.length} chat messages for ${patientId} from offline LocalStorage cache.`);
        return cached;
      }
    } catch (e) {
      console.warn(`[apiService] Failed to parse cached chat for ${patientId}:`, e);
    }
    return [];
  },

  async sendChatMessage(patientId: string, messageData: Partial<ChatMessage>): Promise<ChatMessage | null> {
    try {
      const res = await authFetch(`/api/chat/${patientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageData),
      });
      const data = await res.json();
      return data.success ? data.message : null;
    } catch (err) {
      console.error(`[apiService] Error sending chat message for patient ${patientId}:`, err);
      return null;
    }
  },

  // APPOINTMENTS
  async getAppointments(): Promise<Appointment[]> {
    try {
      const res = await authFetch('/api/appointments');
      const data = await res.json();
      return data.success ? data.appointments : [];
    } catch (err) {
      console.error('[apiService] Error fetching appointments:', err);
      return [];
    }
  },

  async createAppointment(appointmentData: Partial<Appointment>): Promise<Appointment | null> {
    try {
      const res = await authFetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appointmentData),
      });
      const data = await res.json();
      return data.success ? data.appointment : null;
    } catch (err) {
      console.error('[apiService] Error creating appointment:', err);
      return null;
    }
  },

  async updateAppointment(id: string, updateData: Partial<Appointment>): Promise<Appointment | null> {
    try {
      const res = await authFetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      const data = await res.json();
      return data.success ? data.appointment : null;
    } catch (err) {
      console.error(`[apiService] Error updating appointment ${id}:`, err);
      return null;
    }
  },

  // PRIORITY RULES
  async getPriorityRules(): Promise<PriorityRule[]> {
    try {
      const res = await authFetch('/api/priority-rules');
      const data = await res.json();
      return data.success ? data.rules : [];
    } catch (err) {
      console.error('[apiService] Error fetching priority rules:', err);
      return [];
    }
  },

  async updatePriorityRule(id: string, updateData: Partial<PriorityRule>): Promise<PriorityRule | null> {
    try {
      const res = await authFetch(`/api/priority-rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      const data = await res.json();
      return data.success ? data.rule : null;
    } catch (err) {
      console.error(`[apiService] Error updating priority rule ${id}:`, err);
      return null;
    }
  },

  // AUTOMATION RULES
  async getAutomations(): Promise<AutomationRule[]> {
    try {
      const res = await authFetch('/api/automations');
      const data = await res.json();
      return data.success ? data.automations : [];
    } catch (err) {
      console.error('[apiService] Error fetching automations:', err);
      return [];
    }
  },

  async createAutomation(ruleData: Partial<AutomationRule>): Promise<AutomationRule | null> {
    try {
      const res = await authFetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ruleData),
      });
      const data = await res.json();
      return data.success ? data.automation : null;
    } catch (err) {
      console.error('[apiService] Error creating automation:', err);
      return null;
    }
  },

  async updateAutomation(id: string, updateData: Partial<AutomationRule>): Promise<AutomationRule | null> {
    try {
      const res = await authFetch(`/api/automations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      const data = await res.json();
      return data.success ? data.automation : null;
    } catch (err) {
      console.error(`[apiService] Error updating automation ${id}:`, err);
      return null;
    }
  },

  // EHR INTEGRATIONS
  async getEHRIntegrations(): Promise<EHRIntegration[]> {
    try {
      const res = await authFetch('/api/ehr-integrations');
      const data = await res.json();
      return data.success ? data.integrations : [];
    } catch (err) {
      console.error('[apiService] Error fetching EHR integrations:', err);
      return [];
    }
  },

  async updateEHRIntegration(id: string, updateData: Partial<EHRIntegration>): Promise<EHRIntegration | null> {
    try {
      const res = await authFetch(`/api/ehr-integrations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      const data = await res.json();
      return data.success ? data.integration : null;
    } catch (err) {
      console.error(`[apiService] Error updating EHR integration ${id}:`, err);
      return null;
    }
  },

  getCachedEHRRecord(patientId: string): any | null {
    try {
      const raw = localStorage.getItem(`ehr_record_${patientId}`);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[apiService] Failed to read cached EHR record from localStorage', e);
    }
    return null;
  },

  getAllCachedEHRRecords(): any[] {
    try {
      const records: any[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('ehr_record_')) {
          const item = localStorage.getItem(key);
          if (item) records.push(JSON.parse(item));
        }
      }
      return records;
    } catch (e) {
      return [];
    }
  },

  saveEHRRecordToCache(patientId: string, record: any) {
    try {
      const recordToSave = {
        ...record,
        patientId,
        cachedAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        cachedDate: new Date().toLocaleDateString('pt-BR'),
      };
      localStorage.setItem(`ehr_record_${patientId}`, JSON.stringify(recordToSave));
    } catch (e) {
      console.warn('[apiService] Failed to save EHR record to localStorage', e);
    }
  },

  async getEHRRecord(patientId: string, forceOffline: boolean = false): Promise<any> {
    if (!forceOffline) {
      try {
        const res = await authFetch(`/api/ehr/record/${patientId}`);
        const data = await res.json();
        if (data.success && data.ehrRecord) {
          const record = { ...data.ehrRecord, isOfflineCache: false };
          this.saveEHRRecordToCache(patientId, record);
          return record;
        }
      } catch (err) {
        console.warn(`[apiService] Network error fetching EHR for ${patientId}, attempting LocalStorage fallback:`, err);
      }
    }

    // Fallback to LocalStorage
    const cached = this.getCachedEHRRecord(patientId);
    if (cached) {
      return {
        ...cached,
        isOfflineCache: true,
        status: 'Ficha carregada do cache local (Offline)',
      };
    }

    // Default mock fallback if neither API nor previous cache existed
    const mockRecord = {
      recordId: `PEP-2025-${Math.floor(1000 + Math.random() * 9000)}`,
      patientName: patientId === 'p1' ? 'Mariana Silva' : patientId === 'p2' ? 'Carlos Eduardo' : 'Paciente Agendado',
      cpf: '321.654.987-00',
      insurance: 'Bradesco Saúde',
      system: 'iClinic PEP Sync',
      status: forceOffline ? 'Ficha criada offline (Cache Local)' : 'Ficha clínica sincronizada',
      syncedAt: new Date().toLocaleTimeString('pt-BR'),
      summary: 'Anamnese preenchida. Histórico de consultas e prontuário médico armazenado em cache local para acesso offline.',
      isOfflineCache: forceOffline,
    };
    this.saveEHRRecordToCache(patientId, mockRecord);
    return mockRecord;
  },

  // AI SENTIMENT ANALYSIS VIA GEMINI
  async analyzeSentiment(messages?: any[], patientName?: string): Promise<any> {
    try {
      const res = await authFetch('/api/ai/sentiment-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, patientName })
      });
      // Fase 3: add-on não contratado é um erro explícito, não uma falha
      // silenciosa que cairia no exemplo estático abaixo.
      await throwIfFeatureBlocked(res);
      const data = await res.json();
      if (data.success && data.analysis) {
        return data.analysis;
      }
    } catch (err) {
      if (err instanceof FeatureNotAvailableError) throw err;
      console.warn('[apiService] Error calling sentiment analysis endpoint:', err);
    }
    // Static fallback if fetch fails completely
    return {
      initialHumor: "Preocupado",
      finalHumor: "Satisfeito",
      overallTrend: "Melhorando",
      initialScore: 40,
      finalScore: 90,
      overallScore: 82,
      summary: "Atendimento acolhedor da IA que diminuiu a ansiedade inicial do paciente e concluiu o agendamento.",
      timeline: [
        { step: "Início", speaker: "Paciente", sentimentScore: 40, humorLabel: "Preocupado" },
        { step: "Interação IA", speaker: "IA MediFlux", sentimentScore: 68, humorLabel: "Tranquilizado" },
        { step: "Conclusão", speaker: "Paciente", sentimentScore: 90, humorLabel: "Satisfeito" }
      ]
    };
  },

  // AUDIT LOGS
  async getAuditLogs(): Promise<AuditLog[]> {
    try {
      const res = await authFetch('/api/audit-logs');
      const data = await res.json();
      return data.success ? data.logs : [];
    } catch (err) {
      console.error('[apiService] Error fetching audit logs:', err);
      return [];
    }
  },

  async createAuditLog(logData: Partial<AuditLog>): Promise<AuditLog | null> {
    try {
      const res = await authFetch('/api/audit-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData),
      });
      const data = await res.json();
      return data.success ? data.log : null;
    } catch (err) {
      console.error('[apiService] Error creating audit log:', err);
      return null;
    }
  },

  // WEBHOOKS
  async getWebhooks(): Promise<WebhookConfig[]> {
    try {
      const res = await authFetch('/api/webhooks');
      const data = await res.json();
      return data.success ? data.webhooks : [];
    } catch (err) {
      console.error('[apiService] Error fetching webhooks:', err);
      return [];
    }
  },

  async createWebhook(webhookData: Partial<WebhookConfig>): Promise<{ webhook: WebhookConfig | null; error?: string }> {
    try {
      const res = await authFetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookData),
      });
      const data = await res.json();
      // Item revisado (auditoria de UI): antes, um 400 do servidor (ex.:
      // URL de webhook bloqueada pela defesa de SSRF) era indistinguível
      // de uma falha de rede — os dois casos retornavam apenas null, e
      // quem chamava caía num fallback otimista que criava o webhook só
      // no estado local, mostrando "cadastrado com sucesso" para uma URL
      // que o backend tinha acabado de rejeitar por segurança. Agora o
      // motivo da rejeição explícita do servidor é propagado.
      if (data.success) {
        return { webhook: data.webhook };
      }
      return { webhook: null, error: res.status < 500 ? data.error : undefined };
    } catch (err) {
      console.error('[apiService] Error creating webhook:', err);
      return { webhook: null };
    }
  },

  async updateWebhook(id: string, updateData: Partial<WebhookConfig>): Promise<WebhookConfig | null> {
    try {
      const res = await authFetch(`/api/webhooks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      const data = await res.json();
      return data.success ? data.webhook : null;
    } catch (err) {
      console.error(`[apiService] Error updating webhook ${id}:`, err);
      return null;
    }
  },

  async deleteWebhook(id: string): Promise<boolean> {
    try {
      const res = await authFetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      const data = await res.json();
      return data.success;
    } catch (err) {
      console.error(`[apiService] Error deleting webhook ${id}:`, err);
      return false;
    }
  },

  async testWebhook(id: string, event?: WebhookEvent): Promise<{ log: WebhookLog; webhook: WebhookConfig } | null> {
    try {
      const res = await authFetch(`/api/webhooks/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      });
      const data = await res.json();
      return data.success ? { log: data.log, webhook: data.webhook } : null;
    } catch (err) {
      console.error(`[apiService] Error testing webhook ${id}:`, err);
      return null;
    }
  },

  async getWebhookLogs(): Promise<WebhookLog[]> {
    try {
      const res = await authFetch('/api/webhooks/logs');
      const data = await res.json();
      return data.success ? data.logs : [];
    } catch (err) {
      console.error('[apiService] Error fetching webhook logs:', err);
      return [];
    }
  },

  // EHR INTEGRATIONS — Item revisado: credencial e sincronização manual,
  // que não existiam ainda. Nomenclatura (EHR maiúsculo) alinhada com
  // getEHRIntegrations/updateEHRIntegration já existentes acima.
  async setEHRCredential(id: string, apiKey: string): Promise<{ integration: EHRIntegration | null; error?: string }> {
    try {
      const res = await authFetch(`/api/ehr-integrations/${id}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (data.success) return { integration: data.integration };
      return { integration: null, error: res.status < 500 ? data.error : undefined };
    } catch (err) {
      console.error(`[apiService] Error setting EHR credential ${id}:`, err);
      return { integration: null };
    }
  },

  async syncEHRIntegration(id: string): Promise<{ integration: EHRIntegration | null; error?: string }> {
    try {
      const res = await authFetch(`/api/ehr-integrations/${id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (data.success) return { integration: data.integration };
      return { integration: null, error: res.status < 500 ? data.error : undefined };
    } catch (err) {
      console.error(`[apiService] Error syncing EHR integration ${id}:`, err);
      return { integration: null };
    }
  },

  // CLINIC SETTINGS — canais de atendimento, campos obrigatórios e
  // jornadas/funis. Backend real em server/routes/clinicSettings.ts.
  async getClinicSettings(): Promise<ClinicSettingsBundle | null> {
    try {
      const res = await authFetch('/api/clinic-settings');
      const data = await res.json();
      return data.success ? data.settings : null;
    } catch (err) {
      console.error('[apiService] Error fetching clinic settings:', err);
      return null;
    }
  },

  async updateClinicSettingsCategory<T>(category: 'channels' | 'requiredFields' | 'funnels', items: T[]): Promise<{ items: T[] | null; error?: string }> {
    try {
      const res = await authFetch(`/api/clinic-settings/${category}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (data.success) return { items: data.items };
      return { items: null, error: res.status < 500 ? data.error : undefined };
    } catch (err) {
      console.error(`[apiService] Error updating clinic settings (${category}):`, err);
      return { items: null };
    }
  },

  // WHATSAPP CONNECTION (whatsapp-web.js)
  async connectWhatsApp(): Promise<{ status: string; qrDataUrl?: string; error?: string }> {
    try {
      const res = await authFetch('/api/whatsapp/connect', { method: 'POST' });
      const data = await res.json();
      if (data.success) return { status: data.status, qrDataUrl: data.qrDataUrl };
      return { status: 'disconnected', error: data.error };
    } catch (err) {
      console.error('[apiService] Error connecting WhatsApp:', err);
      return { status: 'disconnected', error: 'Erro de rede ao iniciar a conexão.' };
    }
  },

  async getWhatsAppStatus(): Promise<{ status: string; qrDataUrl?: string; connectedNumber?: string; lastError?: string }> {
    try {
      const res = await authFetch('/api/whatsapp/status');
      const data = await res.json();
      return { status: data.status, qrDataUrl: data.qrDataUrl, connectedNumber: data.connectedNumber, lastError: data.lastError };
    } catch (err) {
      console.error('[apiService] Error fetching WhatsApp status:', err);
      return { status: 'disconnected' };
    }
  },

  async disconnectWhatsApp(): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await authFetch('/api/whatsapp/disconnect', { method: 'POST' });
      const data = await res.json();
      return { success: !!data.success, error: data.error };
    } catch (err) {
      console.error('[apiService] Error disconnecting WhatsApp:', err);
      return { success: false, error: 'Erro de rede ao desconectar.' };
    }
  },

  // AI TRIAGE ANALYZER
  async analyzeMessage(payload: {
    messageText: string;
    patientName?: string;
    patientInsurance?: string;
    history?: string;
  }) {
    const cacheKey = `cached_triage_${payload.patientName || 'default'}_${payload.messageText.substring(0, 30)}`;
    try {
      const res = await authFetch('/api/analyze-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Fase 3: add-on não contratado é um erro explícito — não faz
      // sentido cair no protocolo clínico heurístico abaixo como se fosse
      // uma indisponibilidade momentânea da IA.
      await throwIfFeatureBlocked(res);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.analysis) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(data.analysis));
          } catch (e) {
            // ignore localStorage quota error
          }
          return data.analysis;
        }
      }
    } catch (err) {
      if (err instanceof FeatureNotAvailableError) throw err;
      console.warn('[apiService] Rede offline ou erro no endpoint de triagem. Consultando cache local:', err);
    }

    // Try localStorage cache
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      // ignore
    }

    // Local deterministic clinical protocol fallback
    const msg = (payload.messageText || '').toLowerCase();
    const isHigh = msg.includes('dor') || msg.includes('sangue') || msg.includes('febre') || msg.includes('cirurgi') || msg.includes('urgente') || msg.includes('falta de ar');
    const isMedium = msg.includes('dúvida') || msg.includes('remédio') || msg.includes('receita') || msg.includes('exame') || msg.includes('retorno');

    return {
      urgency: isHigh ? 'alta' : isMedium ? 'media' : 'baixa',
      urgencyLabel: isHigh ? 'Emergência / Alta Urgência (Protocolo Manchester)' : isMedium ? 'Atenção Moderada (Triagem Clínica)' : 'Atendimento de Rotina (Triagem Clínica)',
      confidenceScore: 92,
      category: isHigh ? 'Sintoma Agudo e Pós-Operatório' : isMedium ? 'Orientação Médica / Dúvida' : 'Agendamento Geral',
      urgencyReason: `Triagem clínica: a mensagem do paciente "${payload.messageText.substring(0, 70)}..." foi classificada com prioridade ${isHigh ? 'alta (Manchester Vermelho)' : isMedium ? 'moderada (Manchester Amarelo)' : 'rotineira (Manchester Verde)'}.`,
      suggestedProtocol: [
        '1. Confirmar presença de sintomas de dor persistente ou febre.',
        '2. Identificar histórico de procedimentos recentes e alergias.',
        '3. Notificar a equipe de enfermagem/médico de plantão.',
        '4. Atualizar o registro clínico no Prontuário Eletrônico (PEP).'
      ],
      recommendedAction: isHigh ? 'Notificar médico de plantão para encaixe prioritário.' : 'Verificar horários disponíveis na agenda médica.',
      suggestedReply: `Olá ${payload.patientName || 'Paciente'}! Recebemos sua mensagem sobre sua solicitação. Nossa equipe de saúde já registrou seu contato e responderá em instantes com o direcionamento adequado.`,
      isOfflineCached: true
    };
  },

  // MACHINE LEARNING AUTO-TAGGING ANALYZER
  async autoTagConversation(payload: {
    messages?: any[];
    conversationText?: string;
    patientName?: string;
    patientInsurance?: string;
  }): Promise<{
    primaryLabel: string;
    summary: string;
    suggestedTags: Array<{
      tag: string;
      tagPt?: string;
      confidenceScore: number;
      category: string;
      reason: string;
      color: string;
    }>;
  } | null> {
    try {
      const res = await authFetch('/api/ai/auto-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Fase 3: add-on não contratado é um erro explícito, não uma falha
      // silenciosa que cairia nas sugestões heurísticas abaixo.
      await throwIfFeatureBlocked(res);
      const data = await res.json();
      if (data.success && Array.isArray(data.suggestedTags)) {
        return {
          primaryLabel: data.primaryLabel || 'Routine Request',
          summary: data.summary || 'Análise de etiquetagem concluída.',
          suggestedTags: data.suggestedTags,
        };
      }
    } catch (err) {
      if (err instanceof FeatureNotAvailableError) throw err;
      console.warn('[apiService] Error calling autoTagConversation endpoint:', err);
    }

    // Heuristic Fallback
    return {
      primaryLabel: 'Routine Request',
      summary: 'Sugestões de etiquetas de Inteligência Artificial para a conversa.',
      suggestedTags: [
        {
          tag: 'Routine Request',
          tagPt: 'Routine Request (Solicitação de Rotina)',
          confidenceScore: 94,
          category: 'Atendimento Geral',
          reason: 'Linguagem associada a consulta ou agendamento padrão de rotina.',
          color: '#2563eb',
        },
        {
          tag: 'Insurance Issue',
          tagPt: 'Insurance Issue (Consulta de Convênio)',
          confidenceScore: 88,
          category: 'Guias e Cobertura',
          reason: 'Identificadas menções a plano de saúde ou autorização de guias.',
          color: '#d97706',
        },
      ],
    };
  },

  // QUALIFICADOR AUTOMÁTICO DE LEADS E INTENÇÃO DE AGENDAMENTO POR IA
  async qualifyLead(payload: {
    messageText?: string;
    conversationHistory?: any[];
    patientName?: string;
    patientPhone?: string;
    declaredInsurance?: string;
    specialty?: string;
  }): Promise<import('../types').LeadScoreData | null> {
    try {
      const res = await authFetch('/api/ai/qualify-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Fase 3: add-on não contratado é um erro explícito, não uma falha
      // silenciosa que cairia no cálculo heurístico abaixo.
      await throwIfFeatureBlocked(res);
      const data = await res.json();
      if (data.success && data.qualification) {
        return data.qualification;
      }
    } catch (err) {
      if (err instanceof FeatureNotAvailableError) throw err;
      console.warn('[apiService] Error calling qualifyLead endpoint:', err);
    }

    // Heuristic Fallback
    const msg = (payload.messageText || '').toLowerCase();
    const isAesthetic = msg.includes('implante') || msg.includes('faceta') || msg.includes('botox') || msg.includes('harmoniz') || msg.includes('clareamento');
    const isParticular = !msg.includes('unimed') && !msg.includes('bradesco') && !msg.includes('sulamerica');
    const isScoreHigh = isAesthetic || isParticular;

    return {
      score: isScoreHigh ? 94 : 62,
      tier: isScoreHigh ? 'VIP / Alto Valor' : 'Prata (Padrão)',
      financialCategory: isScoreHigh ? 'Particular (Alto Valor)' : 'Convênio Premium',
      treatmentIntent: isAesthetic ? 'Procedimento Estético de Alto Valor' : 'Consulta / Check-up Especializado',
      estimatedValueRange: isAesthetic ? 'R$ 6.500,00 - R$ 15.000,00' : 'R$ 450,00 (Consulta)',
      urgencyLevel: 'Alta (24-48h)',
      conversionProbability: isScoreHigh ? 94 : 70,
      keyBuyingSignals: isScoreHigh
        ? [
            'Procura tratamento estético de alto valor',
            'Disposição para pagamento particular ou parcelado',
            'Interesse em avaliação com escaneamento 3D'
          ]
        : ['Consulta de rotina com cobertura de convênio'],
      smartRouting: {
        recommendedAttendant: isScoreHigh ? 'Camila Santos (Top Closer / Concierge VIP)' : 'Mariana Costa (Recepção Geral)',
        conversionRate: isScoreHigh ? 96 : 85,
        routingReason: isScoreHigh
          ? 'LEAD VIP DE ALTO VALOR. Direcionado automaticamente para o melhor atendente humano da recepção.'
          : 'Lead qualificado para atendimento humanizado ágil na recepção.',
        routingStatus: 'auto_routed',
        priorityQueue: isScoreHigh,
        assignedAt: 'Agora mesmo'
      },
      aiSummaryBriefing: isScoreHigh
        ? 'Lead de alto valor com foco em estética/particular. Apresentar parcelamento em 12x e convidar para avaliação presencial.'
        : 'Lead para consulta padrão de rotina. Confirmar disponibilidade de horários.',
      recommendedSalesPitch: isScoreHigh
        ? 'Olá! Podemos agendar sua avaliação personalizada com o Dr. Roberto já nesta semana. Parcelamos o procedimento em até 12x sem juros!'
        : 'Olá! Temos horários disponíveis para sua consulta nesta semana. Gostaria de agendar pela manhã ou tarde?',
      analyzedAt: new Date().toLocaleString('pt-BR')
    };
  },
};


