import { applyMigrations } from '../src/db/apply-migrations.js';
import { resolve } from 'node:path';
import { DatasetClient } from '@examdump/data-client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadEnv, type Env } from '../src/config/env.js';
import { connectDB, disconnectDB, getDb, getSql } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { setDatasetClientForTests } from '../src/services/dataset.service.js';
import { ensureDefaultPlans } from '../src/services/subscription.service.js';
import { ensureRbac } from '../src/services/rbac.service.js';
import { getSettings } from '../src/services/settings.service.js';
import { catalogExams, catalogProviders, userStats, users } from '../src/db/schema/index.js';
import { hashPassword } from '../src/lib/passwords.js';
import { randomReferralCode } from '../src/lib/tokens.js';

const DEFAULT_DATABASE_URL_TEST = 'postgres://postgres:postgres@127.0.0.1:5433/examdump_test';

const question = (n: number) => ({
  Title: `Exam topic ${Math.ceil(n / 2)} question ${n} discussion - ExamTopics`,
  Question: { content: [{ type: 'text', value: `Practice question number ${n}. Which option is correct?` }] },
  Choices: {
    A: { content: [{ type: 'text', value: 'A. Correct option' }] },
    B: { content: [{ type: 'text', value: 'B. Distractor one' }] },
    C: { content: [{ type: 'text', value: 'C. Distractor two' }] },
    D: { content: [{ type: 'text', value: 'D. Distractor three' }] },
  },
  Answer: { content: [{ type: 'text', value: 'Suggested Answer: A' }] },
  Explanation: { content: [{ type: 'text', value: 'Option A is correct because it is.' }] },
  Vote_count: [
    { voted_answers: 'A', vote_count: 8, is_most_voted: true },
    { voted_answers: 'B', vote_count: 2, is_most_voted: false },
  ],
});

export const DATASET: Record<string, unknown> = {
  'data/index.json': {
    cisco: { file: 'cisco', title: 'Cisco' },
    amazon: { file: 'amazon', title: 'Amazon Web Services (AWS)' },
  },
  'data/cisco/exams.json': {
    cisco: { '200-301': 10, '100-890': 2 },
  },
  'data/amazon/exams.json': {
    amazon: {},
  },
  'data/cisco/200-301.json': {
    '200-301': Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`Question #: ${i + 1}`, question(i + 1)]),
    ),
  },
  'data/cisco/100-890.json': {
    '100-890': Object.fromEntries(
      Array.from({ length: 2 }, (_, i) => [`Question #: ${i + 1}`, question(i + 1)]),
    ),
  },
};

function fakeFetch(routes: Record<string, unknown> = DATASET): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const relative = decodeURIComponent(url.replace(/^https:\/\/test\.local\//, ''));
    const body = routes[relative];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

export interface TestContext {
  app: FastifyInstance;
  env: Env;
  cleanup: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const url = process.env.DATABASE_URL_TEST ?? DEFAULT_DATABASE_URL_TEST;

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
    PASSWORD_PEPPER: 'test-pepper',
    BCRYPT_ROUNDS: '8',
    PUBLIC_WEB_URL: 'http://localhost:3100',
    WEB_ORIGIN: 'http://localhost:3100',
    ADMIN_EMAIL: 'admin@test.local',
    ADMIN_PASSWORD: 'AdminPass123',
    PAYMENTS_ENABLED: 'false',
    ALLOW_MOCK_PAYMENTS: 'true',
    PAYMENT_PROVIDER: 'mock',
    ENABLE_DATASET_SYNC: 'false',
    RATE_LIMIT_MAX: '100000',
    LOG_LEVEL: 'silent',
    GITHUB_TOKEN: '',
    // Tests must never send real mail. Empty credentials make `mailConfigured`
    // false, which also enables the dev-only verification/reset URL fallback the
    // helper relies on.
    MAIL_ENABLED: 'false',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
  });

  await connectDB({ url, applicationName: 'examdump-api-test' });
  const sql = getSql();
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  await applyMigrations(sql, resolve(process.cwd(), 'src/db/migrations'));

  await ensureRbac();
  await ensureDefaultPlans();
  await getSettings(env, true);

  const db = getDb();
  const [admin] = await db
    .insert(users)
    .values({
      email: env.ADMIN_EMAIL!,
      name: 'Test Admin',
      passwordHash: await hashPassword(env.ADMIN_PASSWORD!, env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS),
      role: 'admin',
      plan: 'premium',
      emailVerified: true,
      referralCode: randomReferralCode(),
    })
    .returning();
  await db.insert(userStats).values({ userId: admin!.id }).onConflictDoNothing();

  await db.insert(catalogProviders).values({
    providerId: 'cisco',
    file: 'cisco',
    title: 'Cisco',
    slug: 'cisco',
    examCount: 2,
    totalQuestions: 12,
  });
  await db.insert(catalogExams).values([
    {
      providerId: 'cisco',
      providerTitle: 'Cisco',
      providerSlug: 'cisco',
      key: '200-301',
      code: '200-301',
      title: '200-301',
      slug: 'cisco-200-301',
      questionCount: 10,
    },
    {
      providerId: 'cisco',
      providerTitle: 'Cisco',
      providerSlug: 'cisco',
      key: '100-890',
      code: '100-890',
      title: '100-890',
      slug: 'cisco-100-890',
      questionCount: 2,
    },
  ]);

  setDatasetClientForTests(
    new DatasetClient({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      baseUrl: 'https://test.local',
      fetchImpl: fakeFetch(),
      cacheTtlSeconds: 1,
    }),
  );

  const app = await buildApp({ env, logger: process.env.TEST_LOGS === "1" });

  return {
    app,
    env,
    cleanup: async () => {
      await app.close();
      setDatasetClientForTests(null);
      await disconnectDB();
    },
  };
}

export function extractCookies(response: LightMyRequestResponse): string {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export interface RegisteredUser {
  cookie: string;
  userId: string;
  email: string;
  password: string;
}

export async function registerVerifiedUser(
  app: FastifyInstance,
  options: { email?: string; password?: string; name?: string } = {},
): Promise<RegisteredUser> {
  const email = options.email ?? `user_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = options.password ?? 'UserPass123';
  const name = options.name ?? 'Test User';

  const register = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name, email, password, acceptTerms: true },
  });
  if (register.statusCode !== 201) throw new Error(`register failed: ${register.body}`);
  const registerBody = register.json() as { user: { id: string }; devVerificationUrl: string };
  const token = new URL(registerBody.devVerificationUrl).searchParams.get('token');
  if (!token) throw new Error('missing verification token');

  const verify = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    payload: { token },
  });
  if (verify.statusCode !== 200) throw new Error(`verify failed: ${verify.body}`);

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);

  return {
    cookie: extractCookies(login),
    userId: (login.json() as { user: { id: string } }).user.id,
    email,
    password,
  };
}

export async function loginAdmin(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@test.local', password: 'AdminPass123' },
  });
  if (response.statusCode !== 200) throw new Error(`admin login failed: ${response.body}`);
  return extractCookies(response);
}

/** Subscribe a user to a plan via the API (mock payments). */
export async function subscribeUser(
  app: FastifyInstance,
  cookie: string,
  planId: string,
  examKey?: string,
): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/mock-activate',
    headers: { cookie },
    payload: { planId, ...(examKey ? { examKey } : {}) },
  });
  if (response.statusCode !== 201) throw new Error(`subscribe failed: ${response.body}`);
}
