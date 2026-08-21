import { GetCommand, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { recordAppointmentUsage } from "../billing/usageService";
import type { Message as WhatsAppMessage } from "whatsapp-web.js";

// ---------------------------------------------------------------------------
// Sincronização de mensagens recebidas do WhatsApp com a Caixa de Entrada
// de Atendimentos — ligado ao evento client.on('message', ...) em
// sessionManager.ts. Este módulo é o único ponto onde uma mensagem do
// WhatsApp real vira um paciente e uma mensagem de chat no MediFlux; a
// intenção é manter essa lógica de negócio separada da gestão de sessão
// (sessionManager.ts só cuida de conectar/desconectar).
//
// Formata o número de telefone da mesma forma que os cadastros manuais e
// os dados de exemplo já usam ("(11) 98765-0000"), para consistência
// visual na interface — o WhatsApp entrega o número como
// "<código do país><DDD><número>@c.us" (ex.: "5511987650000@c.us").
// ---------------------------------------------------------------------------

function formatPhoneFromWhatsAppId(waId: string): string {
  // waId chega como "5511987650000@c.us" — remove o sufixo e o código do
  // país (Brasil, "55") quando presente, deixando "11987650000".
  const digitsOnly = waId.replace(/@c\.us$/, "").replace(/\D/g, "");
  const withoutCountryCode = digitsOnly.startsWith("55") && digitsOnly.length > 11 ? digitsOnly.slice(2) : digitsOnly;

  if (withoutCountryCode.length === 11) {
    // Celular com 9º dígito: (11) 98765-0000
    return `(${withoutCountryCode.slice(0, 2)}) ${withoutCountryCode.slice(2, 7)}-${withoutCountryCode.slice(7)}`;
  }
  if (withoutCountryCode.length === 10) {
    // Fixo ou celular sem 9º dígito: (11) 8765-0000
    return `(${withoutCountryCode.slice(0, 2)}) ${withoutCountryCode.slice(2, 6)}-${withoutCountryCode.slice(6)}`;
  }
  // Formato inesperado — devolve os dígitos como vieram, em vez de
  // quebrar a sincronização por causa de um número fora do padrão.
  return withoutCountryCode || waId;
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Processa uma mensagem recebida de um Client conectado: encontra ou cria
 * o paciente correspondente ao número de origem (dentro da clínica dona
 * dessa sessão) e grava a mensagem no histórico do chat — o mesmo efeito
 * que POST /api/chat/:patientId teria, chamado diretamente em vez de via
 * HTTP, já que isso roda dentro do próprio processo do servidor, não numa
 * requisição de um usuário.
 *
 * "Melhor esforço" como o resto da integração de WhatsApp: uma falha aqui
 * é registrada no log, mas nunca derruba a sessão do WhatsApp em si — a
 * próxima mensagem tem uma nova chance de sincronizar corretamente.
 */
export async function syncIncomingMessage(clinicId: string, message: WhatsAppMessage): Promise<void> {
  // Mensagens enviadas pela própria clínica (ex.: um atendente respondendo
  // direto pelo celular, fora do MediFlux) não são "recebidas" — evita
  // duplicar como se fosse uma mensagem nova do paciente.
  if (message.fromMe) return;

  // Mensagens de grupo (message.from termina em @g.us, não @c.us) ficam
  // fora do escopo desta sincronização — a Caixa de Entrada de
  // Atendimentos é modelada em torno de conversas 1:1 com um paciente.
  if (!message.from.endsWith("@c.us")) return;

  try {
    const phone = formatPhoneFromWhatsAppId(message.from);
    const timestamp = formatTimestamp(message.timestamp);
    const text = message.body || "";

    const patient = await findOrCreatePatientByPhone(clinicId, phone, message);

    const newMessage = {
      id: `m_wa_${message.id.id || Date.now()}`,
      clinicId,
      patientId: patient.id,
      sender: "patient" as const,
      senderName: patient.name,
      text,
      timestamp,
    };

    await docClient.send(new PutCommand({ TableName: "ChatMessages", Item: newMessage }));

    await docClient.send(
      new PutCommand({
        TableName: "Patients",
        Item: {
          ...patient,
          lastMessage: text,
          lastMessageTime: timestamp,
          // Incrementa o contador de não lidas — a mesma convenção que o
          // resto do sistema usa para sinalizar mensagem nova na lista de
          // conversas.
          unreadCount: (patient.unreadCount || 0) + 1,
        },
      })
    );
  } catch (e) {
    console.error(`[WhatsApp Sync] Falha ao sincronizar mensagem recebida (clínica ${clinicId}):`, e);
  }
}

/**
 * Busca um paciente existente pelo telefone (dentro da clínica) via o GSI
 * clinicId-index, filtrando em memória pelo campo phone — o volume de
 * pacientes por clínica não justifica um índice dedicado só para telefone
 * (diferente do índice por paciente do chat, que é consultado a cada
 * troca de mensagem). Cria um paciente novo, no início do funil, se não
 * encontrar nenhum.
 */
async function findOrCreatePatientByPhone(
  clinicId: string,
  phone: string,
  message: WhatsAppMessage
): Promise<Record<string, any>> {
  const queryRes = await docClient.send(
    new QueryCommand({
      TableName: "Patients",
      IndexName: "clinicId-index",
      KeyConditionExpression: "clinicId = :clinicId",
      ExpressionAttributeValues: { ":clinicId": clinicId },
    })
  );
  const existing = (queryRes.Items || []).find((p) => p.phone === phone);
  if (existing) {
    return existing;
  }

  // Paciente novo — mesmo formato de server/routes/patients.ts (POST /),
  // com o nome vindo do perfil do WhatsApp (pushname) quando disponível.
  let displayName = phone;
  try {
    const contact = await message.getContact();
    displayName = contact?.pushname || contact?.name || phone;
  } catch {
    // Sem contato resolvido (ex.: número não salvo do outro lado) — usa
    // o telefone como nome, o mesmo fallback que um cadastro manual sem
    // nome preenchido teria.
  }

  const newPatient = {
    id: `p_wa_${Date.now()}`,
    clinicId,
    name: displayName,
    phone,
    insurance: "A confirmar",
    status: "pendente",
    stage: "triagem",
    urgency: "media",
    lastMessage: "",
    lastMessageTime: "",
    unreadCount: 0,
    assignedTo: "Não atribuído",
    channel: "WhatsApp",
    checklist: [],
    internalNotes: [],
  };

  await docClient.send(new PutCommand({ TableName: "Patients", Item: newPatient }));

  // Mesmo critério já usado na criação manual de paciente (POST
  // /api/patients): uma conversa nova conta como um atendimento novo
  // para efeito de uso/faturamento. "Melhor esforço", nunca bloqueia a
  // sincronização da mensagem em si.
  recordAppointmentUsage(clinicId);

  return newPatient;
}
