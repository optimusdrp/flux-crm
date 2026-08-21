import React, { useState, useEffect } from 'react';
import { Pencil, X, Save, Loader2 } from 'lucide-react';
import { Patient } from '../types';
import { apiService } from '../services/api';
import { useToast } from '../context/ToastContext';

// ---------------------------------------------------------------------------
// Item revisado: implementação real da edição de cadastro de paciente.
// Antes, a aba "Dados" do chat de atendimento era somente leitura — inclusive
// mostrava um CPF de exemplo fixo ("321.654.987-00") quando o paciente não
// tinha um cadastrado, o que podia confundir quem lesse a tela achando que
// era um dado real. A API (PUT /api/patients/:id) já suportava editar esses
// campos há tempo; só faltava a tela.
//
// Usado tanto na variante desktop (painel lateral completo) quanto na
// variante mobile (painel resumido) da aba Dados em AtendimentosView.tsx —
// por isso é um componente próprio, não duplicado inline nos dois lugares.
// ---------------------------------------------------------------------------

const INSURANCE_OPTIONS = [
  'Particular',
  'Bradesco Saúde',
  'SulAmérica',
  'Unimed',
  'Amil',
  'NotreDame Intermédica',
  'Hapvida',
];

const SPECIALTY_OPTIONS = [
  'Cardiologia',
  'Odontologia / Ortodontia',
  'Dermatologia',
  'Ginecologia',
  'Cirurgia Geral',
  'Clínica Geral',
];

interface PatientEditFormProps {
  patient: Patient;
  onSaved: (updated: Patient) => void;
  /** Variante compacta usada no painel resumido mobile — mostra menos campos. */
  compact?: boolean;
}

interface FormState {
  name: string;
  phone: string;
  cpf: string;
  birthDate: string;
  insurance: string;
  planType: string;
  specialty: string;
}

function toFormState(p: Patient): FormState {
  return {
    name: p.name || '',
    phone: p.phone || '',
    cpf: p.cpf || '',
    birthDate: p.birthDate || '',
    insurance: p.insurance || '',
    planType: p.planType || '',
    specialty: p.specialty || '',
  };
}

// Validação simples de CPF: 11 dígitos numéricos (sem verificar dígito
// verificador — o objetivo aqui é pegar erros de digitação óbvios, como
// letras ou tamanho errado, não substituir uma validação de CPF completa).
function isValidCpfFormat(cpf: string): boolean {
  if (!cpf.trim()) return true; // campo opcional, vazio é válido
  const digits = cpf.replace(/\D/g, '');
  return digits.length === 11;
}

function isValidPhoneFormat(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 11;
}

