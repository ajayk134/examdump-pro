import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { DatasetError } from '@examdump/data-client';
import type { Env } from './config/env.js';
import { getEnv } from './config/env.js';
import { AppError } from './lib/errors.js';
import { buildOpenApi } from './openapi.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { examRoutes } from './routes/exams.js';
import { attemptRoutes } from './routes/attempts.js';
import { bookmarkRoutes } from './routes/bookmarks.js';
import { noteRoutes } from './routes/notes.js';
import { analyticsRoutes } from './routes/analytics.js';
import { notificationRoutes } from './routes/notifications.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { aiRoutes } from './routes/ai.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { paymentRoutes } from './routes/payments.js';
import { couponRoutes } from './routes/coupons.js';
import { referralRoutes } from './routes/referrals.js';
import { adminRoutes } from './routes/admin.js';
import { adminOpsRoutes } from './routes/admin-ops.js';
import { adminEmailRoutes } from './routes/admin-email.js';
import { emailPreferenceRoutes } from './routes/email-preferences.js';
import { upiRoutes } from './routes/upi.js';
import { upiIngestRoutes } from './routes/upi-ingest.js';
import { adminUpiRoutes } from './routes/admin-upi.js';
import { adminUpiConfigRoutes } from './routes/admin-upi-config.js';
import { healthRoutes } from './routes/health.js';
import { supportRoutes } from './routes/support.js';

export interface BuildAppOptions {
  env?: Env;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? getEnv();

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'req.body.password',
                'req.body.currentPassword',
                'req.body.newPassword',
                'req.body.idToken',
                '*.password',
              ],
              censor: '[redacted]',
            },
          },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim().length === 0)) {
      done(null, {});
      return;
    }
    // Keep the exact bytes: webhook signatures are computed over the raw body.
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON.'), undefined);
    }
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: false });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    allowList: ['127.0.0.1'],
  });

  app.get('/api/openapi.json', async (_request, reply) => reply.send(buildOpenApi(env.PUBLIC_WEB_URL)));
  app.get('/api/docs', async (_request, reply) => {
    reply.type('text/html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>ExamDump Pro API</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
<style>body{margin:0;background:#0b1020}</style></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>window.ui=SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#swagger-ui',deepLinking:true});</script>
</body></html>`);
  });

  // Error and 404 handlers must be installed on the root context BEFORE the
  // encapsulated route plugins are registered so every child inherits them.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found.` },
    });
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }

    if (error instanceof DatasetError) {
      const status = error.status === 404 ? 404 : 502;
      return reply.code(status).send({
        error: {
          code: error.code,
          message:
            status === 404
              ? 'The requested exam or question could not be found.'
              : 'The question dataset is temporarily unavailable. Please try again.',
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The submitted data is invalid.',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }

    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: {
          code: (error as { code?: string }).code ?? 'BAD_REQUEST',
          message: error.message,
        },
      });
    }

    request.log.error({ err: error }, 'unhandled_error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
      },
    });
  });

  await app.register(
    async (api) => {
      await api.register(async (r) => healthRoutes(r, env));
      await api.register(async (r) => supportRoutes(r, env), { prefix: '/support' });
      await api.register(async (r) => authRoutes(r, env), { prefix: '/auth' });
      await api.register(async (r) => userRoutes(r, env), { prefix: '/users' });
      await api.register(async (r) => examRoutes(r, env), { prefix: '/exams' });
      await api.register(async (r) => attemptRoutes(r, env), { prefix: '/attempts' });
      await api.register(async (r) => bookmarkRoutes(r, env), { prefix: '/bookmarks' });
      await api.register(async (r) => noteRoutes(r, env), { prefix: '/notes' });
      await api.register(async (r) => analyticsRoutes(r, env), { prefix: '/analytics' });
      await api.register(async (r) => notificationRoutes(r, env), { prefix: '/notifications' });
      await api.register(async (r) => leaderboardRoutes(r, env), { prefix: '/leaderboard' });
      await api.register(async (r) => aiRoutes(r, env), { prefix: '/ai' });
      await api.register(async (r) => subscriptionRoutes(r, env), { prefix: '/subscriptions' });
      await api.register(async (r) => paymentRoutes(r, env), { prefix: '/payments' });
      await api.register(async (r) => couponRoutes(r, env), { prefix: '/coupons' });
      await api.register(async (r) => referralRoutes(r, env), { prefix: '/referrals' });
      await api.register(async (r) => adminRoutes(r, env), { prefix: '/admin' });
      await api.register(async (r) => adminOpsRoutes(r, env), { prefix: '/admin-ops' });
      await api.register(async (r) => adminEmailRoutes(r, env), { prefix: '/admin-ops' });
      await api.register(async (r) => emailPreferenceRoutes(r, env), { prefix: '/email' });
      await api.register(async (r) => upiRoutes(r, env), { prefix: '/upi' });
      await api.register(async (r) => upiIngestRoutes(r, env), { prefix: '/upi' });
      await api.register(async (r) => adminUpiRoutes(r, env), { prefix: '/admin-ops' });
      await api.register(async (r) => adminUpiConfigRoutes(r, env), { prefix: '/admin-ops' });
    },
    { prefix: '/api' },
  );

  return app;
}