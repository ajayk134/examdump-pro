/**
 * Writes to `upi_config`.
 *
 * Reads live in `config.service.ts`; this module owns the mutations, so every
 * write goes through one place that validates, encrypts, invalidates the read
 * cache and leaves an audit trail. Routes stay thin.
 *
 * What is deliberately *not* here: turning on auto-approval as a side effect of
 * anything else. Every switch is set by an explicit, named argument.
 */
import { eq } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { upiConfig } from '../../db/schema/index.js';
import { parseKey, seal, SecretboxError } from '../../lib/secretbox.js';
import { isValidVpa } from './uri.js';
import { invalidateUpiConfig, resolveUpiConfig, isGmailObserverConfigured } from './config.service.js';

/** Validation failures are surfaced to the operator verbatim, so keep them plain. */
export class ConfigValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConfigValidationError';
    this.code = code;
  }
}

export interface PayeePatch {
  payeeVpa?: string | null;
  payeeName?: string;
}

export interface SwitchPatch {
  paymentsEnabled?: boolean;
  gmailEnabled?: boolean;
  autoApprove?: boolean;
}

function keyFor(env: Env): Buffer {
  if (!env.UPI_SECRETS_KEY) {
    throw new ConfigValidationError(
      'secrets_key_missing',
      'UPI_SECRETS_KEY is not configured on the server, so credentials cannot be stored securely. Set it in Doppler before connecting Gmail.',
    );
  }
  try {
    return parseKey(env.UPI_SECRETS_KEY);
  } catch (err) {
    throw new ConfigValidationError(
      'secrets_key_invalid',
      err instanceof SecretboxError ? err.message : 'UPI_SECRETS_KEY is not usable',
    );
  }
}

/** Ensure the singleton row exists, then return it. */
async function ensureRow() {
  const db = getDb();
  const [existing] = await db.select().from(upiConfig).where(eq(upiConfig.key, 'global')).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(upiConfig)
    .values({ key: 'global' })
    .onConflictDoNothing({ target: upiConfig.key })
    .returning();
  if (created) return created;
  const [row] = await db.select().from(upiConfig).where(eq(upiConfig.key, 'global')).limit(1);
  return row!;
}

export async function updatePayee(
  env: Env,
  patch: PayeePatch,
  actorId: string | null,
): Promise<void> {
  const values: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actorId };

  if (patch.payeeVpa !== undefined) {
    if (patch.payeeVpa === null || patch.payeeVpa === '') {
      values.payeeVpa = null;
    } else {
      const trimmed = patch.payeeVpa.trim();
      /* Reject at write time with a precise message. A VPA that fails here would
       * also be ignored by the resolver, so accepting it would mean the dashboard
       * shows a value the checkout silently refuses to use. */
      if (!isValidVpa(trimmed)) {
        throw new ConfigValidationError(
          'invalid_vpa',
          `"${trimmed}" is not a valid UPI ID. It should look like name@bank, for example examdump@okhdfcbank.`,
        );
      }
      values.payeeVpa = trimmed;
    }
  }

  if (patch.payeeName !== undefined) {
    const name = patch.payeeName.trim().slice(0, 64);
    values.payeeName = name || null;
  }

  await ensureRow();
  const db = getDb();
  await db.update(upiConfig).set(values).where(eq(upiConfig.key, 'global'));
  invalidateUpiConfig();
}

/**
 * Flip the three switches.
 *
 * The only rule enforced here is the one that protects money: auto-approval
 * cannot be switched on while the Gmail observer is not actually connected,
 * because in that state it would do nothing except mislead the operator into
 * believing payments settle themselves.
 */