export const PatientEditForm: React.FC<PatientEditFormProps> = ({ patient, onSaved, compact }) => {
  const { showSuccess, showError } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() => toFormState(patient));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // Se o paciente selecionado mudar (usuário trocou de conversa) enquanto
  // não está editando, sincroniza o formulário com os dados do novo
  // paciente. Se estiver editando, não sobrescreve o que a pessoa já
  // digitou — evita perder uma edição em andamento por causa de uma
  // atualização em segundo plano.
  useEffect(() => {
    if (!isEditing) {
      setForm(toFormState(patient));
    }
  }, [patient.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEditing = () => {
    setForm(toFormState(patient));
    setFieldErrors({});
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setForm(toFormState(patient));
    setFieldErrors({});
    setIsEditing(false);
  };

  const updateField = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const validate = (): boolean => {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) {
      errors.name = 'Nome é obrigatório.';
    }
    if (!form.phone.trim()) {
      errors.phone = 'Telefone é obrigatório.';
    } else if (!isValidPhoneFormat(form.phone)) {
      errors.phone = 'Telefone deve ter 10 ou 11 dígitos (com DDD).';
    }
    if (!isValidCpfFormat(form.cpf)) {
      errors.cpf = 'CPF deve ter 11 dígitos.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setIsSaving(true);
    const result = await apiService.updatePatient(patient.id, {
      name: form.name.trim(),
      phone: form.phone.trim(),
      cpf: form.cpf.trim() || undefined,
      birthDate: form.birthDate.trim() || undefined,
      insurance: form.insurance.trim(),
      planType: form.planType.trim() || undefined,
      specialty: form.specialty.trim() || undefined,
    });
    setIsSaving(false);

    if (result.patient) {
      showSuccess('Cadastro atualizado', `Os dados de ${result.patient.name} foram salvos.`);
      onSaved(result.patient);
      setIsEditing(false);
    } else {
      showError('Não foi possível salvar', result.error || 'Verifique sua conexão e tente novamente.');
    }
  };

  if (!isEditing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Dados cadastrais</span>
          <button
            type="button"
            onClick={startEditing}
            className="flex items-center gap-1 text-[10.5px] font-bold text-purple-700 hover:text-purple-900 cursor-pointer"
          >
            <Pencil className="w-3 h-3" />
            Editar
          </button>
        </div>

        <div>
          <span className="text-slate-400 block text-[10px]">Nome completo</span>
          <p className="font-bold text-slate-800">{patient.name}</p>
        </div>

        <div>
          <span className="text-slate-400 block text-[10px]">Telefone</span>
          <p className="font-bold text-slate-800">{patient.phone}</p>
        </div>

        <div>
          <span className="text-slate-400 block text-[10px]">CPF</span>
          <p className="font-mono font-bold text-slate-800">
            {patient.cpf || <span className="text-slate-400 font-sans italic font-normal">Não informado</span>}
          </p>
        </div>

        {!compact && (
          <div>
            <span className="text-slate-400 block text-[10px]">Data de Nascimento</span>
            <p className="font-bold text-slate-800">
              {patient.birthDate || <span className="text-slate-400 italic font-normal">Não informada</span>}
            </p>
          </div>
        )}

        <div>
          <span className="text-slate-400 block text-[10px]">Convênio / Carteirinha</span>
          <p className="font-bold text-purple-900">
            {patient.insurance}
            {!compact && patient.planType ? ` (${patient.planType})` : ''}
          </p>
        </div>

        {!compact && (
          <div>
            <span className="text-slate-400 block text-[10px]">Especialidade</span>
            <p className="text-slate-700">
              {patient.specialty || <span className="text-slate-400 italic">Não informada</span>}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wide">Editando cadastro</span>
        <button type="button" onClick={cancelEditing} className="text-slate-400 hover:text-slate-700 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div>
        <label className="text-slate-500 block text-[10px] mb-1">Nome completo *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => updateField('name', e.target.value)}
          className={`w-full bg-white border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30 ${
            fieldErrors.name ? 'border-red-400' : 'border-slate-200'
          }`}
        />
        {fieldErrors.name && <p className="text-[10px] text-red-600 mt-0.5">{fieldErrors.name}</p>}
      </div>

      <div>
        <label className="text-slate-500 block text-[10px] mb-1">Telefone *</label>
        <input
          type="text"
          value={form.phone}
          onChange={(e) => updateField('phone', e.target.value)}
          placeholder="(11) 98765-4321"
          className={`w-full bg-white border rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/30 ${
            fieldErrors.phone ? 'border-red-400' : 'border-slate-200'
          }`}
        />
        {fieldErrors.phone && <p className="text-[10px] text-red-600 mt-0.5">{fieldErrors.phone}</p>}
      </div>

      <div>
        <label className="text-slate-500 block text-[10px] mb-1">CPF</label>
        <input
          type="text"
          value={form.cpf}
          onChange={(e) => updateField('cpf', e.target.value)}
          placeholder="000.000.000-00"
          className={`w-full bg-white border rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/30 ${
            fieldErrors.cpf ? 'border-red-400' : 'border-slate-200'
          }`}
        />
        {fieldErrors.cpf && <p className="text-[10px] text-red-600 mt-0.5">{fieldErrors.cpf}</p>}
      </div>

      {!compact && (
        <div>
          <label className="text-slate-500 block text-[10px] mb-1">Data de Nascimento</label>
          <input
            type="text"
            value={form.birthDate}
            onChange={(e) => updateField('birthDate', e.target.value)}
            placeholder="DD/MM/AAAA"
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30"
          />
        </div>
      )}

      <div>
        <label className="text-slate-500 block text-[10px] mb-1">Convênio</label>
        <select
          value={form.insurance}
          onChange={(e) => updateField('insurance', e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30"
        >
          {!INSURANCE_OPTIONS.includes(form.insurance) && form.insurance && (
            <option value={form.insurance}>{form.insurance}</option>
          )}
          {INSURANCE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      {!compact && (
        <>
          <div>
            <label className="text-slate-500 block text-[10px] mb-1">Plano / Carteirinha</label>
            <input
              type="text"
              value={form.planType}
              onChange={(e) => updateField('planType', e.target.value)}
              placeholder="Ex.: Topázio Nacional"
              className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            />
          </div>

          <div>
            <label className="text-slate-500 block text-[10px] mb-1">Especialidade</label>
            <select
              value={form.specialty}
              onChange={(e) => updateField('specialty', e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            >
              <option value="">Não informada</option>
              {!SPECIALTY_OPTIONS.includes(form.specialty) && form.specialty && (
                <option value={form.specialty}>{form.specialty}</option>
              )}
              {SPECIALTY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-bold bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white py-2 rounded-xl cursor-pointer"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar
        </button>
        <button
          type="button"
          onClick={cancelEditing}
          disabled={isSaving}
          className="text-[11px] font-bold text-slate-500 hover:text-slate-700 px-3 py-2 rounded-xl cursor-pointer"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
};
