import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { getReferralStats } from '../services/subscription.service.js';

export async function referralRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const stats = await getReferralStats(user._id);
    return reply.send({
      ...stats,
      shareUrl: `${env.PUBLIC_WEB_URL}/register?ref=${encodeURIComponent(stats.code)}`,
    });
  });
}