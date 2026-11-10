import cron from 'node-cron';
import { buildApp } from './app.js';
import { getEnv, isProduction } from './config/env.js';
import { connectDB, disconnectDB } from './db/connect.js';
import { User, UserStats } from './db/models/index.js';
import { hashPassword } from './lib/passwords.js';
import { randomReferralCode } from './lib/tokens.js';
import { ensureDefaultPlans, expireSubscriptions } from './services/subscription.service.js';
import { syncDatasetCatalog } from './services/dataset.service.js';
import { getSettings } from './services/settings.service.js';
import { CatalogProvider } from './db/models/index.js';

async function bootstrapAdmin(env: ReturnType<typeof getEnv>): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  const existing = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      existing.emailVerified = true;
      await existing.save();
    }
    return;
  }
  const user = await User.create({
    email: env.ADMIN_EMAIL.toLowerCase(),
    name: 'Administrator',
    passwordHash: await hashPassword(env.ADMIN_PASSWORD, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
    role: 'admin',
    plan: 'premium',
    premiumUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    emailVerified: true,
    referralCode: randomReferralCode(),
  });
  await UserStats.create({ userId: user._id });
}

async function main(): Promise<void> {
  const env = getEnv();

  await connectDB({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB });
  await ensureDefaultPlans();
  await getSettings(env);
  await bootstrapAdmin(env);

  const app = await buildApp({ env });

  const tasks: cron.ScheduledTask[] = [];
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
        if (result.expired || result.downgraded) {
          app.log.info(result, 'subscriptions.expired');
        }
      } catch (err) {
        app.log.error({ err }, 'subscriptions.expire_failed');
      }
    }),
  );

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(
    { port: env.API_PORT, env: env.NODE_ENV, datasetBranch: env.DATASET_BRANCH },
    'examdump.api.started',
  );

  // First boot: populate the searchable catalogue automatically so the product
  // is useful immediately (does not block startup).
  if (env.ENABLE_DATASET_SYNC) {
    void (async () => {
      try {
        if ((await CatalogProvider.countDocuments()) === 0) {
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