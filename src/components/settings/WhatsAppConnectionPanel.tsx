import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QrCode, CheckCircle2, XCircle, Loader2, Unplug, RefreshCw, ShieldAlert } from 'lucide-react';
import { apiService } from '../../services/api';
import { useToast } from '../../context/ToastContext';

// ---------------------------------------------------------------------------
// Conexão real com WhatsApp (whatsapp-web.js) — painel usado dentro do
// canal "WhatsApp" em ChannelsSettings.tsx. Diferente dos demais canais
// (Telegram, Instagram, Site), que hoje só guardam um identificador de
// texto livre, o WhatsApp aqui tem um ciclo de vida real de conexão:
// gerar QR code → aguardar o usuário escanear com o celular → confirmar
// conectado — ou desconectar de propósito.
//
// O polling (setInterval consultando GET /api/whatsapp/status) é a forma
// mais simples de acompanhar esse ciclo sem abrir um WebSocket dedicado
// só para isso — 2 segundos de intervalo é responsivo o bastante para uma
// pessoa aguardando escanear um QR code, sem gerar carga real no servidor.
// ---------------------------------------------------------------------------

type WaStatus = 'disconnected' | 'initializing' | 'qr_pending' | 'connected' | 'auth_failed';

const POLL_INTERVAL_MS = 2000;

export const WhatsAppConnectionPanel: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const [status, setStatus] = useState<WaStatus>('disconnected');
  const [qrDataUrl, setQrDataUrl] = useState<string | undefined>();
  const [connectedNumber, setConnectedNumber] = useState<string | undefined>();
  const [lastError, setLastError] = useState<string | undefined>();
  const [isActing, setIsActing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyStatus = useCallback((s: { status: string; qrDataUrl?: string; connectedNumber?: string; lastError?: string }) => {
    setStatus(s.status as WaStatus);
    setQrDataUrl(s.qrDataUrl);
    setConnectedNumber(s.connectedNumber);
    setLastError(s.lastError);
    // Parar de fazer polling assim que a conexão chega num estado final
    // (conectado ou falhou) — continuar consultando um estado que não vai
    // mudar sozinho só gastaria requisições à toa.
    if (s.status === 'connected' || s.status === 'auth_failed' || s.status === 'disconnected') {
      stopPolling();
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const s = await apiService.getWhatsAppStatus();
      applyStatus(s);
    }, POLL_INTERVAL_MS);
  }, [applyStatus, stopPolling]);

  // Consulta o status uma vez ao montar o componente — se a clínica já
  // tinha uma sessão conectada de uma visita anterior à tela, reflete isso
  // imediatamente em vez de mostrar "desconectado" por engano até o
  // primeiro polling rodar.
  useEffect(() => {
    (async () => {
      const s = await apiService.getWhatsAppStatus();
      applyStatus(s);
      if (s.status === 'initializing' || s.status === 'qr_pending') {
        startPolling();
      }
    })();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setIsActing(true);
    const result = await apiService.connectWhatsApp();
    setIsActing(false);
    if (result.error) {
      showError('Não foi possível iniciar a conexão', result.error);
      return;
    }
    applyStatus({ status: result.status, qrDataUrl: result.qrDataUrl });
    startPolling();
  };

  const handleDisconnect = async () => {
    setIsActing(true);
    const result = await apiService.disconnectWhatsApp();
    setIsActing(false);
    stopPolling();
    if (result.success) {
      setStatus('disconnected');
      setQrDataUrl(undefined);
      setConnectedNumber(undefined);
      showSuccess('WhatsApp desconectado', 'A sessão foi encerrada. Será necessário escanear um novo QR code para reconectar.');
    } else {
      showError('Não foi possível desconectar', result.error || 'Tente novamente em instantes.');
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-3">
      <div className="flex items-center gap-2">
        <QrCode className="w-4 h-4 text-emerald-700" />
        <p className="text-xs font-bold text-emerald-900">Conexão real com WhatsApp</p>
      </div>

      {status === 'disconnected' && (
        <div className="space-y-2.5">
          <p className="text-[11px] text-slate-600">
            Ainda não conectado. Ao clicar em conectar, um QR code aparecerá aqui — abra o WhatsApp no celular da
            clínica, vá em <strong>Aparelhos conectados → Conectar um aparelho</strong>, e escaneie.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isActing}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            {isActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
            Conectar WhatsApp
          </button>
        </div>
      )}

      {(status === 'initializing' || (status === 'qr_pending' && !qrDataUrl)) && (
        <div className="flex items-center gap-2 text-[11px] text-slate-600 py-2">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          Preparando a conexão — isso pode levar alguns segundos...
        </div>
      )}

      {status === 'qr_pending' && qrDataUrl && (
        <div className="space-y-2.5">
          <p className="text-[11px] text-slate-600">
            Abra o WhatsApp no celular da clínica → <strong>Aparelhos conectados → Conectar um aparelho</strong> e
            escaneie o código abaixo:
          </p>
          <div className="bg-white rounded-xl border border-slate-200 p-3 inline-block">
            <img src={qrDataUrl} alt="QR code para conectar o WhatsApp" className="w-48 h-48" />
          </div>
          <p className="text-[10.5px] text-slate-400">O código expira em alguns minutos — clique em "Gerar novo código" se ele parar de funcionar.</p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isActing}
            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Gerar novo código
          </button>
        </div>
      )}

      {status === 'connected' && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            <p className="text-xs font-semibold">
              Conectado{connectedNumber ? ` — número ${connectedNumber}` : ''}
            </p>
          </div>
          <p className="text-[11px] text-slate-600">
            As mensagens recebidas neste número já aparecem na Caixa de Entrada de Atendimentos.
          </p>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isActing}
            className="px-3.5 py-2 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded-lg text-xs font-semibold flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            {isActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
            Desconectar
          </button>
        </div>
      )}

      {status === 'auth_failed' && (
        <div className="space-y-2.5">
          <div className="flex items-start gap-2 text-red-700">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold">Não foi possível conectar</p>
              {lastError && <p className="text-[10.5px] text-red-500 mt-0.5 break-words">{lastError}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isActing}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            {isActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Tentar novamente
          </button>
        </div>
      )}

      <div className="flex items-start gap-1.5 pt-1.5 border-t border-emerald-200/60">
        <ShieldAlert className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" />
        <p className="text-[10px] text-emerald-700/80">
          A sessão fica salva no servidor da clínica — desconectar aqui revoga o acesso de verdade, como remover um
          aparelho conectado no WhatsApp do celular.
        </p>
      </div>
    </div>
  );
};
