/**
 * Email preference and unsubscribe routes.
 *
 * `/unsubscribe` is deliberately public: it is opened from an email client with
 * no session, and RFC 8058 one-click posts arrive without cookies either. The
 * authority is the signed token in the URL.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parseOrThrow } from '../lib/validation.js';
import {
  ensurePreferences,
  loadPreferences,
  removeSuppression,
  suppressAddress,
  updatePreferences,
} from '../services/mail/policy.service.js';
import { verifyUnsubscribeToken } from '../services/mail/unsubscribe.js';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users } from '../db/schema/index.js';
import { recordAudit } from '../services/audit.service.js';

const prefsSchema = z.object({
  marketingOptIn: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
  subscriptionReminders: z.boolean().optional(),
  weeklyReport: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
});

/** Shape returned to the client. Essential email is always shown as on. */
function serialize(prefs: Awaited<ReturnType<typeof loadPreferences>>) {
  return {
    marketingOptIn: prefs?.marketingOptIn ?? false,
    productUpdates: prefs?.productUpdates ?? true,
    subscriptionReminders: prefs?.subscriptionReminders ?? true,
    weeklyReport: prefs?.weeklyReport ?? true,
    securityAlerts: prefs?.securityAlerts ?? true,
    updatedAt: prefs?.updatedAt ?? null,
    consentSource: prefs?.consentSource ?? 'default',
  };
}

export async function emailPreferenceRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /** Current user's email preferences. */
  app.get('/preferences', async (request) => {
    const auth = await requireAuth(request, env);
    await ensurePreferences(auth.user.id);
    return { preferences: serialize(await loadPreferences(auth.user.id)) };
  });

  /** Update preferences. Security alerts cannot be switched off from here. */
  app.patch('/preferences', async (request) => {
    const auth = await requireAuth(request, env);
    const patch = parseOrThrow(prefsSchema, request.body);
    await updatePreferences(auth.user.id, patch, 'profile');
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.preferences_updated',
      metadata: patch as Record<string, unknown>,
    });
    return { preferences: serialize(await loadPreferences(auth.user.id)) };
  });

  /**
   * Unsubscribe, callable from an email link with no session.
   *
   * `scope=all` stops everything including transactional mail; the default stops
   * only marketing. `marketing` is kept as an alias so older links keep working.
   */
  app.post('/unsubscribe', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request) => {
    const input = parseOrThrow(
      z.object({
        e: z.string().email(),
        u: z.string().uuid().optional(),
        t: z.string().min(10),
        scope: z.enum(['marketing', 'all']).optional(),
      }),
      request.body,
    );

    // A token without a user id cannot be verified; treat it as invalid rather
    // than silently unsubscribing an arbitrary address.
    if (!input.u) throw badRequest('This unsubscribe link is invalid.');
    if (!verifyUnsubscribeToken(env, input.e, input.u, input.t)) {
      throw badRequest('This unsubscribe link is invalid or has expired.');
    }

    const scope = input.scope === 'all' ? 'all' : 'marketing';
    await suppressAddress({
      email: input.e,
      reason: scope === 'all' ? 'unsubscribe_all' : 'unsubscribe_marketing',
      scope,
    });
    // Marketing opt-in is revoked regardless of scope.
    await updatePreferences(input.u, { marketingOptIn: false }, 'unsubscribe_link');

    return { unsubscribed: true, scope };
  });

  /** One-click unsubscribe (RFC 8058) posts a bare form body. */
  app.post('/unsubscribe/one-click', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const e = query.e;
    const u = query.u;
    const t = query.t;
    if (!e || !u || !t || !verifyUnsubscribeToken(env, e, u, t)) {
      throw badRequest('This unsubscribe link is invalid.');
    }
    await suppressAddress({ email: e, reason: 'unsubscribe_marketing', scope: 'marketing' });
    await updatePreferences(u, { marketingOptIn: false }, 'one_click');
    return { unsubscribed: true, scope: 'marketing' };
  });

  /** Admin: re-subscribe an address after a mistake. */
  app.delete('/suppressions/:email', async (request) => {
    const auth = await requireAuth(request, env);
    if (auth.user.role !== 'admin') throw badRequest('Administrator access is required.');
    const email = (request.params as { email: string }).email;
    const removed = await removeSuppression(decodeURIComponent(email));
    if (!removed) throw notFound('That address is not suppressed.');
    return { removed: true };
  });

  /** Public preference view for a signed link (no login needed). */
  app.get('/preferences/link', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const { e, u, t } = query;
    if (!e || !u || !t || !verifyUnsubscribeToken(env, e, u, t)) {
      throw badRequest('This link is invalid or has expired.');
    }
    const db = getDb();
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, u)).limit(1);
    if (!user) throw notFound('Account not found.');
    return { email: e, preferences: serialize(await loadPreferences(u)) };
  });
}
