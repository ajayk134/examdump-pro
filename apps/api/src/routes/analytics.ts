import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { getDb } from '../db/client.js';
import { examProgress, userStats } from '../db/schema/index.js';
import { eq, desc } from 'drizzle-orm';
import {
  getDashboard,
  getPerformanceSeries,
  getRecommendations,
  getWeakTopics,
} from '../services/analytics.service.js';

export async function analyticsRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/dashboard', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const data = await getDashboard(user.id);
    return reply.send(data);
  });

  app.get('/weak-topics', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { limit } = request.query as { limit?: string };
    const topics = await getWeakTopics(user.id, Math.min(50, Number(limit) || 8));
    return reply.send({ topics });
  });

  app.get('/performance', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { days } = request.query as { days?: string };
    const series = await getPerformanceSeries(user.id, Math.min(365, Number(days) || 30));
    return reply.send({ series });
  });

  app.get('/progress', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const db = getDb();
    const [progress, [stats]] = await Promise.all([
      db.select().from(examProgress).where(eq(examProgress.userId, user.id)).orderBy(desc(examProgress.lastStudiedAt)),
      db.select().from(userStats).where(eq(userStats.userId, user.id)).limit(1),
    ]);
    return reply.send({ progress, stats: stats ?? null });
  });

  app.get('/recommendations', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const recommendations = await getRecommendations(user.id, 6);
    return reply.send({ recommendations });
  });
}
