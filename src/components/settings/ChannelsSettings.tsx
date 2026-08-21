import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Save,
  Loader2,
  Power,
  Clock,
  Smartphone,
  Instagram,
  Globe,
  Send,
} from 'lucide-react';
import { ChannelConfig, ChannelType } from '../../types';
import { apiService } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { WhatsAppConnectionPanel } from './WhatsAppConnectionPanel';

// ---------------------------------------------------------------------------
// Item revisado: implementação real da tela "Canais de atendimento", antes
// um modal genérico sem nenhuma configuração de fato. Cada canal tem
// liga/desliga, nome de exibição, identificador de conexão (número de
// WhatsApp, @usuário), mensagens de boas-vindas/ausência, e horário de
// atendimento automático (dias da semana + faixa de horário).
// ---------------------------------------------------------------------------

const CHANNEL_ICON: Record<ChannelType, React.ReactNode> = {
  WhatsApp: <Smartphone className="w-4 h-4" />,
  Telegram: <Send className="w-4 h-4" />,
  Instagram: <Instagram className="w-4 h-4" />,
  Site: <Globe className="w-4 h-4" />,
};

// Tailwind não suporta classes montadas por interpolação de string em
// tempo de execução (`bg-${color}-100`) — o compilador só inclui no CSS
// final as classes que existem literalmente no código-fonte. Por isso,
// cada variação de cor é escrita por extenso aqui.
const CHANNEL_STYLES: Record<
  ChannelType,
  { border: string; bg: string; iconBg: string; iconText: string; toggleOn: string; dayOn: string }
> = {
  WhatsApp: {
    border: 'border-emerald-200', bg: 'bg-emerald-50/40', iconBg: 'bg-emerald-100', iconText: 'text-emerald-700',
    toggleOn: 'bg-emerald-600', dayOn: 'bg-emerald-600 text-white',
  },
  Telegram: {
    border: 'border-sky-200', bg: 'bg-sky-50/40', iconBg: 'bg-sky-100', iconText: 'text-sky-700',
    toggleOn: 'bg-sky-600', dayOn: 'bg-sky-600 text-white',
  },
  Instagram: {
    border: 'border-pink-200', bg: 'bg-pink-50/40', iconBg: 'bg-pink-100', iconText: 'text-pink-700',
    toggleOn: 'bg-pink-600', dayOn: 'bg-pink-600 text-white',
  },
  Site: {
    border: 'border-purple-200', bg: 'bg-purple-50/40', iconBg: 'bg-purple-100', iconText: 'text-purple-700',
    toggleOn: 'bg-purple-600', dayOn: 'bg-purple-600 text-white',
  },
};

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface ChannelsSettingsProps {
  onClose?: () => void;
}

