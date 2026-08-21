// whatsapp-web.js é publicado como CommonJS puro (sem "type": "module" nem
// campo "exports" mapeado para ESM). Este projeto roda como ESM nativo
// ("type": "module" no package.json) — nesse cenário, o Node precisa
// analisar estaticamente o module.exports do pacote CJS para oferecer
// named imports (import { Client } from "..."), e essa análise é frágil:
// funciona em alguns ambientes/versões do Node e falha em outros com
// "SyntaxError: does not provide an export named 'X'", mesmo quando o
// export existe de fato (confirmado lendo node_modules/whatsapp-web.js/index.js).
// A forma robusta, que não depende dessa análise estática, é importar o
// módulo inteiro como default (o jeito garantido de consumir um pacote
// CJS a partir de ESM) e desestruturar os named exports a partir dele.
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
// import type é apagado inteiramente na compilação — nunca vira um
// require()/import em runtime, então não sofre do mesmo problema de
// interop CJS/ESM do import de valor acima. Necessário porque a
// desestruturação de `pkg.Client` (linha acima) só preserva o VALOR da
// classe; para usar `Client` como TIPO (ex.: `client: Client`,
// `Promise<Client | null>`), o TypeScript precisa da declaração vinda
// diretamente do .d.ts do pacote.
import type { Client as ClientType } from "whatsapp-web.js";
import QRCode from "qrcode";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../db/dynalite";
import { syncIncomingMessage } from "./messageSync";

// ---------------------------------------------------------------------------
// Conexão real com WhatsApp via whatsapp-web.js
//
// Diferente do resto do backend (rotas HTTP sem estado, cada requisição
// independente), uma conexão de WhatsApp é um processo de LONGA DURAÇÃO:
// abre um Chromium headless (via Puppeteer) que mantém uma sessão viva do
// WhatsApp Web, igual a ter o celular da clínica com o WhatsApp Web aberto
// num navegador o tempo todo. Por isso este módulo vive fora do ciclo
// request/response normal — os clients ficam em memória do processo Node,
// indexados por clinicId, e sobrevivem entre requisições HTTP.
//
// Decisões de arquitetura registradas aqui:
//
// 1. Um Client por clínica, em memória (Map<clinicId, ClientEntry>) — não
//    em banco de dados. O processo Node que hospeda o servidor Express
//    também hospeda as sessões de WhatsApp; se o processo reiniciar, as
//    sessões precisam reconectar (a autenticação em si sobrevive, salva em
//    disco por LocalAuth — só a instância do Client em memória se perde).
//    Isso é adequado para o volume de clínicas dos 3 planos comerciais do
//    projeto; um volume muito maior (centenas de clínicas simultâneas)
//    justificaria um processo dedicado por sessão ou um serviço externo de
//    WhatsApp Business API — fora do escopo desta implementação.
//
// 2. Autenticação via LocalAuth, uma pasta por clínica
//    (.wwebjs_auth/clinic-<clinicId>/) — o par de chaves da sessão do
//    WhatsApp Web fica em disco, nunca no banco de dados nem em memória
//    fora do processo do Chromium. Comprometer essa pasta equivale a
//    comprometer o WhatsApp real da clínica; ela nunca deve ir para
//    controle de versão (.gitignore já cobre isso) nem para backup sem
//    criptografia.
//
// 3. O estado exposto pela API (status, QR code, número conectado) fica em
//    DynamoDB (tabela WhatsAppSessions) — é seguro persistir porque não
//    contém segredo nenhum, só metadados de exibição.
// ---------------------------------------------------------------------------

export type WhatsAppConnectionStatus =
  | "disconnected" // nunca conectado, ou desconectado manualmente
  | "initializing" // Chromium subindo, QR ainda não gerado
  | "qr_pending" // QR code gerado, aguardando o usuário escanear
  | "connected" // sessão ativa e pronta para enviar/receber mensagens
  | "auth_failed"; // a sessão salva expirou ou foi invalidada pelo WhatsApp

