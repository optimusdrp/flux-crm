import React, { useState, useEffect } from 'react';
import { Save, Loader2, Plus, X, GripVertical, Kanban, Star } from 'lucide-react';
import { FunnelConfig, FunnelStageConfig } from '../../types';
import { apiService } from '../../services/api';
import { useToast } from '../../context/ToastContext';

// ---------------------------------------------------------------------------
// Item revisado: implementação real da tela "Jornadas e funis", antes um
// modal genérico. Permite criar/renomear/remover funis (Atendimento
// inicial, Comercial, Exames e guias, Pós-atendimento, Recall...) e, para
// cada um, adicionar/remover/reordenar as etapas (colunas do Kanban que
// JornadasView exibe).
// ---------------------------------------------------------------------------

const STAGE_COLORS = ['purple', 'amber', 'blue', 'emerald', 'rose', 'slate'] as const;

const STAGE_COLOR_CLASSES: Record<string, string> = {
  purple: 'bg-purple-100 text-purple-800 border-purple-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  blue: 'bg-blue-100 text-blue-800 border-blue-300',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  rose: 'bg-rose-100 text-rose-800 border-rose-300',
  slate: 'bg-slate-100 text-slate-700 border-slate-300',
};

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export const FunnelsSettings: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const [funnels, setFunnels] = useState<FunnelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null);
  const [newStageLabel, setNewStageLabel] = useState('');

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const settings = await apiService.getClinicSettings();
      if (settings?.funnels) {
        setFunnels(settings.funnels);
        setSelectedFunnelId(settings.funnels[0]?.id || null);
      }
      setIsLoading(false);
    })();
  }, []);

  const selectedFunnel = funnels.find((f) => f.id === selectedFunnelId);

  const updateFunnelName = (id: string, name: string) => {
    setFunnels((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  };

  const setDefaultFunnel = (id: string) => {
    setFunnels((prev) => prev.map((f) => ({ ...f, isDefault: f.id === id })));
  };

  const addFunnel = () => {
    const newFunnel: FunnelConfig = {
      id: generateId('funil'),
      name: 'Novo Funil',
      isDefault: false,
      stages: [
        { id: generateId('etapa'), label: 'Nova etapa', order: 1, color: 'purple' },
      ],
    };
    setFunnels((prev) => [...prev, newFunnel]);
    setSelectedFunnelId(newFunnel.id);
  };

  const removeFunnel = (id: string) => {
    const funnel = funnels.find((f) => f.id === id);
    if (funnel?.isDefault) return; // não permite remover o funil padrão
    setFunnels((prev) => prev.filter((f) => f.id !== id));
    if (selectedFunnelId === id) setSelectedFunnelId(funnels[0]?.id || null);
  };

  const addStage = (funnelId: string) => {
    const label = newStageLabel.trim();
    if (!label) return;
    setFunnels((prev) =>
      prev.map((f) => {
        if (f.id !== funnelId) return f;
        const nextOrder = f.stages.length + 1;
        const color = STAGE_COLORS[f.stages.length % STAGE_COLORS.length];
        const newStage: FunnelStageConfig = { id: generateId('etapa'), label, order: nextOrder, color };
        return { ...f, stages: [...f.stages, newStage] };
      })
    );
    setNewStageLabel('');
  };

  const removeStage = (funnelId: string, stageId: string) => {
    setFunnels((prev) =>
      prev.map((f) => {
        if (f.id !== funnelId) return f;
        const stages = f.stages.filter((s) => s.id !== stageId).map((s, i) => ({ ...s, order: i + 1 }));
        return { ...f, stages };
      })
    );
  };

  const moveStage = (funnelId: string, stageId: string, direction: -1 | 1) => {
    setFunnels((prev) =>
      prev.map((f) => {
        if (f.id !== funnelId) return f;
        const idx = f.stages.findIndex((s) => s.id === stageId);
        const swapIdx = idx + direction;
        if (idx === -1 || swapIdx < 0 || swapIdx >= f.stages.length) return f;
        const stages = [...f.stages];
        [stages[idx], stages[swapIdx]] = [stages[swapIdx], stages[idx]];
        return { ...f, stages: stages.map((s, i) => ({ ...s, order: i + 1 })) };
      })
    );
  };

  const renameStage = (funnelId: string, stageId: string, label: string) => {
    setFunnels((prev) =>
      prev.map((f) =>
        f.id === funnelId ? { ...f, stages: f.stages.map((s) => (s.id === stageId ? { ...s, label } : s)) } : f
      )
    );
  };

  const handleSave = async () => {
    // Ao menos um funil precisa continuar marcado como padrão — proteção
    // simples no cliente antes de enviar ao servidor.
    if (!funnels.some((f) => f.isDefault)) {
      showError('Nenhum funil padrão definido', 'Marque um funil como padrão antes de salvar.');
      return;
    }
    setIsSaving(true);
    const result = await apiService.updateClinicSettingsCategory('funnels', funnels);
    setIsSaving(false);
    if (result.items) {
      showSuccess('Funis atualizados', 'As jornadas e etapas foram salvas.');
    } else {
      showError('Não foi possível salvar', result.error || 'Tente novamente em instantes.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-xs">Carregando funis...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        Cada funil define as colunas do Kanban exibido na tela de Jornadas. O funil marcado como padrão é aberto
        automaticamente quando a equipe acessa a tela.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {funnels.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSelectedFunnelId(f.id)}
            className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl border transition-colors cursor-pointer ${
              selectedFunnelId === f.id
                ? 'bg-purple-800 text-white border-purple-800'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.isDefault && <Star className="w-3 h-3 fill-current" />}
            {f.name}
          </button>
        ))}
        <button
          type="button"
          onClick={addFunnel}
          className="flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-xl border border-dashed border-purple-300 text-purple-700 hover:bg-purple-50 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Novo funil
        </button>
      </div>

      {selectedFunnel && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Kanban className="w-4 h-4 text-purple-600 shrink-0" />
            <input
              type="text"
              value={selectedFunnel.name}
              onChange={(e) => updateFunnelName(selectedFunnel.id, e.target.value)}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            />
            <button
              type="button"
              onClick={() => setDefaultFunnel(selectedFunnel.id)}
              disabled={selectedFunnel.isDefault}
              className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border shrink-0 cursor-pointer transition-colors ${
                selectedFunnel.isDefault
                  ? 'bg-amber-100 text-amber-800 border-amber-300 cursor-default'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {selectedFunnel.isDefault ? 'Funil padrão' : 'Tornar padrão'}
            </button>
            {!selectedFunnel.isDefault && (
              <button
                type="button"
                onClick={() => removeFunnel(selectedFunnel.id)}
                className="p-1.5 text-slate-400 hover:text-red-600 shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {selectedFunnel.stages.map((stage, idx) => (
              <div
                key={stage.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${STAGE_COLOR_CLASSES[stage.color] || STAGE_COLOR_CLASSES.slate}`}
              >
                <GripVertical className="w-3.5 h-3.5 opacity-50 shrink-0" />
                <span className="text-[10px] font-black opacity-60 w-4 shrink-0">{idx + 1}</span>
                <input
                  type="text"
                  value={stage.label}
                  onChange={(e) => renameStage(selectedFunnel.id, stage.id, e.target.value)}
                  className="flex-1 bg-white/60 border border-black/5 rounded-lg px-2 py-1 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                />
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveStage(selectedFunnel.id, stage.id, -1)}
                    disabled={idx === 0}
                    className="p-1 rounded hover:bg-black/5 disabled:opacity-30 cursor-pointer"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStage(selectedFunnel.id, stage.id, 1)}
                    disabled={idx === selectedFunnel.stages.length - 1}
                    className="p-1 rounded hover:bg-black/5 disabled:opacity-30 cursor-pointer"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStage(selectedFunnel.id, stage.id)}
                    disabled={selectedFunnel.stages.length <= 1}
                    className="p-1 rounded hover:bg-black/5 disabled:opacity-30 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newStageLabel}
              onChange={(e) => setNewStageLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStage(selectedFunnel.id); } }}
              placeholder="Nome da nova etapa..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            />
            <button
              type="button"
              onClick={() => addStage(selectedFunnel.id)}
              className="p-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full bg-purple-700 hover:bg-purple-800 disabled:bg-slate-300 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
      >
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        <span>{isSaving ? 'Salvando...' : 'Salvar Jornadas e Funis'}</span>
      </button>
    </div>
  );
};
