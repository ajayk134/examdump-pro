/**
 * Effective UPI configuration.
 *
 * Before the dashboard could edit UPI settings, every value came from `env` and
 * `getEnv()` was cached at boot. Now the same settings also live in the
 * `upi_config` row, so something has to decide which wins. That is this module,
 * and the rules are deliberately boring:
 *
 *   1. A non-NULL database value wins over the environment.
 *   2. A NULL database value means "not configured here" and falls back to env,
 *      so an environment-only deployment behaves exactly as it did before this
 *      table existed. This is what makes rollback a matter of clearing a row.
 *   3. A database value that fails validation is ignored with a logged warning,
 *      and the environment value is used instead. A malformed row must never be
 *      able to take checkout down or, worse, accept payments at a wrong amount.
 *
 * Secrets are decrypted on read and never cached in decrypted form beyond the
 * short config TTL, which exists to avoid a query per poll cycle.
 */
import { eq } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { upiConfig } from '../../db/schema/index.js';
import { isValidVpa } from './uri.js';
import { open, parseKey, SecretboxError } from '../../lib/secretbox.js';

/** Where a resolved value came from. Surfaced in the admin API for diagnosis. */
export type ConfigSource = 'db' | 'env' | 'unset';

export interface EffectiveUpiConfig {
  payeeVpa: string | null;
  payeeName: string;
  paymentsEnabled: boolean;
  gmailEnabled: boolean;
  autoApprove: boolean;

  gmailUser: string | null;
  gmailClientId: string | null;
  /** Only present when it could be decrypted; never written to a log. */
  gmailClientSecret: string | null;
  gmailRefreshToken: string | null;

  gmailConnectedAt: Date | null;
  gmailConnectedEmail: string | null;
  gmailScopes: string | null;
  gmailLastVerifiedAt: Date | null;

  /** True when encryption is available, i.e. `UPI_SECRETS_KEY` parsed. */
  secretsUsable: boolean;
  /** Per-setting provenance, for the dashboard and for support. */
  source: {
    payeeVpa: ConfigSource;
    paymentsEnabled: ConfigSource;
    gmail: ConfigSource;
    autoApprove: ConfigSource;
  };
}

interface CacheEntry {
  value: EffectiveUpiConfig;
  expiresAt: number;
  /**
   * Identity of the environment the entry was built from.
   *
   * The cache is module-level, so it outlives any single `Env`. Tests construct a
   * fresh `Env` per case and two of them differ only in `UPI_AUTO_APPROVE`; a
   * cache keyed on nothing reused the previous answer and a disabled
   * auto-approve test observed auto-approval as on. Comparing the environment
   * we resolved under makes a changed environment miss the cache, which is also
   * correct in production if the process is ever restarted with new values.
   */
  envKey: string;
}

let cache: CacheEntry | null = null;

/** Cheap fingerprint of the environment fields this resolver actually reads. */
function envFingerprint(env: Env): string {
  return [
    env.PAYMENTS_ENABLED,
    env.UPI_AUTO_APPROVE,
    env.UPI_PAYEE_VPA ?? '',
    env.UPI_PAYEE_NAME,
    env.UPI_GMAIL_USER ?? '',
    env.UPI_GOOGLE_CLIENT_ID ?? '',
    env.UPI_GOOGLE_CLIENT_SECRET ?? '',
    env.UPI_GOOGLE_REFRESH_TOKEN ?? '',
    env.UPI_SECRETS_KEY ?? '',
    env.UPI_GMAIL_POLL_SECONDS,
  ].join('\u0000');
}

/**
 * Short TTL: long enough that a 60s poll loop does not hit the database every
 * cycle, short enough that a dashboard change takes effect without a restart.
 */
const TTL_MS = 10_000;

/** Drop the cache. Called after every dashboard write and in tests. */
export function invalidateUpiConfig(): void {
  cache = null;
}

function warn(message: string, detail: Record<string, unknown>): void {
  // Structured so it is greppable in logs and never contains secret material.
  console.warn(JSON.stringify({ level: 40, msg: message, ...detail }));
}

/** Decrypt one envelope, returning null (and warning) rather than throwing. */
function openOrNull(
  envelope: string | null,
  key: Buffer | null,
  field: string,
): string | null {
  if (!envelope) return null;
  if (!key) {
    warn('upi.config_deferred', { field, reason: 'encryption_key_missing' });
    return null;
  }
  try {
    return open(envelope, key);
  } catch (err) {
    warn('upi.config_deferred', {
      field,
      reason: err instanceof SecretboxError ? 'undecryptable' : 'unknown',
    });
    return null;
  }
}

/**
 * Resolve the configuration in effect right now.
 *
 * Never throws on a malformed row: a broken configuration degrades to the
 * environment so the site keeps working, and the problem is visible in logs and
 * in the admin status endpoint.
 */
