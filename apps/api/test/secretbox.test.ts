/**
 * Credential encryption.
 *
 * These are property tests rather than snapshot tests: the interesting failures
 * are a tampered ciphertext opening successfully, two encryptions of the same
 * value being identical, and a wrong key decrypting instead of failing.
 */
import { describe, expect, it } from 'vitest';
import { generateKey, isEncrypted, maskTail, open, parseKey, seal, SecretboxError } from '../src/lib/secretbox.js';

const KEY = parseKey(generateKey());

describe('secretbox', () => {
  it('round-trips a value', () => {
    const secret = 'refresh-token-value';
    expect(open(seal(secret, KEY), KEY)).toBe(secret);
  });

  it('produces a different ciphertext each time', () => {
    const secret = 'same-value';
    /* A deterministic ciphertext would leak equality between two mailboxes'
     * tokens, and would let an attacker confirm a guessed value offline. */
    expect(seal(secret, KEY)).not.toBe(seal(secret, KEY));
  });

  it('rejects a tampered ciphertext instead of returning garbage', () => {
    const envelope = seal('money-must-not-be-guessable', KEY);
    const parts = envelope.split('.');
    /* Flip a character in the payload. GCM is authenticated, so this must fail. */
    const data = parts[3]!;
    parts[3] = (data[0] === 'A' ? 'B' : 'A') + data.slice(1);
    expect(() => open(parts.join('.'), KEY)).toThrow(SecretboxError);
  });

  it('rejects the wrong key', () => {
    const otherKey = parseKey(generateKey());
    expect(() => open(seal('secret', KEY), otherKey)).toThrow(SecretboxError);
  });

  it('rejects a malformed envelope', () => {
    expect(() => open('v1.only-three-parts', KEY)).toThrow(SecretboxError);
    expect(() => open('not-even-versioned', KEY)).toThrow(SecretboxError);
  });

  it('does not include the plaintext in the envelope', () => {
    const secret = 'clearly-visible-plaintext';
    expect(seal(secret, KEY)).not.toContain(secret);
  });

  it('rejects a key of the wrong length', () => {
    /* A short key would look configured while providing less strength than the
     * algorithm implies, so it is refused rather than stretched. */
    expect(() => parseKey(Buffer.from('too-short').toString('base64'))).toThrow(SecretboxError);
    expect(() => parseKey('')).toThrow(SecretboxError);
  });

  it('accepts a 32-byte key', () => {
    expect(parseKey(generateKey()).length).toBe(32);
  });

  it('recognises its own envelopes', () => {
    expect(isEncrypted(seal('x', KEY))).toBe(true);
    expect(isEncrypted('plain')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('masks all but the tail for display', () => {
    /* `keep` characters survive, the rest become bullets. */
    const masked = maskTail('payments@example.com', 4);
    expect(masked).toMatch(/com$/);
    expect(masked).toContain('•');
    expect(masked).not.toContain('payments@');
    expect(maskTail(null)).toBeNull();
  });
});