import { eq } from 'drizzle-orm';
import { getEnv } from '../config/env.js';
import { connectDB, disconnectDB, getDb } from './client.js';
import {
  announcements,
  coupons,
  emailTemplates,
  featureFlags,
  settings,
  userStats,
  users,
} from './schema/index.js';
import { hashPassword } from '../lib/passwords.js';
import { randomReferralCode } from '../lib/tokens.js';
import { ensureDefaultPlans } from '../services/subscription.service.js';
import { ensureRbac } from '../services/rbac.service.js';
import { syncDatasetCatalog } from '../services/dataset.service.js';

const FEATURE_FLAGS = [
  { key: 'ai_explanations', enabled: true, description: 'NVIDIA powered explanations and tutoring.' },
  { key: 'leaderboard', enabled: true, description: 'Public leaderboard.' },
  { key: 'referrals', enabled: true, description: 'Referral rewards programme.' },
  { key: 'mock_exams', enabled: true, description: 'Timed mock exams.' },
  { key: 'early_access', enabled: true, description: 'Early-access content for eligible plans.' },
  { key: 'hyperswitch_checkout', enabled: true, description: 'Live card/UPI checkout via HyperSwitch.' },
  { key: 'support_tickets', enabled: true, description: 'Support centre and ticketing.' },
  { key: 'announcements', enabled: true, description: 'Site-wide announcement banners.' },
  { key: 'invoices', enabled: true, description: 'Downloadable invoices for every payment.' },
];

const EMAIL_TEMPLATES = [
  {
    key: 'verify_email',
    subject: 'Verify your ExamDump Pro email',
    body: 'Hi {{name}}, confirm your email address to activate your account: {{url}}',
    description: 'Sent on registration.',
  },
  {
    key: 'password_reset',
    subject: 'Reset your ExamDump Pro password',
    body: 'We received a request to reset your password. This link expires in 1 hour: {{url}}',
    description: 'Sent on password reset request.',
  },
  {
    key: 'welcome',
    subject: 'Welcome to ExamDump Pro',
    body: 'Welcome aboard, {{name}}! Start practising at {{url}}.',
    description: 'Optional welcome email.',
  },
];

async function seed(): Promise<void> {
  const env = getEnv();
  await connectDB({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 5 });
  const db = getDb();
  console.log('Connected to PostgreSQL');

  await ensureRbac();
  console.log('Roles and permissions ready');

  await ensureDefaultPlans();
  console.log('Default INR plans ready');

  await db
    .insert(settings)
    .values({
      key: 'global',
      freeQuestionsPerExam: env.FREE_QUESTIONS_PER_EXAM,
      freeMockExamsPerDay: 1,
      freeRandomQuestionsPerDay: 20,
      premiumDailyQuestionLimit: env.PREMIUM_DAILY_QUESTION_LIMIT,
      supportEmail: 'support@examdump.pro',
      siteName: 'ExamDump Pro',
    })
    .onConflictDoNothing();
  console.log('Settings ready');

  for (const flag of FEATURE_FLAGS) {
    await db.insert(featureFlags).values(flag).onConflictDoNothing();
  }
  console.log('Feature flags ready');

  for (const template of EMAIL_TEMPLATES) {
    await db.insert(emailTemplates).values(template).onConflictDoNothing();
  }
  console.log('Email templates ready');

  await db
    .insert(coupons)
    .values([
      {
        code: 'WELCOME20',
        description: '20% off your first subscription',
        percentOff: 20,
        maxRedemptions: 0,
        active: true,
      },
      {
        code: 'LAUNCH10',
        description: '10% launch offer across all passes',
        percentOff: 10,
        maxRedemptions: 1000,
        active: true,
      },
    ])
    .onConflictDoNothing();
  console.log('Coupons WELCOME20 / LAUNCH10 ready');

  await db
    .insert(announcements)
    .values({
      title: 'Welcome to ExamDump Pro',
      body: 'Every exam now includes 5 free questions. Unlock unlimited practice with a pass from ₹499.',
      level: 'info',
      audience: 'all',
      active: true,
    })
    .onConflictDoNothing();
  console.log('Announcement ready');

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const email = env.ADMIN_EMAIL.toLowerCase();
    const [admin] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!admin) {
      const [created] = await db
        .insert(users)
        .values({
          email,
          name: 'Administrator',
          passwordHash: await hashPassword(env.ADMIN_PASSWORD, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
          role: 'admin',
          plan: 'premium',
          premiumUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          emailVerified: true,
          referralCode: randomReferralCode(),
        })
        .returning();
      if (created) await db.insert(userStats).values({ userId: created.id }).onConflictDoNothing();
      console.log(`Admin account created for ${email}`);
    } else {
      console.log('Admin account already exists');
    }
  }

  if (env.NODE_ENV !== 'production') {
    const demoEmail = 'demo@examdump.pro';
    const [existing] = await db.select().from(users).where(eq(users.email, demoEmail)).limit(1);
    if (!existing) {
      const [demo] = await db
        .insert(users)
        .values({
          email: demoEmail,
          name: 'Demo Learner',
          passwordHash: await hashPassword('DemoPass123', env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
          role: 'user',
          plan: 'free',
          emailVerified: true,
          referralCode: randomReferralCode(),
        })
        .returning();
      if (demo) await db.insert(userStats).values({ userId: demo.id }).onConflictDoNothing();
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

  console.log('Seed complete.');
  await disconnectDB();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
