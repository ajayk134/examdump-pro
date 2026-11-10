import type { FastifyInstance } from 'fastify';
import { createSubscriptionSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth, requireVerified } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';
import { serializeUser } from '../lib/serializers.js';
import { User } from '../db/models/index.js';
import {
  cancelSubscription,
  createMockSubscription,
  getCurrentSubscription,
  listPayments,
  listPlans,
} from '../services/subscription.service.js';
import { getEntitlements } from '../services/entitlement.service.js';
import { getSettings } from '../services/settings.service.js';

export async function subscriptionRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/plans', async (_request, reply) => {
    const plans = await listPlans();
    return reply.send({ plans, paymentsEnabled: env.PAYMENTS_ENABLED, mockPayments: env.ALLOW_MOCK_PAYMENTS });
  });

  app.get('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const [subscription, payments, settings] = await Promise.all([
      getCurrentSubscription(user._id),
      listPayments(user._id, 25),
      getSettings(env),
    ]);
    return reply.send({
      subscription,
      payments,
      entitlements: getEntitlements(user, settings),
      paymentsEnabled: env.PAYMENTS_ENABLED,
      mockPayments: env.ALLOW_MOCK_PAYMENTS,
    });
  });

  app.post('/', async (request, reply) => {
    const { user } = await requireVerified(request, env);
    const input = parseOrThrow(createSubscriptionSchema, request.body);
    const result = await createMockSubscription(env, user, input);
    const fresh = await User.findById(user._id);
    return reply.code(201).send({
      subscription: result.subscription,
      payment: result.payment,
      user: fresh ? serializeUser(fresh) : null,
      note: 'Simulated checkout: no real payment was processed.',
    });
  });

  app.post('/:id/cancel', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const subscription = await getCurrentSubscription(user._id);
    if (!subscription || subscription._id.toString() !== id) throw notFound('Subscription not found');
    const canceled = await cancelSubscription(user._id);
    return reply.send({ subscription: canceled });
  });

  app.get('/payments', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const payments = await listPayments(user._id);
    return reply.send({ payments });
  });
}