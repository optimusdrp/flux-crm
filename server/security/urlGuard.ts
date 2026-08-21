import dns from "node:dns/promises";
import net from "node:net";

// ---------------------------------------------------------------------------
// Fase 3 — SSRF em webhooks
//
// Antes desta fase, POST/PUT /api/webhooks aceitava qualquer `url` do
// cliente sem validação, e o dispatcher (dispatchWebhookForEvent /
// /api/webhooks/:id/test) fazia `fetch(webhook.url)` diretamente. Isso
// permitia usar o servidor como proxy para acessar rede interna, localhost,
// ou o endpoint de metadados de nuvem (169.254.169.254) — de onde dá para
// roubar credenciais IAM da instância em provedores como AWS/GCP/Azure.
//
// Este módulo concentra a validação em dois momentos:
//  1. Ao SALVAR o webhook (isUrlSafeToRegister) — feedback imediato pro
//     usuário, evita cadastrar uma URL já obviamente perigosa.
//  2. Ao DISPARAR o webhook (isUrlSafeToDispatch) — repete a checagem
//     resolvendo o DNS na hora, porque um domínio público pode ser
//     reapontado depois do cadastro para um IP interno (DNS rebinding);
//     confiar só na checagem do cadastro não é suficiente.
// ---------------------------------------------------------------------------

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Verifica se um endereço IPv4/IPv6 cai em faixa privada, loopback,
 * link-local ou de metadados de nuvem. Cobre os blocos mais relevantes;
 * não é uma lista exaustiva de toda RFC 1918/4193, mas cobre os alvos
 * práticos de SSRF.
 */
function isPrivateOrDangerousIp(ip: string): boolean {
  const type = net.isIP(ip);

  if (type === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;

    // Loopback: 127.0.0.0/8
    if (a === 127) return true;
    // "Esta rede": 0.0.0.0/8
    if (a === 0) return true;
    // Privadas RFC 1918
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // Link-local (inclui 169.254.169.254 — metadados AWS/GCP/Azure/DigitalOcean)
    if (a === 169 && b === 254) return true;
    // Carrier-grade NAT: 100.64.0.0/10
    if (a === 100 && b >= 64 && b <= 127) return true;
    // Multicast / reservado
    if (a >= 224) return true;

    return false;
  }

  if (type === 6) {
    const lower = ip.toLowerCase();
    // Loopback ::1, unspecified ::
    if (lower === "::1" || lower === "::") return true;
    // Link-local fe80::/10
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    // Unique local fc00::/7
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    // IPv4-mapped (::ffff:x.x.x.x) — reavalia a parte IPv4
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.replace("::ffff:", "");
      if (net.isIP(mapped) === 4) return isPrivateOrDangerousIp(mapped);
    }
    return false;
  }

  // Não é um IP reconhecível — trata como não seguro por padrão (fail closed).
  return true;
}

interface UrlCheckResult {
  safe: boolean;
  reason?: string;
}

/**
 * Checagem estrutural rápida, sem I/O: protocolo permitido e hostname não é
 * óbvia e diretamente um IP perigoso ou "localhost". Usada ao salvar o
 * webhook, para dar feedback imediato. NÃO substitui a checagem com
 * resolução de DNS feita em isUrlSafeToDispatch — um hostname público pode
 * resolver para IP interno.
 */
export function isUrlStructurallySafe(rawUrl: string): UrlCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "URL inválida." };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { safe: false, reason: "Apenas URLs http:// ou https:// são permitidas." };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    return { safe: false, reason: "URLs apontando para localhost ou serviços de metadados não são permitidas." };
  }

  if (net.isIP(hostname) && isPrivateOrDangerousIp(hostname)) {
    return { safe: false, reason: "URLs apontando para endereços IP privados/internos não são permitidas." };
  }

  return { safe: true };
}

/**
 * Checagem completa feita imediatamente antes de disparar a requisição:
 * resolve o DNS do hostname e valida CADA IP retornado. Esta é a defesa
 * real contra SSRF — a checagem estrutural sozinha não pega o caso de um
 * domínio público que foi (re)apontado para um IP interno.
 */
export async function isUrlSafeToDispatch(rawUrl: string): Promise<UrlCheckResult> {
  const structural = isUrlStructurallySafe(rawUrl);
  if (!structural.safe) return structural;

  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname;

  // Hostname já era um IP literal — isUrlStructurallySafe já cobriu.
  if (net.isIP(hostname)) {
    return { safe: true };
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateOrDangerousIp(address)) {
        return {
          safe: false,
          reason: `O domínio resolve para um endereço interno/privado (${address}), não permitido.`,
        };
      }
    }
    return { safe: true };
  } catch (dnsErr) {
    // Falha ao resolver DNS: fail closed — não permite o disparo.
    return { safe: false, reason: "Não foi possível resolver o domínio informado." };
  }
}
