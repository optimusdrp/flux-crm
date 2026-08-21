import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Fase 1 — Fundação de identidade
//
// Este módulo concentra tudo que envolve senha e token, para que nenhuma rota
// em server.ts precise lidar com bcrypt/jwt "na mão". Ele é a peça que faltava
// no projeto original: antes, USER_DIRECTORY guardava senha em texto puro e o
// "token" era só um Math.random() sem assinatura nem expiração.
// ---------------------------------------------------------------------------

// JWT_SECRET DEVE vir de variável de ambiente em qualquer ambiente real.
// O fallback abaixo existe só para não quebrar o `npm run dev` de primeira
// instalação; em produção, iniciar o server sem JWT_SECRET definido deve
// falhar alto (ver checagem em server.ts).
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-troque-isto";
const JWT_EXPIRES_IN = "8h"; // sessão de trabalho de um turno; renovar via novo login

// Custo do bcrypt. 10 é um bom equilíbrio para dev; considerar 12 em produção
// se o hardware do servidor aguentar o custo de CPU por login.
const BCRYPT_SALT_ROUNDS = 10;

export interface AuthTokenPayload {
  email: string;
  role: string;
  // Fase 1 de Prontidão Comercial: identifica a clínica à qual o usuário
  // pertence. Sem isso, o sistema não tem como filtrar dados por cliente
  // — é a peça central da mudança de "sistema para uma clínica" para
  // "SaaS para várias clínicas".
  clinicId: string;
}

/**
 * Gera o hash de uma senha em texto puro. Usado apenas no seed/criação de
 * usuário — a senha em texto puro nunca deve ser persistida.
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
}

/**
 * Compara a senha informada no login com o hash armazenado.
 * Retorna false tanto para senha errada quanto para hash ausente/corrompido
 * — nunca lança exceção para não vazar detalhe de erro ao cliente.
 */
export async function verifyPassword(
  plainPassword: string,
  passwordHash: string | undefined | null
): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await bcrypt.compare(plainPassword, passwordHash);
  } catch {
    return false;
  }
}

/**
 * Emite um JWT assinado e com expiração. Substitui o antigo
 * `jwt_mediflux_sec_${Date.now()}_${Math.random()...}`, que não era um JWT
 * de fato (não assinado, não verificável, nunca expirava).
 */
export function issueToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifica e decodifica um JWT. Retorna null se inválido, expirado ou
 * malformado — quem chama decide o que fazer (normalmente responder 401).
 */
export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === "string") return null;
    if (!decoded.email || !decoded.role || !decoded.clinicId) return null;
    return { email: decoded.email as string, role: decoded.role as string, clinicId: decoded.clinicId as string };
  } catch {
    return null;
  }
}

export function isUsingInsecureDevSecret(): boolean {
  return !process.env.JWT_SECRET;
}
