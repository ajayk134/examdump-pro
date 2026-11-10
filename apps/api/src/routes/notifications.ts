import type { FastifyInstance } from 'fastify';
import { notificationReadSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { listNotifications, markNotificationsRead } from '../services/notification.service.js';

export async function notificationRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { limit, unreadOnly } = request.query as { limit?: string; unreadOnly?: string };
    const result = await listNotifications(
      user._id.toString(),
      Math.min(100, Number(limit) || 30),
      unreadOnly === 'true',
    );
    return reply.send(result);
  });

  app.post('/read', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(notificationReadSchema, request.body ?? {});
    const updated = await markNotificationsRead(user._id.toString(), input.all ? undefined : input.ids);
    return reply.send({ updated });
  });
}