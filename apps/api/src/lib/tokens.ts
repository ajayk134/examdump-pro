import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Stable hash used to store opaque tokens without keeping the plaintext. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function randomReferralCode(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}