interface ClientEntry {
  client: ClientType;
  status: WhatsAppConnectionStatus;
  qrDataUrl?: string; // QR code como data URL (image/png base64), pronto para <img src>
  connectedNumber?: string; // número de telefone conectado, formatado
  lastError?: string;
}

// Map em memória do processo — a fonte de verdade sobre "o Client existe e
// está em algum estágio de conexão agora". Nunca serializado nem
// persistido; se o processo reiniciar, começa vazio e cada clínica que
// quiser continuar conectada precisa chamar startSession() de novo (a
// sessão salva em disco evita ter que escanear o QR de novo, mas o Client
// em si precisa ser recriado).
const sessions = new Map<string, ClientEntry>();

function authFolderFor(clinicId: string): string {
  // Sanitiza o clinicId para um nome de pasta seguro — nunca interpolar o
  // valor bruto vindo do banco direto num caminho de arquivo, mesmo sendo
  // um valor gerado internamente (defesa em profundidade).
  const safe = clinicId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `clinic-${safe}`;
}

async function persistStatus(clinicId: string, patch: Partial<{ status: WhatsAppConnectionStatus; connectedNumber: string; lastError: string }>): Promise<void> {
  try {
    const current = await docClient.send(new GetCommand({ TableName: "WhatsAppSessions", Key: { clinicId } }));
    await docClient.send(
      new PutCommand({
        TableName: "WhatsAppSessions",
        Item: {
          clinicId,
          status: patch.status ?? current.Item?.status ?? "disconnected",
          connectedNumber: patch.connectedNumber ?? current.Item?.connectedNumber ?? null,
          lastError: patch.lastError ?? null,
          updatedAt: new Date().toISOString(),
        },
      })
    );
  } catch (e) {
    // "Melhor esforço" — mesmo padrão já usado em server/billing/usageService.ts:
    // uma falha ao persistir o status de exibição nunca deve derrubar a
    // sessão de WhatsApp em si, que continua funcionando via o Map em
    // memória mesmo que o DynamoDB esteja temporariamente indisponível.
    console.warn(`[WhatsApp] Falha ao persistir status da clínica ${clinicId} (não bloqueante):`, e);
  }
}

/**
 * Inicia (ou reinicia) a sessão de WhatsApp de uma clínica. Idempotente na
 * prática: se já existe uma sessão em qualquer estado que não seja
 * "disconnected"/"auth_failed", devolve a entrada existente em vez de
 * criar um segundo Client para a mesma clínica (dois clients Puppeteer
 * simultâneos disputando a mesma pasta de autenticação corromperiam a
 * sessão).
 */
