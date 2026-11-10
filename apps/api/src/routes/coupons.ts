import type { FastifyInstance } from 'fastify';
import { couponValidateSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { optionalAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';
import { Plan } from '../db/models/index.js';
import { validateCoupon } from '../services/subscription.service.js';

export async function couponRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post('/validate', async (request, reply) => {
    const auth = await optionalAuth(request, env);
    const input = parseOrThrow(couponValidateSchema, request.body);
    const plan = await Plan.findOne({ planId: input.planId });
    if (!plan) throw notFound('Plan not found');

    const result = await validateCoupon(input.code, auth?.user._id);
    const gross = plan.monthlyPrice || plan.yearlyPrice;
    const discount = result.valid ? Math.round(((gross * result.percentOff) / 100) * 100) / 100 : 0;
    return reply.send({
      ...result,
      gross,
      discount,
      total: Math.max(0, Math.round((gross - discount) * 100) / 100),
      currency: plan.currency,
    });
  });
}