/**
 * Authenticated symmetric encryption for values that must survive in the
 * database but must never be readable from it.
 *
 * Only one kind of secret is stored this way today: the Gmail refresh token and
 * OAuth client secret, because the admin dashboard may now write them and there
 * is no second system to hold them. Doppler remains the source of the key.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version prefix
 * exists so a future key rotation can introduce `v2` and re-encrypt lazily
 * rather than requiring a coordinated rewrite.
 *
 * AES-256-GCM is chosen over CBC because it authenticates: a modified ciphertext
 * fails to open instead of decrypting to garbage that we might then send to
 * Google. The IV is random per call, so encrypting the same token twice produces
 * different ciphertext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Raised when a stored value cannot be opened. Never includes the value. */
export class SecretboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretboxError';
  }
}

/**
 * Turn the configured key into raw bytes.
 *
 * The key is supplied as base64 in `UPI_SECRETS_KEY`. A plain-text key shorter
 * than 32 bytes is rejected rather than silently stretched: a short key would
 * look configured while providing far less strength than AES-256 implies.
 */
export function parseKey(keyBase64: string): Buffer {
  const trimmed = (keyBase64 ?? '').trim();
  if (!trimmed) throw new SecretboxError('encryption key is not configured');

  let raw: Buffer;
  try {
    raw = Buffer.from(trimmed, 'base64');
  } catch {
    throw new SecretboxError('encryption key is not valid base64');
  }
  if (raw.length !== KEY_BYTES) {
    throw new SecretboxError(`encryption key must be ${KEY_BYTES} bytes (base64 of 32 random bytes)`);
  }
  return raw;
}

/** Generate a key for `doppler secrets set`. Printed once, never stored here. */
export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`);
}

/**
 * Encrypt a UTF-8 string. Returns the versioned envelope.
 *
 * The key must already be parsed; callers resolve it once per request or boot
 * rather than decoding base64 on every poll.
 */
export function seal(plaintext: string, key: Buffer): string {
  if (typeof plaintext !== 'string') throw new SecretboxError('plaintext must be a string');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt an envelope produced by `seal`.
 *
 * Throws `SecretboxError` on a malformed envelope, a wrong key, or a tampered
 * ciphertext. The error text never contains any part of the secret, so it is
 * safe to log.
 */
export function open(envelope: string, key: Buffer): string {
  if (!isEncrypted(envelope)) throw new SecretboxError('value is not an encrypted envelope');

  const parts = envelope.split('.');
  if (parts.length !== 4) throw new SecretboxError('malformed envelope');

  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== IV_BYTES) throw new SecretboxError('malformed iv');
  if (tag.length !== TAG_BYTES) throw new SecretboxError('malformed tag');

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Deliberately opaque: a wrong key and a tampered tag are the same event to
    // the caller, and distinguishing them would help an attacker.
    throw new SecretboxError('could not decrypt value (wrong key or tampered data)');
  }
}

/**
 * Last four characters, for an operator to recognise which credential is
 * installed without revealing it. Only used for non-secret identifiers such as
 * an email address; tokens are never fingerprinted.
 */
export function maskTail(value: string | null | undefined, keep = 4): string | null {
  if (!value) return null;
  if (value.length <= keep) return '•'.repeat(value.length);
  return '•'.repeat(Math.max(3, value.length - keep)) + value.slice(-keep);
}
