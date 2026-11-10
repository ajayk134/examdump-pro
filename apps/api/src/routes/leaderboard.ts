import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { optionalAuth } from '../lib/guards.js';
import { getLeaderboard } from '../services/analytics.service.js';

export async function leaderboardRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/', async (request, reply) => {
    void (await optionalAuth(request, env));
    const { period, limit } = request.query as { period?: string; limit?: string };
    const rows = await getLeaderboard(period === 'month' ? 'month' : 'all', Math.min(100, Number(limit) || 20));
    return reply.send({ period: period === 'month' ? 'month' : 'all', leaderboard: rows });
  });
}