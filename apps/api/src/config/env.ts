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
  /**
   * Origin the API is reachable on from a browser, when it differs from the web
   * app. Only needed for building the OAuth redirect URI; leave unset when the
   * API and web app share an origin, which is the current deployment.
   */
  API_PUBLIC_URL: z.string().optional(),
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
  /**
   * Master switch so mail can be paused without removing credentials.
   *
   * Opt-out, not opt-in: an operator who supplies SMTP credentials expects mail
   * to work. Defaults to true; set MAIL_ENABLED=false to pause sending (every
   * message is then logged as `suppressed`, never silently dropped).
   */
  MAIL_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  /** Attempts per message (first try + retries). */
  MAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  /** Base backoff between retries, in ms (doubles each attempt). */
  MAIL_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  /** Per-recipient throttle: max messages per window. */
  MAIL_RATE_MAX: z.coerce.number().int().positive().default(5),
  MAIL_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Connection watchdog for a single SMTP conversation. */
  MAIL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /**
   * Explicit address used by the admin mail test. Kept in configuration so a
   * verification send can never be pointed at an arbitrary third party.
   */
  MAIL_TEST_RECIPIENT: z.string().optional(),

  /* ------------------------- durable email queue ------------------------- */
  /** Background worker drains the queue. Off in tests that do not want it. */
  MAIL_QUEUE_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  /** Messages claimed per worker tick. */
  MAIL_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  /** How often the worker wakes up, in seconds. */
  MAIL_WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(600).default(20),
  /** Cron expression for subscription reminder scheduling. */
  MAIL_REMINDER_CRON: z.string().default('0 9 * * *'),
  /**
   * Hard ceiling on messages sent per rolling hour.
   *
   * A consumer Gmail account allows roughly 100-150 recipients/hour; exceeding
   * it triggers throttling and can risk the account. Stays comfortably under.
   */
  MAIL_HOURLY_SEND_LIMIT: z.coerce.number().int().positive().default(100),
  /** Bulk campaigns are spread in chunks rather than sent in one burst. */
  MAIL_CAMPAIGN_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  /** Seconds a worker holds a claimed row before it is considered abandoned. */
  MAIL_LOCK_LEASE_SECONDS: z.coerce.number().int().positive().default(300),

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

  /* ------------------------------- UPI ---------------------------------- */

  /**
   * The VPA customers pay. Set this to the collection account's UPI id. Leaving
   * it empty disables UPI checkout without affecting any other provider.
   */
  UPI_PAYEE_VPA: z.string().optional(),
  /** Payee name shown in the payer's UPI app. */
  UPI_PAYEE_NAME: z.string().default('ExamDump'),
  /** How long a customer has to pay before the order expires. */
  UPI_ORDER_TTL_MINUTES: z.coerce.number().int().min(3).max(120).default(15),
  /**
   * Auto-approve a payment from a bank notification. Off by default: turning it
   * on is a deliberate operational decision because a notification is evidence
   * of a bank alert, not proof of settlement.
   */
  UPI_AUTO_APPROVE: booleanString,
  /**
   * Largest single credit we will consider. Anything above is rejected outright
   * rather than becoming a candidate, which bounds the damage of a spoofed alert.
   */
  UPI_NOTIFICATION_MAX_PAISE: z.coerce.number().int().positive().default(50_000_000),
  /** How often the Gmail observer polls, in seconds. Zero disables it. */
  UPI_GMAIL_POLL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  /** Dedicated mailbox that only receives bank alerts. */
  UPI_GMAIL_USER: z.string().optional(),
  /** OAuth client for the payment-notification mailbox (least privilege). */
  UPI_GOOGLE_CLIENT_ID: z.string().optional(),
  UPI_GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Long-lived refresh token for that mailbox, read-only Gmail access. */
  UPI_GOOGLE_REFRESH_TOKEN: z.string().optional(),
  /**
   * Base64 of 32 random bytes, used to encrypt dashboard-entered credentials
   * (Gmail client secret and refresh token) at rest. Generate with:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   *
   * Deliberately NOT editable from the dashboard: a key the application can read
   * on request is not protection against that application being compromised.
   * Without it, dashboard credential entry is disabled and only the environment
   * fallback works.
   */
  UPI_SECRETS_KEY: z.string().optional(),
  /**
   * Exact redirect URI registered on the Google OAuth client. Used both by the
   * CLI handshake and by the dashboard Connect flow.
   */
  UPI_OAUTH_REDIRECT_URI: z.string().optional(),
  /**
   * Shared secret for the SMS-observer bridge. The bridge signs each forwarded
   * message with this, so the endpoint is useless to anyone without it.
   */
  UPI_SMS_INGEST_SECRET: z.string().optional(),
  /** Optional label used in IMAP/Gmail search to narrow the mailbox. */
  UPI_GMAIL_LABEL: z.string().default('INBOX'),
  /**
   * Gmail search expression selecting bank alerts.
   *
   * Defaults to the whole mailbox, deliberately. The observer holds only
   * `gmail.readonly` and never marks mail read, so `is:unread` degenerates into
   * "all mail ever" and — because results come oldest-page-first — silently drops
   * every new payment once the mailbox holds more than one page of alerts. Add a
   * `newer_than:` bound if polling cost matters; re-ingestion is deduplicated, so
   * a wide query is safe. Any `is:unread` / `-is:read` term is stripped at runtime.
   */
  UPI_GMAIL_QUERY: z.string().default('in:anywhere'),
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