export const ChannelsSettings: React.FC<ChannelsSettingsProps> = ({ onClose }) => {
  const { showSuccess, showError } = useToast();
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedChannel, setExpandedChannel] = useState<ChannelType | null>(null);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const settings = await apiService.getClinicSettings();
      if (settings?.channels) setChannels(settings.channels);
      setIsLoading(false);
    })();
  }, []);

  const updateChannel = (channel: ChannelType, patch: Partial<ChannelConfig>) => {
    setChannels((prev) => prev.map((c) => (c.channel === channel ? { ...c, ...patch } : c)));
  };

  const toggleBusinessDay = (channel: ChannelType, day: number) => {
    setChannels((prev) =>
      prev.map((c) => {
        if (c.channel !== channel) return c;
        const has = c.businessDays.includes(day);
        const businessDays = has ? c.businessDays.filter((d) => d !== day) : [...c.businessDays, day].sort();
        return { ...c, businessDays };
      })
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    const result = await apiService.updateClinicSettingsCategory('channels', channels);
    setIsSaving(false);
    if (result.items) {
      showSuccess('Canais atualizados', 'As configurações de atendimento foram salvas.');
    } else {
      showError('Não foi possível salvar', result.error || 'Tente novamente em instantes.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-xs">Carregando canais...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        Ative ou desative cada canal de atendimento, e configure a mensagem de boas-vindas, mensagem fora do
        horário, e a janela de atendimento automático de cada um.
      </p>

      <div className="space-y-3">
        {channels.map((ch) => {
          const style = CHANNEL_STYLES[ch.channel];
          const isExpanded = expandedChannel === ch.channel;
          return (
            <div
              key={ch.channel}
              className={`rounded-2xl border transition-colors ${
                ch.enabled ? `${style.border} ${style.bg}` : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-center justify-between p-3.5">
                <button
                  type="button"
                  onClick={() => setExpandedChannel(isExpanded ? null : ch.channel)}
                  className="flex items-center gap-3 flex-1 text-left cursor-pointer"
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      ch.enabled ? `${style.iconBg} ${style.iconText}` : 'bg-slate-200 text-slate-400'
                    }`}
                  >
                    {CHANNEL_ICON[ch.channel]}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">{ch.displayName}</p>
                    <p className="text-[10.5px] text-slate-500">{ch.connectionIdentifier}</p>
                  </div>
                </button>

                <div className="flex items-center gap-3">
                  <span className={`text-[9.5px] font-bold px-2 py-1 rounded-full ${ch.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                    {ch.enabled ? 'Ativo' : 'Inativo'}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateChannel(ch.channel, { enabled: !ch.enabled })}
                    className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${ch.enabled ? style.toggleOn : 'bg-slate-300'}`}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        ch.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-slate-100">
                  {ch.channel === 'WhatsApp' && (
                    <div className="pt-3">
                      <WhatsAppConnectionPanel />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-700 mb-1">Nome de exibição</label>
                      <input
                        type="text"
                        value={ch.displayName}
                        onChange={(e) => updateChannel(ch.channel, { displayName: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                      />
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-700 mb-1">
                        {ch.channel === 'WhatsApp' ? 'Número exibido (informativo)' : 'Identificador de conexão'}
                      </label>
                      <input
                        type="text"
                        value={ch.connectionIdentifier}
                        onChange={(e) => updateChannel(ch.channel, { connectionIdentifier: e.target.value })}
                        placeholder={ch.channel === 'WhatsApp' ? '(11) 99999-9999' : 'Número, @usuário ou ID do widget'}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                      />
                      {ch.channel === 'WhatsApp' && (
                        <p className="text-[10px] text-slate-400 mt-1">
                          Só para exibição na interface — a conexão de verdade é feita pelo QR code acima.
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10.5px] font-bold text-slate-700 mb-1">
                      Mensagem de boas-vindas
                    </label>
                    <textarea
                      value={ch.welcomeMessage}
                      onChange={(e) => updateChannel(ch.channel, { welcomeMessage: e.target.value })}
                      rows={2}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30 resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10.5px] font-bold text-slate-700 mb-1">
                      Mensagem fora do horário de atendimento
                    </label>
                    <textarea
                      value={ch.outOfHoursMessage}
                      onChange={(e) => updateChannel(ch.channel, { outOfHoursMessage: e.target.value })}
                      rows={2}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30 resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-2 text-[10.5px] font-bold text-slate-700">
                    <Clock className="w-3.5 h-3.5" />
                    Janela de atendimento automático
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="time"
                        value={ch.businessHoursStart}
                        onChange={(e) => updateChannel(ch.channel, { businessHoursStart: e.target.value })}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                      />
                      <span className="text-[10.5px] text-slate-400">até</span>
                      <input
                        type="time"
                        value={ch.businessHoursEnd}
                        onChange={(e) => updateChannel(ch.channel, { businessHoursEnd: e.target.value })}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                      />
                    </div>
                    <div className="flex gap-1">
                      {WEEKDAY_LABELS.map((label, day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleBusinessDay(ch.channel, day)}
                          className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                            ch.businessDays.includes(day)
                              ? style.dayOn
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          {label[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full bg-purple-700 hover:bg-purple-800 disabled:bg-slate-300 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
      >
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        <span>{isSaving ? 'Salvando...' : 'Salvar Canais de Atendimento'}</span>
      </button>
    </div>
  );
};
