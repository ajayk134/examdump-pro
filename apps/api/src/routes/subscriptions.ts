import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { changePlanSchema, createSubscriptionSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth, requireVerified } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, notFound } from '../lib/errors.js';
import { serializeUser } from '../lib/serializers.js';
import { getDb } from '../db/client.js';
import { catalogExams, users } from '../db/schema/index.js';
import {
  cancelSubscription,
  createSubscription,
  getCurrentSubscription,
  listAccessGrants,
  listPayments,
  listPlans,
  listUserSubscriptions,
} from '../services/subscription.service.js';
import { resolveEntitlements } from '../services/entitlement.service.js';
import { getSettings } from '../services/settings.service.js';

async function enrichExam(input: { examKey?: string; providerId?: string }) {
  if (!input.examKey) return { examKey: undefined, providerId: undefined, examTitle: undefined };
  const db = getDb();
  const [exam] = input.providerId
    ? await db
        .select()
        .from(catalogExams)
        .where(and(eq(catalogExams.key, input.examKey), eq(catalogExams.providerId, input.providerId)))
        .limit(1)
    : await db.select().from(catalogExams).where(eq(catalogExams.key, input.examKey)).limit(1);
  if (!exam) throw badRequest('Select a valid exam to unlock.');
  return { examKey: exam.key, providerId: exam.providerId, examTitle: exam.title };
}

export async function subscriptionRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/plans', async (_request, reply) => {
    const plans = await listPlans();
    return reply.send({
      plans,
      currency: env.DEFAULT_CURRENCY,
      paymentsEnabled: env.PAYMENTS_ENABLED,
      mockPayments: env.ALLOW_MOCK_PAYMENTS,
      provider: env.PAYMENT_PROVIDER,
    });
  });

  app.get('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const settings = await getSettings(env);
    const [subscription, subscriptions, payments, grants, entitlements] = await Promise.all([
      getCurrentSubscription(user.id),
      listUserSubscriptions(user.id),
      listPayments(user.id, 25),
      listAccessGrants(user.id),
      resolveEntitlements(user, settings),
    ]);
    return reply.send({
      subscription,
      subscriptions,
      payments,
      grants: grants.filter((g) => !g.revokedAt),
      entitlements,
      paymentsEnabled: env.PAYMENTS_ENABLED,
      mockPayments: env.ALLOW_MOCK_PAYMENTS,
      provider: env.PAYMENT_PROVIDER,
    });
  });

  app.post('/', async (request, reply) => {
    const { user } = await requireVerified(request, env);
    const input = parseOrThrow(createSubscriptionSchema, request.body);
    const exam = await enrichExam(input);
    const result = await createSubscription(env, user, {
      planId: input.planId,
      examKey: exam.examKey,
      providerId: exam.providerId,
      couponCode: input.couponCode,
    });
    const [fresh] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1);
    return reply.code(201).send({
      subscription: result.subscription,
      payment: result.payment,
      user: fresh ? serializeUser(fresh) : null,
      note: 'Simulated checkout: no real payment was processed.',
    });
  });

  app.post('/change', async (request, reply) => {
    const { user } = await requireVerified(request, env);
    const input = parseOrThrow(changePlanSchema, request.body);
    const exam = await enrichExam(input);
    const result = await createSubscription(env, user, {
      planId: input.planId,
      examKey: exam.examKey,
      providerId: exam.providerId,
      couponCode: input.couponCode,
    });
    const [fresh] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1);
    return reply.code(201).send({
      subscription: result.subscription,
      payment: result.payment,
      user: fresh ? serializeUser(fresh) : null,
      note: 'Plan changed. Previous overlapping access was superseded.',
    });
  });

  app.post('/:id/cancel', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const current = await getCurrentSubscription(user.id);
    const target = await listUserSubscriptions(user.id);
    if (!target.some((s) => s.id === id) && current?.id !== id) throw notFound('Subscription not found');
    const canceled = await cancelSubscription(user.id, id);
    return reply.send({ subscription: canceled });
  });

  app.get('/payments', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const payments = await listPayments(user.id);
    return reply.send({ payments });
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
}