export async function updateSwitches(
  env: Env,
  patch: SwitchPatch,
  actorId: string | null,
): Promise<void> {
  const values: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actorId };

  if (patch.paymentsEnabled !== undefined) {
    /* Enabling collection without a usable payee would render a QR that pays
     * nobody. Check the resolved value so a dashboard VPA *or* an environment
     * VPA both satisfy the requirement. */
    if (patch.paymentsEnabled) {
      const config = await resolveUpiConfig(env, true);
      if (!config.payeeVpa) {
        throw new ConfigValidationError(
          'payee_required',
          'Set a merchant UPI ID before enabling payment collection.',
        );
      }
    }
    values.paymentsEnabled = patch.paymentsEnabled;
  }

  if (patch.gmailEnabled !== undefined) {
    if (patch.gmailEnabled) {
      const config = await resolveUpiConfig(env, true);
      if (!isGmailObserverConfigured({ ...config, gmailEnabled: true })) {
        throw new ConfigValidationError(
          'gmail_not_connected',
          'Connect the Gmail account before enabling the observer.',
        );
      }
    }
    values.gmailEnabled = patch.gmailEnabled;
  }

  if (patch.autoApprove !== undefined) {
    if (patch.autoApprove) {
      const config = await resolveUpiConfig(env, true);
      if (!isGmailObserverConfigured(config)) {
        throw new ConfigValidationError(
          'gmail_not_connected',
          'Automatic approval needs a connected, enabled Gmail observer.',
        );
      }
    }
    values.autoApprove = patch.autoApprove;
  }

  await ensureRow();
  const db = getDb();
  await db.update(upiConfig).set(values).where(eq(upiConfig.key, 'global'));
  invalidateUpiConfig();
}

export interface GmailCredentials {
  user: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  scopes?: string;
  connectedEmail?: string;
}

/**
 * Store a completed OAuth connection.
 *
 * Called only from the callback after the code has been exchanged, so the
 * refresh token here is already proven to work. Both secrets are encrypted
 * independently: a single combined blob would mean re-entering the client secret
 * to rotate a token.
 */
export async function storeGmailConnection(
  env: Env,
  creds: GmailCredentials,
  actorId: string | null,
): Promise<void> {
  const key = keyFor(env);

  if (!creds.user.includes('@')) {
    throw new ConfigValidationError('invalid_gmail_user', 'The Gmail address is not valid.');
  }

  const values: Record<string, unknown> = {
    gmailUser: creds.user.trim(),
    gmailClientId: creds.clientId.trim(),
    gmailClientSecretEnc: seal(creds.clientSecret, key),
    gmailRefreshTokenEnc: seal(creds.refreshToken, key),
    gmailScopes: creds.scopes ?? 'https://www.googleapis.com/auth/gmail.readonly',
    gmailConnectedAt: new Date(),
    gmailConnectedEmail: creds.connectedEmail ?? creds.user,
    gmailLastVerifiedAt: null,
    updatedAt: new Date(),
    updatedBy: actorId,
  };

  await ensureRow();
  const db = getDb();
  await db.update(upiConfig).set(values).where(eq(upiConfig.key, 'global'));
  invalidateUpiConfig();
}

/**
 * Record that the stored credentials just worked.
 *
 * Separate from `storeGmailConnection` so a successful test after a deploy
 * updates the "last verified" timestamp without pretending to be a new
 * connection.
 */
export async function markGmailVerified(): Promise<void> {
  const db = getDb();
  await db
    .update(upiConfig)
    .set({ gmailLastVerifiedAt: new Date() })
    .where(eq(upiConfig.key, 'global'));
  invalidateUpiConfig();
}

/**
 * Forget the connection.
 *
 * Clears the encrypted columns and the switch it depends on. Auto-approval is
 * also cleared, because leaving it set with no observer would be a lie about how
 * payments are being confirmed.
 */
export async function clearGmailConnection(actorId: string | null): Promise<void> {
  await ensureRow();
  const db = getDb();
  await db
    .update(upiConfig)
    .set({
      gmailEnabled: null,
      autoApprove: null,
      gmailUser: null,
      gmailClientId: null,
      gmailClientSecretEnc: null,
      gmailRefreshTokenEnc: null,
      gmailConnectedAt: null,
      gmailConnectedEmail: null,
      gmailScopes: null,
      gmailLastVerifiedAt: null,
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(eq(upiConfig.key, 'global'));
  invalidateUpiConfig();
}