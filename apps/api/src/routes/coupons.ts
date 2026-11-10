import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { couponValidateSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { optionalAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { plans } from '../db/schema/index.js';
import { validateCoupon } from '../services/subscription.service.js';

export async function couponRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post('/validate', async (request, reply) => {
    const auth = await optionalAuth(request, env);
    const input = parseOrThrow(couponValidateSchema, request.body);
    const [plan] = await getDb()
      .select()
      .from(plans)
      .where(and(eq(plans.id, input.planId), eq(plans.active, true)))
      .limit(1);
    if (!plan) throw notFound('Plan not found');

    const result = await validateCoupon(input.code, auth?.user?.id);
    const gross = plan.priceMinor;
    const discount = result.valid ? Math.round((gross * result.percentOff) / 100) : 0;
    return reply.send({
      ...result,
      gross,
      discount,
      total: Math.max(0, gross - discount),
      currency: plan.currency,
    });
  });
}
