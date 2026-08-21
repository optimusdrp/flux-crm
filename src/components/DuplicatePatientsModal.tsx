import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Phone,
  IdCard,
  UserCheck,
} from 'lucide-react';
import { DuplicateCandidate, Patient, DuplicateMatchReason } from '../types';
import { apiService } from '../services/api';
import { useToast } from '../context/ToastContext';

// ---------------------------------------------------------------------------
// Item revisado: tela de detecção de pacientes duplicados, com fluxo de
// unificação. Acessível apenas a quem tem a ação granular "patients.merge"
// concedida (o botão que abre este modal já não aparece para quem não tem
// a ação — ver ConfiguracoesView.tsx / AtendimentosView.tsx).
//
// A escolha de qual dos dois registros vira o principal é SEMPRE do
// usuário — este componente nunca pré-seleciona um lado com base em
// heurística nenhuma; a pessoa precisa clicar explicitamente em qual
// manter antes de poder confirmar a mesclagem.
// ---------------------------------------------------------------------------

interface DuplicatePatientsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMerged?: () => void; // avisa o componente pai para recarregar a lista de pacientes
}

const REASON_LABEL: Record<DuplicateMatchReason, { label: string; icon: React.ReactNode }> = {
  cpf: { label: 'Mesmo CPF', icon: <IdCard className="w-3 h-3" /> },
  phone: { label: 'Mesmo telefone', icon: <Phone className="w-3 h-3" /> },
  name: { label: 'Nome muito parecido', icon: <UserCheck className="w-3 h-3" /> },
};

function PatientMiniCard({
  patient,
  isSelected,
  onSelect,
}: {
  patient: Patient;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left w-full p-3 rounded-2xl border-2 transition-all cursor-pointer ${
        isSelected
          ? 'border-emerald-500 bg-emerald-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold text-slate-900">{patient.name}</p>
          <p className="text-[10.5px] text-slate-500 mt-0.5">{patient.phone}</p>
          {patient.cpf && <p className="text-[10.5px] text-slate-500">CPF: {patient.cpf}</p>}
          <p className="text-[10.5px] text-slate-500">{patient.insurance || 'Particular'}</p>
        </div>
        {isSelected && (
          <span className="flex items-center gap-1 text-[9.5px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex-shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Manter
          </span>
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-slate-100 flex gap-3 text-[9.5px] text-slate-400">
        <span>{patient.checklist?.length || 0} itens de checklist</span>
        <span>{patient.internalNotes?.length || 0} notas internas</span>
        <span>{patient.tags?.length || 0} tags</span>
      </div>
    </button>
  );
}

export const DuplicatePatientsModal: React.FC<DuplicatePatientsModalProps> = ({ isOpen, onClose, onMerged }) => {
  const { showSuccess, showError } = useToast();
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedKeepId, setSelectedKeepId] = useState<Record<number, string>>({});
  const [mergingIndex, setMergingIndex] = useState<number | null>(null);

  const loadCandidates = async () => {
    setIsLoading(true);
    const result = await apiService.getDuplicatePatients();
    setCandidates(result);
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadCandidates();
      setSelectedKeepId({});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleMerge = async (index: number) => {
    const candidate = candidates[index];
    const keepId = selectedKeepId[index];
    if (!keepId) {
      showError('Selecione qual registro manter', 'Escolha um dos dois pacientes antes de unificar.');
      return;
    }
    const otherId = keepId === candidate.patientA.id ? candidate.patientB.id : candidate.patientA.id;

    setMergingIndex(index);
    const result = await apiService.mergePatients(keepId, otherId);
    setMergingIndex(null);

    if (result) {
      showSuccess(
        'Pacientes unificados!',
        result.chatMessagesReassigned > 0
          ? `${result.chatMessagesReassigned} mensagem(ns) de chat reatribuída(s). ${result.note}`
          : result.note
      );
      setCandidates((prev) => prev.filter((_, i) => i !== index));
      onMerged?.();
    } else {
      showError('Não foi possível unificar', 'Verifique sua permissão ou tente novamente.');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white w-full max-w-2xl max-h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-100 flex items-center justify-center">
              <Users className="w-4.5 h-4.5 text-amber-700" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Pacientes Duplicados</h2>
              <p className="text-[10.5px] text-slate-500">Detecção por CPF, telefone e nome parecido</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 cursor-pointer">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-xs">Analisando pacientes cadastrados...</p>
            </div>
          )}

          {!isLoading && candidates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <ShieldAlert className="w-8 h-8 text-emerald-400" />
              <p className="text-xs font-semibold text-slate-700">Nenhum paciente duplicado encontrado</p>
              <p className="text-[10.5px] text-slate-400 max-w-xs">
                A busca compara CPF, telefone e similaridade de nome entre todos os pacientes cadastrados.
              </p>
            </div>
          )}

          {!isLoading &&
            candidates.map((candidate, index) => (
              <div key={`${candidate.patientA.id}-${candidate.patientB.id}`} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="flex items-center gap-1 text-[9.5px] font-bold text-amber-800 bg-amber-100 px-2 py-1 rounded-full"
                      >
                        {REASON_LABEL[reason].icon}
                        {REASON_LABEL[reason].label}
                      </span>
                    ))}
                  </div>
                  <span className="text-[9.5px] font-bold text-slate-400">{candidate.confidence}% de confiança</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <PatientMiniCard
                    patient={candidate.patientA}
                    isSelected={selectedKeepId[index] === candidate.patientA.id}
                    onSelect={() => setSelectedKeepId((prev) => ({ ...prev, [index]: candidate.patientA.id }))}
                  />
                  <PatientMiniCard
                    patient={candidate.patientB}
                    isSelected={selectedKeepId[index] === candidate.patientB.id}
                    onSelect={() => setSelectedKeepId((prev) => ({ ...prev, [index]: candidate.patientB.id }))}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    O registro não selecionado será removido; dados úteis são combinados no principal.
                  </p>
                  <button
                    onClick={() => handleMerge(index)}
                    disabled={!selectedKeepId[index] || mergingIndex === index}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 disabled:cursor-not-allowed px-3 py-1.5 rounded-xl transition-colors cursor-pointer flex-shrink-0"
                  >
                    {mergingIndex === index ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    Unificar
                  </button>
                </div>
              </div>
            ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-between items-center">
          <button
            onClick={loadCandidates}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar busca
          </button>
          <span className="text-[10px] text-slate-400">{candidates.length} par(es) encontrado(s)</span>
        </div>
      </div>
    </div>
  );
};
