import React, { useState, useEffect } from 'react';
import {
  Save,
  Loader2,
  Link2,
  KeyRound,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Shield,
  Database,
} from 'lucide-react';
import { EHRIntegration, EHRSyncEntity } from '../../types';
import { apiService } from '../../services/api';
import { useToast } from '../../context/ToastContext';

// ---------------------------------------------------------------------------
// Item revisado: implementação real da tela "Integrações (Prontuários &
// TISS)", antes um modal genérico. Cada integração tem endpoint,
// credencial (nunca exibida em texto puro depois de salva — só os últimos
// 4 caracteres), direção e frequência de sincronização, quais entidades
// sincronizar, e configuração específica de TISS/TUSS para a integração
// de faturamento.
// ---------------------------------------------------------------------------

const SYNC_ENTITY_LABELS: Record<EHRSyncEntity, string> = {
  pacientes: 'Pacientes',
  agendamentos: 'Agendamentos',
  prontuarios: 'Prontuários',
  financeiro: 'Financeiro',
  guias_tiss: 'Guias TISS',
};

const STATUS_STYLE: Record<EHRIntegration['status'], string> = {
  Conectado: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  Pendente: 'bg-amber-100 text-amber-700 border-amber-300',
  Desconectado: 'bg-slate-200 text-slate-500 border-slate-300',
};

