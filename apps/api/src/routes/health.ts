import type { FastifyInstance } from 'fastify';
import { isDBConnected } from '../db/client.js';
import { catalogCounts } from '../services/catalog.service.js';
import { count } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users } from '../db/schema/index.js';
import type { Env } from '../config/env.js';

export async function healthRoutes(app: FastifyInstance, env: Env): Promise<void> {
  const startedAt = Date.now();

  app.get('/health', async (_request, reply) => {
    const connected = await isDBConnected();
    return reply.send({
      status: 'ok',
      service: 'examdump-api',
      version: '1.0.0',
      env: env.NODE_ENV,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database: connected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health/live', async (_request, reply) => reply.send({ status: 'alive' }));

  app.get('/health/ready', async (_request, reply) => {
    const ready = await isDBConnected();
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      database: ready ? 'connected' : 'disconnected',
    });
  });

  app.get('/health/stats', async (_request, reply) => {
    const catalog = await catalogCounts();
    const [totalUsers] = await getDb().select({ value: count() }).from(users);
    return reply.send({
      ...catalog,
      users: Number(totalUsers?.value ?? 0),
      datasetBranch: env.DATASET_BRANCH,
    });
  });
}
