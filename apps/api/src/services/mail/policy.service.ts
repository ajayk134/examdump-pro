/**
 * ExamDump Mail — consent and suppression policy.
 *
 * The distinction that matters legally and practically:
 *
 *  - **Transactional** mail (verification, password reset, receipts, security
 *    alerts) is part of delivering a service the user asked for. It is sent
 *    regardless of marketing consent. Only an explicit `unsubscribe_all` or a
 *    hard bounce stops it.
 *  - **Marketing** mail (announcements, product news, campaigns) requires
 *    opt-in. Absence of consent means no send, and an unsubscribe is permanent.
 *
 * Suppressions live in the database keyed by address so they survive account
 * deletion, and every send checks them in one place.
 */
import { eq, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { emailPreferences, emailSuppressions, users } from '../../db/schema/index.js';

export type MailCategory = 'transactional' | 'marketing';

/** Which consent flag governs a given template, if any. */
export type PreferenceKey =
  | 'productUpdates'
  | 'subscriptionReminders'
  | 'weeklyReport'
  | 'securityAlerts';

export interface RecipientPolicyResult {
  allowed: boolean;
  /** Machine-readable reason when blocked, stored on the queue row. */
  reason?: string;
}

const ALL_SCOPE = 'all';

/**
 * Decide whether an address may receive a category of mail.
 *
 * Order of checks is deliberate: suppression list first (it is authoritative
 * and address-based), then user preference.
 */
export async function checkRecipientPolicy(options: {
  email: string;
  category: MailCategory;
  userId?: string | null;
  preference?: PreferenceKey;
  /** Ignore preferences entirely - used for the admin test send. */
  isTest?: boolean;
}): Promise<RecipientPolicyResult> {
  const address = options.email.trim().toLowerCase();
  if (!address.includes('@')) return { allowed: false, reason: 'invalid_recipient' };
  if (options.isTest) return { allowed: true };

  const db = getDb();
  const [suppression] = await db
    .select({ scope: emailSuppressions.scope, reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, address))
    .limit(1);

  if (suppression) {
    // `all` blocks everything; otherwise only marketing is blocked.
    if (suppression.scope === ALL_SCOPE) {
      return { allowed: false, reason: `suppressed_${suppression.reason}` };
    }
    if (options.category === 'marketing') {
      return { allowed: false, reason: `suppressed_${suppression.reason}` };
    }
  }

  // Transactional mail is not gated on marketing consent.
  if (options.category === 'transactional') {
    if (!options.userId || !options.preference) return { allowed: true };
    const prefs = await loadPreferences(options.userId);
    // Security alerts are on by default and treated as essential.
    if (options.preference === 'securityAlerts') return { allowed: true };
    if (prefs && prefs[options.preference] === false) {
      return { allowed: false, reason: `preference_${options.preference}_off` };
    }
    return { allowed: true };
  }

  // Marketing: explicit opt-in required.
  if (!options.userId) return { allowed: false, reason: 'no_account_consent' };
  const prefs = await loadPreferences(options.userId);
  if (!prefs) return { allowed: false, reason: 'no_consent_record' };
  if (!prefs.marketingOptIn) return { allowed: false, reason: 'marketing_opt_out' };
  if (options.preference === 'productUpdates' && !prefs.productUpdates) {
    return { allowed: false, reason: 'preference_productUpdates_off' };
  }
  return { allowed: true };
}

/** Preferences row, or null when the user never interacted with consent. */
export async function loadPreferences(userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Create the preferences row on first touch. Idempotent. */
export async function ensurePreferences(userId: string, source = 'default') {
  const db = getDb();
  const existing = await loadPreferences(userId);
  if (existing) return existing;
  const [row] = await db
    .insert(emailPreferences)
    .values({ userId, consentSource: source, consentAt: new Date() })
    .onConflictDoNothing()
    .returning();
  return row ?? (await loadPreferences(userId));
}

/** Add or update a suppression entry. */
export async function suppressAddress(options: {
  email: string;
  reason: 'hard_bounce' | 'complaint' | 'unsubscribe_marketing' | 'unsubscribe_all' | 'manual';
  scope?: 'marketing' | 'all';
  note?: string;
  createdBy?: string | null;
}): Promise<void> {
  const db = getDb();
  const email = options.email.trim().toLowerCase();
  const scope = options.scope ?? (options.reason === 'unsubscribe_all' ? 'all' : 'marketing');
  await db
    .insert(emailSuppressions)
    .values({
      email,
      reason: options.reason,
      scope,
      note: options.note ?? '',
      createdBy: options.createdBy ?? null,
    })
    .onConflictDoUpdate({
      target: emailSuppressions.email,
      set: {
        reason: options.reason,
        // Never downgrade an `all` suppression back to marketing-only.
        scope: sql`case when ${emailSuppressions.scope} = 'all' then 'all' else ${scope} end`,
        note: options.note ?? '',
      },
    });
}

export async function removeSuppression(email: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(emailSuppressions)
    .where(eq(emailSuppressions.email, email.trim().toLowerCase()))
    .returning({ id: emailSuppressions.id });
  return rows.length > 0;
}

/** Record consent changes so the audit trail shows when and how. */
export async function updatePreferences(
  userId: string,
  patch: Partial<{
    marketingOptIn: boolean;
    productUpdates: boolean;
    subscriptionReminders: boolean;
    weeklyReport: boolean;
    securityAlerts: boolean;
  }>,
  source = 'profile',
): Promise<void> {
  const db = getDb();
  await ensurePreferences(userId);
  await db
    .update(emailPreferences)
    .set({
      ...patch,
      consentSource: source,
      // Consent timestamp only moves when marketing consent is actually granted.
      ...(patch.marketingOptIn === true ? { consentAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(emailPreferences.userId, userId));
}

/**
 * Guard the volume an instance will attempt in one run.
 *
 * Gmail SMTP is rate limited (roughly 100–150 messages/hour for a consumer
 * account). Sending faster only generates throttling errors and risks the
 * account, so the worker stays well under it and spreads the rest over time.
 */
export function checkSendingBudget(env: Env, attemptedLastHour: number): {
  allowed: boolean;
  remaining: number;
} {
  const remaining = Math.max(0, env.MAIL_HOURLY_SEND_LIMIT - attemptedLastHour);
  return { allowed: remaining > 0, remaining };
}
