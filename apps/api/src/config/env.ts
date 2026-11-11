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

  /* ---------------- Email: ExamDump Mail (Gmail SMTP) ---------------- */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  /**
   * STARTTLS on 587 must be `false` here: nodemailer then connects in plain
   * text and upgrades with STARTTLS. Setting `true` means implicit TLS (465).
   */
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  /** Google App Password. Server-side only; never sent to the frontend. */
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('ExamDump <examdump.official@gmail.com>'),
  /** Reply-To shown in the mail client. Defaults to the sender address. */
  MAIL_REPLY_TO: z.string().optional(),
  /** Base URL used to build absolute links inside emails. */
  MAIL_PUBLIC_URL: z.string().optional(),
  /** Master switch so mail can be paused without removing credentials. */
  MAIL_ENABLED: booleanString,
  /** Attempts per message (first try + retries). */
  MAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  /** Base backoff between retries, in ms (doubles each attempt). */
  MAIL_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  /** Per-recipient throttle: max messages per window. */
  MAIL_RATE_MAX: z.coerce.number().int().positive().default(5),
  MAIL_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Connection watchdog for a single SMTP conversation. */
  MAIL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

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

  /* ---------------- AI (NVIDIA NIM by default) ---------------- */
  AI_PROVIDER: z.enum(['nvidia', 'openai', 'openai-compatible']).default('nvidia'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'),
  AI_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(1400),
  // The tutor is available to every registered account regardless of plan;
  // this allowance is generous on purpose and only exists as fair use.
  AI_DAILY_LIMIT_FREE: z.coerce.number().int().min(0).default(75),
  AI_DAILY_LIMIT_PREMIUM: z.coerce.number().int().min(0).default(200),
  AI_WEB_SEARCH: booleanString,

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  /* ---------------- Payments: HyperSwitch ---------------- */
  PAYMENTS_ENABLED: booleanString,
  ALLOW_MOCK_PAYMENTS: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  PAYMENT_PROVIDER: z
    .enum(['mock', 'hyperswitch', 'razorpay', 'stripe', 'manual', 'none'])
    .default('mock'),
  /** HyperSwitch router base URL, e.g. https://payments.example.com */
  HYPERSWITCH_BASE_URL: z.string().optional(),
  /** Merchant API key (X-API-KEY). */
  HYPERSWITCH_API_KEY: z.string().optional(),
  /** Master key; required for admin APIs (oauth keys, connector setup). */
  HYPERSWITCH_ADMIN_API_KEY: z.string().optional(),
  HYPERSWITCH_MERCHANT_ID: z.string().optional(),
  /** Profile id the checkout uses (created by the setup script). */
  HYPERSWITCH_PROFILE_ID: z.string().optional(),
  /** Shared secret used to sign outgoing webhooks (HMAC-SHA512 hex). */
  HYPERSWITCH_WEBHOOK_SECRET: z.string().optional(),
  HYPERSWITCH_API_VERSION: z.string().default('2022-09-10'),
  /** Comma separated connector names to try at confirmation time. */
  HYPERSWITCH_CONNECTORS: z.string().default('stripe,razorpay'),
  /** Publicly reachable URL HyperSwitch posts webhooks to. */
  PAYMENT_WEBHOOK_URL: z.string().optional(),
  /** Reconciliation job schedule (cron). Empty disables it. */
  PAYMENT_RECONCILE_CRON: z.string().default('*/30 * * * *'),
  /** Timeout for gateway HTTP calls in ms. */
  PAYMENT_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /* -------- ExamDump Pay: modular adapters (UPI / card) -------- */
  /**
   * Adapter that will handle live payments. 'none' keeps the platform free-tier
   * only and no checkout is ever offered. No adapter can settle a payment
   * without a verified gateway callback.
   */
  PAYMENT_ADAPTER: z.enum(['none', 'razorpay', 'hyperswitch']).default('none'),
  /** Methods offered by the checkout UI once an adapter is live. */
  PAYMENT_METHODS: z.string().default('upi,card'),
  /** Secret used to sign internal webhook replays / adapter callbacks (HMAC-SHA256). */
  PAYMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  /** Minimum and maximum order value (minor units) accepted from clients. */
  PAYMENT_MIN_AMOUNT_MINOR: z.coerce.number().int().positive().default(100),
  PAYMENT_MAX_AMOUNT_MINOR: z.coerce.number().int().positive().default(10_000_000),
  /** Max refunds per payment before manual review is required. */
  PAYMENT_MAX_REFUNDS: z.coerce.number().int().positive().default(5),
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