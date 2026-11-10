import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { ExamProgress, UserStats } from '../db/models/index.js';
import {
  getDashboard,
  getPerformanceSeries,
  getRecommendations,
  getWeakTopics,
} from '../services/analytics.service.js';

export async function analyticsRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/dashboard', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const data = await getDashboard(user._id);
    return reply.send(data);
  });

  app.get('/weak-topics', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { limit } = request.query as { limit?: string };
    const topics = await getWeakTopics(user._id, Math.min(50, Number(limit) || 8));
    return reply.send({ topics });
  });

  app.get('/performance', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { days } = request.query as { days?: string };
    const series = await getPerformanceSeries(user._id, Math.min(365, Number(days) || 30));
    return reply.send({ series });
  });

  app.get('/progress', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const [progress, stats] = await Promise.all([
      ExamProgress.find({ userId: user._id }).sort({ lastStudiedAt: -1 }).lean(),
      UserStats.findOne({ userId: user._id }).lean(),
    ]);
    return reply.send({ progress, stats });
  });

  app.get('/recommendations', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const recommendations = await getRecommendations(user._id, 6);
    return reply.send({ recommendations });
  });
}