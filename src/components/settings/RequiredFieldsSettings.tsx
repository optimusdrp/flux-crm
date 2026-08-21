import React, { useState, useEffect } from 'react';
import { Save, Loader2, Lock, LockOpen, Plus, X, CheckSquare } from 'lucide-react';
import { RequiredFieldsRule } from '../../types';
import { apiService } from '../../services/api';
import { useToast } from '../../context/ToastContext';

// ---------------------------------------------------------------------------
// Item revisado: implementação real da tela "Campos obrigatórios", antes um
// modal genérico. Para cada etapa do funil padrão, define quais campos do
// paciente e quais itens de checklist são obrigatórios, e se a ausência
// deles bloqueia o avanço de etapa.
// ---------------------------------------------------------------------------

// Campos de Patient que fazem sentido exigir antes de avançar de etapa —
// deliberadamente não inclui campos de controle interno (id, status,
// lastMessage...) que nunca seriam "preenchidos manualmente" pela equipe.
const AVAILABLE_PATIENT_FIELDS: { field: string; label: string }[] = [
  { field: 'name', label: 'Nome do paciente' },
  { field: 'phone', label: 'Telefone' },
  { field: 'cpf', label: 'CPF' },
  { field: 'birthDate', label: 'Data de nascimento' },
  { field: 'insurance', label: 'Convênio' },
  { field: 'planType', label: 'Tipo de plano' },
  { field: 'specialty', label: 'Especialidade' },
  { field: 'appointmentDate', label: 'Data do agendamento' },
  { field: 'appointmentTime', label: 'Horário do agendamento' },
];

interface RequiredFieldsSettingsProps {
  onClose?: () => void;
}

export const RequiredFieldsSettings: React.FC<RequiredFieldsSettingsProps> = () => {
  const { showSuccess, showError } = useToast();
  const [rules, setRules] = useState<RequiredFieldsRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newChecklistLabel, setNewChecklistLabel] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const settings = await apiService.getClinicSettings();
      if (settings?.requiredFields) setRules(settings.requiredFields);
      setIsLoading(false);
    })();
  }, []);

  const updateRule = (stage: string, patch: Partial<RequiredFieldsRule>) => {
    setRules((prev) => prev.map((r) => (r.stage === stage ? { ...r, ...patch } : r)));
  };

  const togglePatientField = (stage: string, field: string) => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.stage !== stage) return r;
        const has = r.requiredPatientFields.includes(field);
        return {
          ...r,
          requiredPatientFields: has
            ? r.requiredPatientFields.filter((f) => f !== field)
            : [...r.requiredPatientFields, field],
        };
      })
    );
  };

  const addChecklistItem = (stage: string) => {
    const label = (newChecklistLabel[stage] || '').trim();
    if (!label) return;
    setRules((prev) =>
      prev.map((r) => (r.stage === stage ? { ...r, requiredChecklistItems: [...r.requiredChecklistItems, label] } : r))
    );
    setNewChecklistLabel((prev) => ({ ...prev, [stage]: '' }));
  };

  const removeChecklistItem = (stage: string, item: string) => {
    setRules((prev) =>
      prev.map((r) =>
        r.stage === stage ? { ...r, requiredChecklistItems: r.requiredChecklistItems.filter((i) => i !== item) } : r
      )
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    const result = await apiService.updateClinicSettingsCategory('requiredFields', rules);
    setIsSaving(false);
    if (result.items) {
      showSuccess('Regras salvas', 'Os campos obrigatórios por etapa foram atualizados.');
    } else {
      showError('Não foi possível salvar', result.error || 'Tente novamente em instantes.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-xs">Carregando regras...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        Para cada etapa do funil, escolha quais dados do paciente e quais itens de checklist precisam estar
        preenchidos. Quando "bloquear avanço" está ativo, a equipe não consegue mover o paciente para a próxima
        etapa sem completar os itens marcados.
      </p>

      <div className="space-y-3">
        {rules.map((rule) => (
          <div key={rule.stage} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-900">{rule.stageLabel}</p>
              <button
                type="button"
                onClick={() => updateRule(rule.stage, { blockAdvanceIfIncomplete: !rule.blockAdvanceIfIncomplete })}
                className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full transition-colors cursor-pointer ${
                  rule.blockAdvanceIfIncomplete
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'
                }`}
              >
                {rule.blockAdvanceIfIncomplete ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
                {rule.blockAdvanceIfIncomplete ? 'Bloqueia avanço' : 'Não bloqueia'}
              </button>
            </div>

            <div>
              <p className="text-[10.5px] font-bold text-slate-600 mb-1.5">Campos do paciente exigidos</p>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_PATIENT_FIELDS.map((f) => {
                  const active = rule.requiredPatientFields.includes(f.field);
                  return (
                    <button
                      key={f.field}
                      type="button"
                      onClick={() => togglePatientField(rule.stage, f.field)}
                      className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                        active
                          ? 'bg-purple-100 border-purple-300 text-purple-900'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10.5px] font-bold text-slate-600 mb-1.5 flex items-center gap-1">
                <CheckSquare className="w-3 h-3" /> Itens de checklist exigidos
              </p>
              <div className="space-y-1.5">
                {rule.requiredChecklistItems.map((item) => (
                  <div key={item} className="flex items-center justify-between bg-slate-50 rounded-lg px-2.5 py-1.5">
                    <span className="text-[10.5px] text-slate-700">{item}</span>
                    <button
                      type="button"
                      onClick={() => removeChecklistItem(rule.stage, item)}
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <input
                  type="text"
                  value={newChecklistLabel[rule.stage] || ''}
                  onChange={(e) => setNewChecklistLabel((prev) => ({ ...prev, [rule.stage]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(rule.stage); }
                  }}
                  placeholder="Novo item de checklist..."
                  className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[10.5px] focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                />
                <button
                  type="button"
                  onClick={() => addChecklistItem(rule.stage)}
                  className="p-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full bg-purple-700 hover:bg-purple-800 disabled:bg-slate-300 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
      >
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        <span>{isSaving ? 'Salvando...' : 'Salvar Campos Obrigatórios'}</span>
      </button>
    </div>
  );
};
