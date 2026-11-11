import cron from 'node-cron';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from './app.js';
import { getEnv, isProduction } from './config/env.js';
import { connectDB, disconnectDB, getDb } from './db/client.js';
import { invoices, payments, userStats, users } from './db/schema/index.js';
import { hashPassword } from './lib/passwords.js';
import { randomReferralCode } from './lib/tokens.js';
import { ensureDefaultPlans, expireSubscriptions, issueInvoice } from './services/subscription.service.js';
import { reconcilePayments } from './services/webhook.service.js';
import { checkoutReady } from './services/hyperswitch.client.js';
import { syncDatasetCatalog } from './services/dataset.service.js';
import { getSettings } from './services/settings.service.js';
import { ensureRbac } from './services/rbac.service.js';
import { catalogCounts } from './services/catalog.service.js';

async function bootstrapAdmin(env: ReturnType<typeof getEnv>): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  const db = getDb();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, env.ADMIN_EMAIL.toLowerCase()))
    .limit(1);
  if (existing) {
    if (existing.role !== 'admin') {
      await db.update(users).set({ role: 'admin', emailVerified: true, updatedAt: new Date() }).where(eq(users.id, existing.id));
    }
    return;
  }
  const [user] = await db
    .insert(users)
    .values({
      email: env.ADMIN_EMAIL.toLowerCase(),
      name: 'Administrator',
      passwordHash: await hashPassword(env.ADMIN_PASSWORD, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
      role: 'admin',
      plan: 'premium',
      premiumUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      emailVerified: true,
      referralCode: randomReferralCode(),
    })
    .returning();
  if (user) await db.insert(userStats).values({ userId: user.id }).onConflictDoNothing();
}

async function main(): Promise<void> {
  const env = getEnv();

  await connectDB({
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    max: env.DATABASE_POOL_MAX,
    applicationName: env.DATABASE_APP_NAME,
  });
  await ensureRbac();
  await ensureDefaultPlans();
  await getSettings(env);
  await bootstrapAdmin(env);

  const app = await buildApp({ env });

  const tasks: cron.ScheduledTask[] = [];

  /* ------------------------- ExamDump Mail worker ------------------------- */
  // Outbound mail runs from a durable Postgres queue. The worker is an interval
  // timer in-process: at this volume a separate service would cost more than it
  // saves, and because state lives in the table a restart simply resumes.
  if (env.MAIL_QUEUE_ENABLED) {
    const { drainQueue, recoverQueue, runScheduledJobs } = await import('./services/mail/worker.js');
    const { seedSystemTemplates } = await import('./services/mail/template-store.js');

    // Release rows orphaned by whatever killed the previous process.
    await recoverQueue(env, app.log).catch((err) => app.log.error({ err }, 'mail.recover_failed'));
    // Make built-in templates visible in the Email Center (idempotent).
    await seedSystemTemplates().catch((err) => app.log.warn({ err }, 'mail.seed_templates_failed'));

    const intervalMs = env.MAIL_WORKER_INTERVAL_SECONDS * 1000;
    const timer = setInterval(() => {
      void drainQueue(env, app.log);
    }, intervalMs);
    // Do not hold the process open just to poll an empty queue.
    timer.unref();

    tasks.push(
      cron.schedule(env.MAIL_REMINDER_CRON, async () => {
        try {
          const result = await runScheduledJobs(env, app.log);
          app.log.info(result, 'mail.scheduled_jobs');
        } catch (err) {
          app.log.error({ err }, 'mail.scheduled_jobs_failed');
        }
      }),
    );

    // Kick the queue once at boot so anything left from before the restart goes
    // out immediately rather than waiting for the first interval.
    setImmediate(() => void drainQueue(env, app.log));
    app.log.info(
      { intervalSeconds: env.MAIL_WORKER_INTERVAL_SECONDS, batchSize: env.MAIL_BATCH_SIZE },
      'mail.worker_started',
    );
  }
  if (env.ENABLE_DATASET_SYNC) {
    tasks.push(
      cron.schedule(env.DATASET_SYNC_CRON, async () => {
        try {
          await syncDatasetCatalog(env, app.log);
        } catch (err) {
          app.log.error({ err }, 'dataset.scheduled_sync_failed');
        }
      }),
    );
  }
  tasks.push(
    cron.schedule('15 2 * * *', async () => {
      try {
        const result = await expireSubscriptions();
        if (result.expired || result.downgraded) app.log.info(result, 'subscriptions.expired');
      } catch (err) {
        app.log.error({ err }, 'subscriptions.expire_failed');
      }
    }),
  );

  // Payment reconciliation: re-checks pending HyperSwitch payments against the
  // gateway and repairs drift (missed webhooks, crash between steps, etc).
  if (env.PAYMENT_RECONCILE_CRON && checkoutReady(env)) {
    tasks.push(
      cron.schedule(env.PAYMENT_RECONCILE_CRON, async () => {
        try {
          const result = await reconcilePayments(env, 'schedule');
          if (result.repaired || result.mismatches) app.log.info(result, 'payments.reconciled');
        } catch (err) {
          app.log.error({ err }, 'payments.reconcile_failed');
        }
      }),
    );
  }

  // Backfill invoices for already-paid payments (idempotent, one-shot).
  void (async () => {
    try {
      const db = getDb();
      const paid = await db
        .select({ id: payments.id })
        .from(payments)
        .where(
          sql`${payments.status} in ('succeeded', 'partially_refunded') and not exists (
            select 1 from ${invoices} i where i.payment_id = ${payments.id}
          )`,
        )
        .limit(200);
      for (const row of paid) await issueInvoice(row.id);
    } catch (err) {
      app.log.warn({ err }, 'invoices.backfill_failed');
    }
  })();

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(
    { port: env.API_PORT, env: env.NODE_ENV, datasetBranch: env.DATASET_BRANCH },
    'examdump.api.started',
  );

  if (env.ENABLE_DATASET_SYNC) {
    void (async () => {
      try {
        const counts = await catalogCounts();
        if (counts.providers === 0) {
          app.log.info('catalogue empty - running initial dataset sync');
          await syncDatasetCatalog(env, app.log);
        }
      } catch (err) {
        app.log.warn({ err }, 'dataset.initial_sync_failed');
      }
    })();
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'examdump.api.shutting_down');
    tasks.forEach((t) => t.stop());
    await app.close();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  if (!isProduction(env)) {
    app.log.info('development mode - mock payments and verbose logging enabled');
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