export async function startSession(clinicId: string): Promise<ClientEntry> {
  const existing = sessions.get(clinicId);
  if (existing && (existing.status === "initializing" || existing.status === "qr_pending" || existing.status === "connected")) {
    return existing;
  }

  const entry: ClientEntry = { client: null as unknown as ClientType, status: "initializing" };
  sessions.set(clinicId, entry);
  await persistStatus(clinicId, { status: "initializing" });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: authFolderFor(clinicId), dataPath: ".wwebjs_auth" }),
    puppeteer: {
      headless: true,
      // Flags recomendadas pelo próprio whatsapp-web.js para rodar em
      // ambientes de servidor/contêiner sem sandbox de display gráfico —
      // sem elas, o Chromium tipicamente falha ao iniciar em containers.
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      // Opcional — usa o Chromium baixado automaticamente pelo Puppeteer
      // por padrão; só necessário definir PUPPETEER_EXECUTABLE_PATH se
      // esse download falhar (ex.: rede bloqueada) e um Chrome/Chromium
      // já instalado no sistema precisar ser apontado manualmente (ver
      // .env.example).
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  });
  entry.client = client;

  client.on("qr", async (qr) => {
    try {
      entry.qrDataUrl = await QRCode.toDataURL(qr);
      entry.status = "qr_pending";
      await persistStatus(clinicId, { status: "qr_pending" });
    } catch (e) {
      console.error(`[WhatsApp] Falha ao gerar QR code para a clínica ${clinicId}:`, e);
    }
  });

  client.on("ready", async () => {
    entry.status = "connected";
    entry.qrDataUrl = undefined;
    // client.info.wid.user é o número de telefone conectado, sem o sufixo
    // "@c.us" do formato interno do WhatsApp Web.
    entry.connectedNumber = client.info?.wid?.user;
    await persistStatus(clinicId, { status: "connected", connectedNumber: entry.connectedNumber });
  });

  // Sincronização com a Caixa de Entrada de Atendimentos: toda mensagem
  // recebida neste número vira uma mensagem de chat de um paciente (novo
  // ou existente) — ver server/whatsapp/messageSync.ts para a lógica
  // completa. O listener em si só delega; nunca deixa uma falha de
  // sincronização derrubar a sessão do WhatsApp.
  client.on("message", async (message) => {
    await syncIncomingMessage(clinicId, message);
  });

  client.on("auth_failure", async (msg) => {
    entry.status = "auth_failed";
    entry.lastError = msg;
    await persistStatus(clinicId, { status: "auth_failed", lastError: msg });
  });

  client.on("disconnected", async (reason) => {
    entry.status = "disconnected";
    entry.qrDataUrl = undefined;
    entry.connectedNumber = undefined;
    await persistStatus(clinicId, { status: "disconnected", lastError: reason });
    // Remove do Map — uma nova chamada a startSession() cria um Client
    // limpo, em vez de tentar reaproveitar um client já desconectado.
    sessions.delete(clinicId);
  });

  // client.initialize() é assíncrono e de longa duração (sobe o
  // Chromium) — não aguardamos aqui de propósito. A rota HTTP que chama
  // startSession() devolve a resposta imediatamente (status
  // "initializing"), e o front-end consulta o status/QR code via
  // polling em getSessionStatus() logo abaixo.
  client.initialize().catch(async (e) => {
    entry.status = "auth_failed";
    entry.lastError = e?.message || String(e);
    await persistStatus(clinicId, { status: "auth_failed", lastError: entry.lastError });
  });

  return entry;
}

/** Estado atual da sessão de uma clínica — para o front-end fazer polling durante a conexão (aguardando QR, aguardando escaneamento) sem reiniciar nada. */
export function getSessionStatus(clinicId: string): { status: WhatsAppConnectionStatus; qrDataUrl?: string; connectedNumber?: string; lastError?: string } {
  const entry = sessions.get(clinicId);
  if (!entry) {
    return { status: "disconnected" };
  }
  return {
    status: entry.status,
    qrDataUrl: entry.qrDataUrl,
    connectedNumber: entry.connectedNumber,
    lastError: entry.lastError,
  };
}

/**
 * Encerra a sessão de uma clínica — desloga do WhatsApp Web (invalida a
 * sessão salva, exigindo novo QR code numa próxima conexão) e fecha o
 * Chromium. Diferente de simplesmente remover do Map: sem chamar
 * client.logout(), a sessão salva em disco continuaria válida e um
 * reinício acidental do processo reconectaria sozinho, sem o usuário ter
 * pedido isso — o comportamento esperado de "desconectar" é encerrar de
 * verdade, não só parar de usar temporariamente.
 */
export async function stopSession(clinicId: string): Promise<void> {
  const entry = sessions.get(clinicId);
  if (!entry) {
    await persistStatus(clinicId, { status: "disconnected" });
    return;
  }
  try {
    await entry.client.logout();
  } catch (e) {
    console.warn(`[WhatsApp] Erro ao deslogar a clínica ${clinicId} (prosseguindo com a limpeza local):`, e);
  }
  try {
    await entry.client.destroy();
  } catch (e) {
    console.warn(`[WhatsApp] Erro ao destruir o client da clínica ${clinicId}:`, e);
  }
  sessions.delete(clinicId);
  await persistStatus(clinicId, { status: "disconnected" });
}

/** Devolve o Client ativo de uma clínica, ou null se não houver sessão conectada — usado pelo envio de mensagens (fora do escopo desta implementação inicial, mas é o ponto de extensão natural). */
export function getActiveClient(clinicId: string): ClientType | null {
  const entry = sessions.get(clinicId);
  return entry && entry.status === "connected" ? entry.client : null;
}