export async function resolveUpiConfig(env: Env, force = false): Promise<EffectiveUpiConfig> {
  const envKey = envFingerprint(env);
  if (!force && cache && cache.expiresAt > Date.now() && cache.envKey === envKey) {
    return cache.value;
  }

  let key: Buffer | null = null;
  try {
    key = env.UPI_SECRETS_KEY ? parseKey(env.UPI_SECRETS_KEY) : null;
  } catch {
    warn('upi.config_deferred', { field: 'UPI_SECRETS_KEY', reason: 'invalid_key' });
    key = null;
  }

  const db = getDb();
  const [row] = await db.select().from(upiConfig).where(eq(upiConfig.key, 'global')).limit(1);

  // --- payee VPA ---------------------------------------------------------
  let payeeVpa: string | null = null;
  let payeeSource: ConfigSource = 'unset';
  if (row?.payeeVpa) {
    if (isValidVpa(row.payeeVpa)) {
      payeeVpa = row.payeeVpa;
      payeeSource = 'db';
    } else {
      /* A stored VPA that no longer validates must not silently win. Fall back
       * to the environment, which an operator has at least deliberately set. */
      warn('upi.config_ignored', { field: 'payeeVpa', reason: 'invalid_vpa' });
    }
  }
  if (!payeeVpa && env.UPI_PAYEE_VPA && isValidVpa(env.UPI_PAYEE_VPA)) {
    payeeVpa = env.UPI_PAYEE_VPA;
    payeeSource = 'env';
  }

  // --- payment acceptance -------------------------------------------------
  /*
   * NULL in the database means "no dashboard opinion", so the environment
   * decides. A stored true/false is an operator decision and outranks it. This
   * is what keeps a deployment that was configured purely with environment
   * variables behaving exactly as it did before this table existed.
   */
  const paymentsFromDb = row?.paymentsEnabled ?? null;
  const paymentsEnv = env.PAYMENTS_ENABLED;
  const paymentsEnabled = paymentsFromDb ?? paymentsEnv;
  const paymentsSource: ConfigSource =
    paymentsFromDb !== null ? 'db' : paymentsEnv ? 'env' : 'unset';

  // --- auto approve -------------------------------------------------------
  /* Auto-approval is the one switch that lets an email settle a payment with no
   * human. Same rule: an explicit database value wins, NULL inherits. When
   * neither is set it stays off, which is the safe answer. */
  const autoApproveFromDb = row?.autoApprove ?? null;
  const autoApproveEnv = env.UPI_AUTO_APPROVE;
  const autoApprove = autoApproveFromDb ?? autoApproveEnv;
  const autoApproveSource: ConfigSource =
    autoApproveFromDb !== null ? 'db' : autoApproveEnv ? 'env' : 'unset';

  // --- Gmail credentials --------------------------------------------------
  const gmailUser = row?.gmailUser ?? env.UPI_GMAIL_USER ?? null;
  const gmailClientId = row?.gmailClientId ?? env.UPI_GOOGLE_CLIENT_ID ?? null;

  const dbClientSecret = openOrNull(row?.gmailClientSecretEnc ?? null, key, 'gmailClientSecretEnc');
  const dbRefreshToken = openOrNull(row?.gmailRefreshTokenEnc ?? null, key, 'gmailRefreshTokenEnc');

  const gmailClientSecret = dbClientSecret ?? env.UPI_GOOGLE_CLIENT_SECRET ?? null;
  const gmailRefreshToken = dbRefreshToken ?? env.UPI_GOOGLE_REFRESH_TOKEN ?? null;

  const gmailFromDb = Boolean(
    row?.gmailUser || row?.gmailClientId || row?.gmailClientSecretEnc || row?.gmailRefreshTokenEnc,
  );

  const value: EffectiveUpiConfig = {
    payeeVpa,
    payeeName: row?.payeeName ?? env.UPI_PAYEE_NAME,
    paymentsEnabled,
    /* The observer switch follows the same NULL-inherits rule as the others. */
    gmailEnabled: row?.gmailEnabled ?? Boolean(env.UPI_GMAIL_POLL_SECONDS > 0),
    autoApprove,
    gmailUser,
    gmailClientId,
    gmailClientSecret,
    gmailRefreshToken,
    gmailConnectedAt: row?.gmailConnectedAt ?? null,
    gmailConnectedEmail: row?.gmailConnectedEmail ?? null,
    gmailScopes: row?.gmailScopes ?? null,
    gmailLastVerifiedAt: row?.gmailLastVerifiedAt ?? null,
    secretsUsable: key !== null,
    source: {
      payeeVpa: payeeSource,
      paymentsEnabled: paymentsSource,
      gmail: gmailFromDb ? 'db' : gmailUser ? 'env' : 'unset',
      autoApprove: autoApproveSource,
    },
  };

  cache = { value, expiresAt: Date.now() + TTL_MS, envKey };
  return value;
}

/**
 * Whether checkout may be offered.
 *
 * Both the switch and a usable payee VPA are required: a half-configured
 * integration must not render a QR that sends money to nobody.
 */
export function isUpiAvailable(config: EffectiveUpiConfig): boolean {
  return Boolean(config.paymentsEnabled && config.payeeVpa && isValidVpa(config.payeeVpa));
}

/** Whether the Gmail observer has everything it needs to poll. */
export function isGmailObserverConfigured(config: EffectiveUpiConfig): boolean {
  return Boolean(
    config.gmailEnabled &&
      config.gmailUser &&
      config.gmailClientId &&
      config.gmailClientSecret &&
      config.gmailRefreshToken,
  );
}
