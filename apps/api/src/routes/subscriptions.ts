import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { checkoutSchema, examSelectionSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth, requireVerified } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { serializeUser } from '../lib/serializers.js';
import { getDb } from '../db/client.js';
import { catalogExams, users } from '../db/schema/index.js';
import {
  cancelSubscription,
  getCurrentSubscription,
  listAccessGrants,
  listInvoices,
  listPayments,
  listPlans,
  listUserSubscriptions,
  quotePlan,
  resumeSubscription,
  updateExamSelection,
} from '../services/subscription.service.js';
import { resolveEntitlements } from '../services/entitlement.service.js';
import { getSettings } from '../services/settings.service.js';
import { checkoutReady, hyperswitchConfigured, webhookConfigured } from '../services/hyperswitch.client.js';

/** Resolve exam keys to catalogue rows so clients can render titles. */
async function resolveExams(examKeys: string[]) {
  if (examKeys.length === 0) return [];
  const db = getDb();
  const rows = await Promise.all(
    examKeys.map(async (key) => {
      const [exam] = await db.select().from(catalogExams).where(eq(catalogExams.key, key)).limit(1);
      return exam;
    }),
  );
  const missing = examKeys.filter((_, i) => !rows[i]);
  if (missing.length > 0) throw badRequest(`Unknown exam: ${missing.join(', ')}`);
  return rows.map((e) => ({ key: e!.key, title: e!.title, providerId: e!.providerId }));
}

export async function subscriptionRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/plans', async (_request, reply) => {
    const plans = await listPlans();
    return reply.send({
      plans,
      currency: env.DEFAULT_CURRENCY,
      // Live payments are only advertised when the gateway + webhook secrets
      // are actually present; otherwise the UI shows a clear unavailable state.
      paymentsEnabled: checkoutReady(env),
      gateway: {
        provider: checkoutReady(env) ? 'hyperswitch' : 'none',
        configured: hyperswitchConfigured(env),
        webhooksConfigured: webhookConfigured(env),
        publishableKey: checkoutReady(env) ? (env.HYPERSWITCH_API_KEY ?? '') : '',
        merchantId: env.HYPERSWITCH_MERCHANT_ID ?? '',
        baseUrl: env.HYPERSWITCH_BASE_URL ?? '',
      },
      freeQuestionsPerExam: (await getSettings(env)).freeQuestionsPerExam,
      // True only when simulated activation is genuinely reachable; never in
      // production.
      mockPayments: env.ALLOW_MOCK_PAYMENTS && env.NODE_ENV !== 'production',
    });
  });

  app.get('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const settings = await getSettings(env);
    const [subscription, subscriptions, payments, grants, entitlements, invoices] = await Promise.all([
      getCurrentSubscription(user.id),
      listUserSubscriptions(user.id),
      listPayments(user.id, 25),
      listAccessGrants(user.id),
      resolveEntitlements(user, settings),
      listInvoices(user.id),
    ]);
    const activeExams = await resolveExams(entitlements.examKeys).catch(() => []);
    return reply.send({
      subscription,
      subscriptions,
      payments,
      invoices,
      grants: grants.filter((g) => !g.revokedAt),
      entitlements,
      activeExams,
      paymentsEnabled: checkoutReady(env),
    });
  });

  app.post('/quote', async (request, reply) => {
    const auth = await requireAuth(request, env).catch(() => null);
    const input = parseOrThrow(checkoutSchema, request.body);
    const quote = await quotePlan(auth?.user.id ?? null, input);
    return reply.send({
      plan: quote.plan,
      examKeys: quote.examKeys,
      grossMinor: quote.grossMinor,
      discountMinor: quote.discountMinor,
      totalMinor: quote.totalMinor,
      currency: quote.currency,
      couponCode: quote.couponCode,
    });
  });

  // Upgrades/downgrades go through the same checkout; `/change` is kept as an
  // alias so older clients keep working but never grants access without payment.
  app.post('/change', async (request, reply) => {
    const { user } = await requireVerified(request, env);
    const input = parseOrThrow(checkoutSchema, request.body);
    const quote = await quotePlan(user.id, input);
    return reply.code(409).send({
      error: {
        code: 'PAYMENT_REQUIRED',
        message: 'Plan changes are completed through secure checkout.',
      },
      quote: {
        planId: quote.plan.id,
        totalMinor: quote.totalMinor,
        discountMinor: quote.discountMinor,
        currency: quote.currency,
        examKeys: quote.examKeys,
      },
      checkoutEndpoint: '/api/payments/checkout',
    });
  });

  app.patch('/:id/exams', async (request, reply) => {
    const { user } = await requireVerified(request, env);
    const { id } = request.params as { id: string };
    const input = parseOrThrow(examSelectionSchema, request.body);
    if (input.subscriptionId !== id) throw badRequest('Subscription id mismatch.');
    await resolveExams(input.examKeys);
    const subscription = await updateExamSelection(user.id, id, input.examKeys);
    const [fresh] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1);
    return reply.send({ subscription, user: fresh ? serializeUser(fresh) : null });
  });

  app.post('/:id/cancel', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const all = await listUserSubscriptions(user.id);
    if (!all.some((s) => s.id === id)) throw notFound('Subscription not found');
    if (all.find((s) => s.id === id)?.status === 'expired') {
      throw forbidden('This subscription has already ended.');
    }
    const canceled = await cancelSubscription(user.id, id);
    return reply.send({ subscription: canceled });
  });

  app.post('/:id/resume', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const subscription = await resumeSubscription(user.id, id);
    return reply.send({ subscription });
  });

  app.get('/payments', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const payments = await listPayments(user.id);
    return reply.send({ payments });
  });

  app.get('/invoices', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    return reply.send({ invoices: await listInvoices(user.id) });
  });

  app.get('/grants', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const grants = await listAccessGrants(user.id);
    return reply.send({ grants });
  });

  app.get('/history', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const subscriptions = await listUserSubscriptions(user.id);
    return reply.send({ subscriptions });
  });

  app.get('/entitlements', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const settings = await getSettings(env);
    const entitlements = await resolveEntitlements(user, settings);
    const activeExams = await resolveExams(entitlements.examKeys).catch(() => []);
    return reply.send({ entitlements, activeExams });
  });

  /** Convenience: is a given exam unlocked for the caller? */
  app.get('/can-access', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { exam } = request.query as { exam?: string };
    if (!exam) throw badRequest('Provide ?exam=<examKey>.');
    const settings = await getSettings(env);
    const entitlements = await resolveEntitlements(user, settings);
    const db = getDb();
    const [row] = await db.select().from(catalogExams).where(eq(catalogExams.key, exam)).limit(1);
    const unlocked = entitlements.allAccess || entitlements.examKeys.includes(exam);
    return reply.send({
      exam,
      unlocked,
      questionsPerExam: unlocked ? null : entitlements.questionsPerExam,
      providerId: row?.providerId ?? null,
    });
  });
}
