import { z } from 'zod';

const booleanString = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_TEST: z.string().optional(),
  DATABASE_SSL: booleanString,
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_APP_NAME: z.string().default('examdump-api'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanString,
  PASSWORD_PEPPER: z.string().default(''),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('ExamDump Pro <no-reply@examdump.pro>'),

  GITHUB_TOKEN: z.string().optional(),
  DATASET_OWNER: z.string().default('ajayk134'),
  DATASET_REPO: z.string().default('exam-data'),
  DATASET_BRANCH: z.enum(['main', 'masked_main']).default('main'),
  DATASET_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  DATASET_MAX_QUESTIONS_PER_REQUEST: z.coerce.number().int().positive().default(200),

  FREE_QUESTIONS_PER_EXAM: z.coerce.number().int().positive().default(5),
  PREMIUM_DAILY_QUESTION_LIMIT: z.coerce.number().int().min(0).default(0),
  ENABLE_DATASET_SYNC: booleanString,
  DATASET_SYNC_CRON: z.string().default('0 3 * * *'),

  AI_PROVIDER: z.string().default('openai'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  PAYMENTS_ENABLED: booleanString,
  ALLOW_MOCK_PAYMENTS: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === 'true' || v === '1'),
  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay', 'stripe', 'manual', 'none']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  DEFAULT_CURRENCY: z.string().length(3).default('INR'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test helper: replace the cached env. */
export function setEnvForTests(overrides: Partial<Record<string, string>>): Env {
  cached = loadEnv({ ...process.env, ...overrides });
  return cached;
}

export function resetEnvForTests(): void {
  cached = undefined;
}

export const isProduction = (env: Env): boolean => env.NODE_ENV === 'production';
export const isTest = (env: Env): boolean => env.NODE_ENV === 'test';