export const IntegrationsSettings: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const [integrations, setIntegrations] = useState<EHRIntegration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({});
  const [savingCredentialId, setSavingCredentialId] = useState<string | null>(null);

  const loadIntegrations = async () => {
    setIsLoading(true);
    const data = await apiService.getEHRIntegrations();
    setIntegrations(data);
    setIsLoading(false);
  };

  useEffect(() => {
    loadIntegrations();
  }, []);

  const updateLocalConfig = (id: string, patch: Partial<NonNullable<EHRIntegration['config']>>) => {
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id && i.config ? { ...i, config: { ...i.config, ...patch } } : i))
    );
  };

  const toggleSyncEntity = (id: string, entity: EHRSyncEntity) => {
    setIntegrations((prev) =>
      prev.map((i) => {
        if (i.id !== id || !i.config) return i;
        const has = i.config.syncEntities.includes(entity);
        const syncEntities = has
          ? i.config.syncEntities.filter((e) => e !== entity)
          : [...i.config.syncEntities, entity];
        return { ...i, config: { ...i.config, syncEntities } };
      })
    );
  };

  const handleSaveConfig = async (integration: EHRIntegration) => {
    setSavingId(integration.id);
    const updated = await apiService.updateEHRIntegration(integration.id, { config: integration.config });
    setSavingId(null);
    if (updated) {
      showSuccess('Integração atualizada', `Configuração de ${integration.name} salva.`);
      setIntegrations((prev) => prev.map((i) => (i.id === integration.id ? updated : i)));
    } else {
      showError('Não foi possível salvar', 'Tente novamente em instantes.');
    }
  };

  const handleSaveCredential = async (id: string, name: string) => {
    const apiKey = (credentialDrafts[id] || '').trim();
    if (apiKey.length < 8) {
      showError('Credencial muito curta', 'Informe uma chave de API com pelo menos 8 caracteres.');
      return;
    }
    setSavingCredentialId(id);
    const result = await apiService.setEHRCredential(id, apiKey);
    setSavingCredentialId(null);
    if (result.integration) {
      showSuccess('Credencial atualizada', `Nova chave de API salva para ${name}.`);
      setIntegrations((prev) => prev.map((i) => (i.id === id ? result.integration! : i)));
      setCredentialDrafts((prev) => ({ ...prev, [id]: '' }));
    } else {
      showError('Não foi possível salvar a credencial', result.error || 'Tente novamente.');
    }
  };

  const handleSync = async (id: string, name: string) => {
    setSyncingId(id);
    const result = await apiService.syncEHRIntegration(id);
    setSyncingId(null);
    if (result.integration) {
      showSuccess('Sincronização concluída', `${name} sincronizado com sucesso.`);
      setIntegrations((prev) => prev.map((i) => (i.id === id ? result.integration! : i)));
    } else {
      showError('Não foi possível sincronizar', result.error || 'Configure a credencial primeiro.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-xs">Carregando integrações...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        Configure a conexão de cada sistema de prontuário eletrônico, gestão de clínica ou faturamento TISS. A
        credencial de acesso nunca é exibida novamente após salva — apenas os últimos 4 caracteres, para
        confirmação visual.
      </p>

      <div className="space-y-3">
        {integrations.map((int) => {
          const isExpanded = expandedId === int.id;
          const cfg = int.config;
          return (
            <div key={int.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : int.id)}
                className="w-full flex items-center justify-between p-3.5 text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{int.logo}</span>
                  <div>
                    <p className="text-xs font-bold text-slate-900">{int.name}</p>
                    <p className="text-[10.5px] text-slate-500">{int.type} • {int.recordsCount} registros sincronizados</p>
                  </div>
                </div>
                <span className={`text-[9.5px] font-bold px-2 py-1 rounded-full border ${STATUS_STYLE[int.status]}`}>
                  {int.status}
                </span>
              </button>

              {isExpanded && cfg && (
                <div className="px-3.5 pb-4 pt-1 space-y-4 border-t border-slate-100">
                  {/* Conexão */}
                  <div className="space-y-2 pt-3">
                    <p className="text-[10.5px] font-bold text-slate-600 flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> Conexão
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1">Endpoint da API</label>
                        <input
                          type="text"
                          value={cfg.apiEndpoint}
                          onChange={(e) => updateLocalConfig(int.id, { apiEndpoint: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1">Ambiente</label>
                        <select
                          value={cfg.environment}
                          onChange={(e) => updateLocalConfig(int.id, { environment: e.target.value as 'producao' | 'homologacao' })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                        >
                          <option value="producao">Produção</option>
                          <option value="homologacao">Homologação</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Credencial */}
                  <div className="space-y-2">
                    <p className="text-[10.5px] font-bold text-slate-600 flex items-center gap-1">
                      <KeyRound className="w-3 h-3" /> Credencial de acesso
                    </p>
                    <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-2.5 py-2 border border-slate-200">
                      {cfg.credentialSet ? (
                        <span className="flex items-center gap-1.5 text-[10.5px] text-emerald-700 font-semibold">
                          <Shield className="w-3.5 h-3.5" /> Configurada — termina em •••{cfg.credentialLast4}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[10.5px] text-amber-700 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5" /> Nenhuma credencial configurada
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={credentialDrafts[int.id] || ''}
                        onChange={(e) => setCredentialDrafts((prev) => ({ ...prev, [int.id]: e.target.value }))}
                        placeholder="Nova chave de API..."
                        className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveCredential(int.id, int.name)}
                        disabled={savingCredentialId === int.id}
                        className="text-[10.5px] font-bold bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {savingCredentialId === int.id ? 'Salvando...' : 'Definir chave'}
                      </button>
                    </div>
                  </div>

                  {/* Sincronização */}
                  <div className="space-y-2">
                    <p className="text-[10.5px] font-bold text-slate-600 flex items-center gap-1">
                      <Database className="w-3 h-3" /> Sincronização
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1">Direção</label>
                        <select
                          value={cfg.syncDirection}
                          onChange={(e) => updateLocalConfig(int.id, { syncDirection: e.target.value as typeof cfg.syncDirection })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                        >
                          <option value="bidirecional">Bidirecional</option>
                          <option value="somente_leitura">Somente leitura</option>
                          <option value="somente_escrita">Somente escrita</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1">Frequência</label>
                        <select
                          value={cfg.syncFrequencyMinutes}
                          onChange={(e) => updateLocalConfig(int.id, { syncFrequencyMinutes: Number(e.target.value) })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                        >
                          <option value={0}>Manual apenas</option>
                          <option value={15}>A cada 15 minutos</option>
                          <option value={30}>A cada 30 minutos</option>
                          <option value={60}>A cada hora</option>
                          <option value={360}>A cada 6 horas</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(Object.keys(SYNC_ENTITY_LABELS) as EHRSyncEntity[]).map((entity) => {
                        const active = cfg.syncEntities.includes(entity);
                        return (
                          <button
                            key={entity}
                            type="button"
                            onClick={() => toggleSyncEntity(int.id, entity)}
                            className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                              active
                                ? 'bg-purple-100 border-purple-300 text-purple-900'
                                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            {SYNC_ENTITY_LABELS[entity]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* TISS/TUSS */}
                  {int.type === 'Faturamento TISS' && (
                    <div className="space-y-2 bg-blue-50/50 border border-blue-100 rounded-xl p-3">
                      <p className="text-[10.5px] font-bold text-blue-900">Configuração TISS/TUSS</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Código ANS da operadora</label>
                          <input
                            type="text"
                            value={cfg.tiss.operatorCode}
                            onChange={(e) => updateLocalConfig(int.id, { tiss: { ...cfg.tiss, operatorCode: e.target.value } })}
                            placeholder="Ex.: 326305"
                            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Versão TUSS</label>
                          <input
                            type="text"
                            value={cfg.tiss.tussVersion}
                            onChange={(e) => updateLocalConfig(int.id, { tiss: { ...cfg.tiss, tussVersion: e.target.value } })}
                            placeholder="Ex.: 22.03.01"
                            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-[10.5px] font-semibold text-slate-700 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={cfg.tiss.autoGenerateGuides}
                          onChange={(e) => updateLocalConfig(int.id, { tiss: { ...cfg.tiss, autoGenerateGuides: e.target.checked } })}
                          className="rounded text-purple-700 focus:ring-purple-500"
                        />
                        Gerar guia TISS automaticamente ao confirmar agendamento
                      </label>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleSaveConfig(int)}
                      disabled={savingId === int.id}
                      className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-bold bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white py-2 rounded-xl cursor-pointer"
                    >
                      {savingId === int.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Salvar Configuração
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSync(int.id, int.name)}
                      disabled={syncingId === int.id}
                      className="flex items-center gap-1.5 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 px-3 py-2 rounded-xl cursor-pointer"
                    >
                      {syncingId === int.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Sincronizar agora
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
