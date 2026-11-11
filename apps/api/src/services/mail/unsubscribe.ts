/**
 * Signed unsubscribe links.
 *
 * The link must work from an email client with no session and no login, so the
 * token itself carries the authority. It is an HMAC over the address and user
 * id: an attacker cannot unsubscribe someone else, and we never have to store a
 * one-time token table.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env.js';

function secret(env: Env): string {
  // Reuse the session secret: it is already a long random value held only in
  // Doppler, so no extra configuration is required.
  // Derived from the refresh secret so unsubscribe links cannot be forged
  // with a value that only signs access tokens.
  return `${env.JWT_REFRESH_SECRET}:unsubscribe`;
}

function sign(env: Env, email: string, userId: string): string {
  return createHmac('sha256', secret(env))
    .update(`${email.trim().toLowerCase()}|${userId}`)
    .digest('base64url');
}

/** Build a token for an address/user pair. */
export function unsubscribeToken(env: Env, email: string, userId: string): string {
  return sign(env, email, userId);
}

/** Constant-time verification. */
export function verifyUnsubscribeToken(
  env: Env,
  email: string,
  userId: string,
  token: string,
): boolean {
  if (!token || !userId) return false;
  const expected = sign(env, email, userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Public, session-free unsubscribe URL embedded in marketing mail. */
export function unsubscribeUrl(env: Env, email: string, userId: string): string {
  const token = unsubscribeToken(env, email, userId);
  const base = env.PUBLIC_WEB_URL.replace(/\/$/, '');
  const params = new URLSearchParams({ e: email.trim().toLowerCase(), u: userId, t: token });
  return `${base}/unsubscribe?${params.toString()}`;
}

/**
 * RFC 8058 one-click unsubscribe headers.
 *
 * Mail clients (Gmail, Apple Mail) show a native unsubscribe button when these
 * headers are present. Providing them materially reduces spam complaints, which
 * is what damages deliverability.
 */
export function buildUnsubscribeHeaders(
  env: Env,
  email: string,
  userId?: string,
): Record<string, string> {
  if (!userId) return {};
  const url = unsubscribeUrl(env, email, userId);
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
