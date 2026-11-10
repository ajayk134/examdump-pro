import { getEnv } from '../config/env.js';
import { connectDB, disconnectDB } from './connect.js';
import { Coupon, Plan, Settings, User, UserStats } from './models/index.js';
import { hashPassword } from '../lib/passwords.js';
import { randomReferralCode } from '../lib/tokens.js';
import { ensureDefaultPlans } from '../services/subscription.service.js';
import { syncDatasetCatalog } from '../services/dataset.service.js';
import { isPremiumActive } from '../services/entitlement.service.js';

async function seed(): Promise<void> {
  const env = getEnv();
  await connectDB({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB });
  console.log(`Connected to MongoDB database "${env.MONGODB_DB}"`);

  await ensureDefaultPlans();
  console.log('Default plans ready');

  await Settings.findOneAndUpdate(
    { key: 'global' },
    {
      $setOnInsert: {
        key: 'global',
        freeQuestionsPerExam: env.FREE_QUESTIONS_PER_EXAM,
        freeMockExamsPerDay: 1,
        freeRandomQuestionsPerDay: 20,
        premiumDailyQuestionLimit: env.PREMIUM_DAILY_QUESTION_LIMIT,
      },
    },
    { upsert: true },
  );
  console.log('Settings ready');

  await Coupon.findOneAndUpdate(
    { code: 'WELCOME20' },
    {
      $setOnInsert: {
        code: 'WELCOME20',
        description: '20% off your first Premium subscription',
        percentOff: 20,
        maxRedemptions: 0,
        active: true,
      },
    },
    { upsert: true },
  );
  console.log('Demo coupon WELCOME20 ready');

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const email = env.ADMIN_EMAIL.toLowerCase();
    let admin = await User.findOne({ email });
    if (!admin) {
      admin = await User.create({
        email,
        name: 'Administrator',
        passwordHash: await hashPassword(env.ADMIN_PASSWORD, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
        role: 'admin',
        plan: 'premium',
        premiumUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        emailVerified: true,
        referralCode: randomReferralCode(),
      });
      await UserStats.create({ userId: admin._id });
      console.log(`Admin account created for ${email}`);
    } else {
      console.log('Admin account already exists');
    }
  }

  if (env.NODE_ENV !== 'production') {
    const demoEmail = 'demo@examdump.pro';
    const existing = await User.findOne({ email: demoEmail });
    if (!existing) {
      const demo = await User.create({
        email: demoEmail,
        name: 'Demo Learner',
        passwordHash: await hashPassword('DemoPass123', env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
        role: 'user',
        plan: 'free',
        emailVerified: true,
        referralCode: randomReferralCode(),
      });
      await UserStats.create({ userId: demo._id });
      console.log('Demo user created: demo@examdump.pro / DemoPass123');
    }
  }

  if (env.ENABLE_DATASET_SYNC) {
    try {
      console.log(`Syncing dataset catalog from ${env.DATASET_OWNER}/${env.DATASET_REPO}@${env.DATASET_BRANCH} ...`);
      const result = await syncDatasetCatalog(env);
      console.log(
        `Dataset synced: ${result.providers} providers, ${result.exams} exams in ${result.durationMs}ms` +
          (result.errors.length ? `, ${result.errors.length} errors` : ''),
      );
    } catch (err) {
      console.warn('Dataset sync skipped/failed:', (err as Error).message);
    }
  }

  const planCount = await Plan.countDocuments();
  const premiumDemo = await User.findOne({ email: 'demo@examdump.pro' }).lean();
  console.log(`Seed complete. Plans: ${planCount}. Demo premium: ${isPremiumActive(premiumDemo as never)}`);
  await disconnectDB();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});