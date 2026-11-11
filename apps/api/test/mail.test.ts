import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, type Env } from '../src/config/env.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { getDb } from '../src/db/client.js';
import { emailQueue, mailLogs, users } from '../src/db/schema/index.js';
import { desc, eq, sql } from 'drizzle-orm';
import {
  brandContext,
  checkMailRateLimit,
  isRetryableMailError,
  mailConfigured,
  resetMailRateLimits,
  sendTransactionalMail,
} from '../src/services/mail/mail.service.js';
import { renderMail } from '../src/services/mail/render.js';
import { escapeHtml } from '../src/services/mail/templates.js';

let ctx: TestContext;

/** Env with mail switched off: exercises the suppressed path. */
function envWithoutMail(): Env {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@127.0.0.1:5433/examdump_test',
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
    PASSWORD_PEPPER: 'test-pepper',
    PUBLIC_WEB_URL: 'http://localhost:3100',
    MAIL_ENABLED: 'false',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    LOG_LEVEL: 'silent',
  });
}

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

beforeEach(() => {
  resetMailRateLimits();
});

describe('mail configuration detection', () => {
  it('reports unconfigured when any credential is missing', () => {
    const env = envWithoutMail();
    expect(mailConfigured(env)).toBe(false);

    const partial = loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@127.0.0.1:5433/examdump_test',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
      JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
      PASSWORD_PEPPER: 'test-pepper',
      MAIL_ENABLED: 'true',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'examdump.official@gmail.com',
      // password deliberately absent
      SMTP_PASS: '',
      LOG_LEVEL: 'silent',
    });
    expect(mailConfigured(partial)).toBe(false);
  });

  it('treats port 587 as STARTTLS, not implicit TLS', () => {
    const env = envWithoutMail();
    expect(env.SMTP_PORT).toBe(587);
    // STARTTLS requires secure:false so nodemailer upgrades the connection.
    expect(env.SMTP_SECURE).toBe(false);
  });

  it('derives the sender identity and support address', () => {
    const env = envWithoutMail();
    const brand = brandContext(env);
    expect(brand.supportEmail).toContain('@');
    expect(brand.webUrl.startsWith('http')).toBe(true);
  });
});

describe('mail retry classification', () => {
  it('retries transient connection failures', () => {
    expect(isRetryableMailError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableMailError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryableMailError({ responseCode: 451 })).toBe(true);
    expect(isRetryableMailError(new Error('socket timed out'))).toBe(true);
  });

  it('does not retry permanent auth or recipient failures', () => {
    // A wrong App Password must fail fast; retrying locks the Google account.
    expect(isRetryableMailError({ responseCode: 535 })).toBe(false);
    expect(isRetryableMailError({ responseCode: 550 })).toBe(false);
    expect(isRetryableMailError({ code: 'EAUTH' })).toBe(false);
  });
});

describe('mail rate limiting', () => {
  it('blocks a recipient after the configured window limit', () => {
    const env = envWithoutMail();
    const recipient = 'burst@test.local';
    let allowed = 0;
    for (let i = 0; i < env.MAIL_RATE_MAX; i += 1) {
      if (checkMailRateLimit(env, recipient).allowed) allowed += 1;
    }
    expect(allowed).toBe(env.MAIL_RATE_MAX);

    const blocked = checkMailRateLimit(env, recipient);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('keys the limit per recipient', () => {
    const env = envWithoutMail();
    for (let i = 0; i < env.MAIL_RATE_MAX; i += 1) checkMailRateLimit(env, 'one@test.local');
    expect(checkMailRateLimit(env, 'one@test.local').allowed).toBe(false);
    expect(checkMailRateLimit(env, 'two@test.local').allowed).toBe(true);
  });
});

describe('mail templates', () => {
  const brand = { webUrl: 'https://example.test', supportEmail: 'examdump.official@gmail.com', productName: 'ExamDump' };
  const env = envWithoutMail();

  it('escapes user-controlled values in HTML', () => {
    const rendered = renderMail(
      'email_verify',
      brand,
      { name: '<script>alert(1)</script>', verifyUrl: 'https://example.test/v?token=abc' },
      env,
    );
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.text).toContain('<script>');
  });

  it('builds a verification email with a usable link and plain-text fallback', () => {
    const rendered = renderMail(
      'email_verify',
      brand,
      { name: 'Asha', verifyUrl: 'https://example.test/verify-email?token=tok_123' },
      env,
    );
    expect(rendered.subject).toMatch(/verify/i);
    expect(rendered.html).toContain('https://example.test/verify-email?token=tok_123');
    expect(rendered.text).toContain('https://example.test/verify-email?token=tok_123');
    // Inbox clients strip <style>; everything must be inline.
    expect(rendered.html).not.toMatch(/<style[\s>]/);
  });

  it('renders a receipt with amount, plan and invoice number', () => {
    const rendered = renderMail(
      'payment_receipt',
      brand,
      {
        name: 'Asha',
        invoiceNumber: 'ED-0001',
        amount: '₹499',
        planName: 'Pro Monthly',
        paidAt: '1 Jan 2026',
        invoiceUrl: 'https://example.test/invoices/1',
      },
      env,
    );
    expect(rendered.subject).toContain('ED-0001');
    expect(rendered.html).toContain('₹499');
    expect(rendered.text).toContain('Pro Monthly');
    expect(rendered.html).toContain('https://example.test/invoices/1');
  });

  it('maps each subscription notice to its own wording', () => {
    const base = { planName: 'Pro Monthly', dateValue: '1 Feb 2026' };
    const activated = renderMail('subscription_activated', brand, base, env);
    const cancelled = renderMail('subscription_cancelled', brand, base, env);
    expect(activated.subject).not.toBe(cancelled.subject);
    expect(cancelled.text.toLowerCase()).toContain('cancelled');
  });

  it('throws on a required field instead of sending a broken email', () => {
    expect(() => renderMail('password_reset', brand, {}, env)).toThrow(/resetUrl/);
  });

  it('escapeHtml handles the full dangerous set', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('mail delivery logging', () => {
  it('records a suppressed row when SMTP is not configured', async () => {
    const env = envWithoutMail();
    const db = getDb();
    const [user] = await db.select().from(users).limit(1);
    const recipient = `suppressed_${Date.now()}@test.local`;

    const result = await sendTransactionalMail(env, {
      to: recipient,
      template: 'welcome',
      userId: user?.id,
      data: { name: 'Test', examsUrl: 'https://example.test/exams' },
    });

    expect(result.delivered).toBe(false);
    expect(result.suppressed).toBe(true);

    const [row] = await db
      .select()
      .from(mailLogs)
      .where(eq(mailLogs.recipient, recipient))
      .orderBy(desc(mailLogs.createdAt))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row?.status).toBe('suppressed');
    expect(row?.template).toBe('welcome');
    expect(row?.lastError).toBe('smtp_not_configured');
  });

  it('records a rate-limited send as suppressed, not failed', async () => {
    const env = envWithoutMail();
    const recipient = `burst_${Date.now()}@test.local`;
    // Exhaust the window, then make the adapter appear configured so the send
    // reaches the rate-limit branch. Without real SMTP it would otherwise be
    // suppressed for a different reason.
    const rateEnv = loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@127.0.0.1:5433/examdump_test',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
      JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
      PASSWORD_PEPPER: 'test-pepper',
      MAIL_ENABLED: 'true',
      SMTP_HOST: 'smtp.invalid',
      SMTP_USER: 'examdump.official@gmail.com',
      SMTP_PASS: 'dummy-app-password',
      MAIL_RATE_MAX: '1',
      MAIL_MAX_ATTEMPTS: '1',
      MAIL_TIMEOUT_MS: '150',
      LOG_LEVEL: 'silent',
    });
    expect(checkMailRateLimit(rateEnv, recipient).allowed).toBe(true);
    const result = await sendTransactionalMail(rateEnv, {
      to: recipient,
      template: 'welcome',
      data: { name: 'Burst' },
    });
    expect(result.suppressed).toBe(true);
    expect(result.error).toBe('rate_limited');
    // The first (allowed) attempt is what actually hits SMTP; either way no
    // 'sent' row may exist for an unreachable host.
    const db = getDb();
    const rows = await db.select().from(mailLogs).where(eq(mailLogs.recipient, recipient));
    expect(rows.some((r) => r.status === 'sent')).toBe(false);
    void env;
  });

  it('rejects an invalid recipient without calling SMTP', async () => {
    const env = envWithoutMail();
    const result = await sendTransactionalMail(env, {
      to: 'not-an-email',
      template: 'welcome',
      data: { name: 'Bad' },
    });
    expect(result.delivered).toBe(false);
    expect(result.suppressed).toBe(false);
    expect(result.error).toBe('invalid_recipient');
  });
});

describe('auth flows queue mail', () => {
  it('registers and queues a verification email', async () => {
    const db = getDb();
    const email = `mailreg_${Date.now()}@test.local`;
    const register = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Mail Flow', email, password: 'Str0ngPass', acceptTerms: true },
    });
    expect(register.statusCode).toBe(201);

    // Mail is now queued rather than sent inline, so the assertion lives on the
    // queue: the message is durable and will be attempted by the worker.
    const [row] = await db
      .select()
      .from(emailQueue)
      .where(eq(emailQueue.recipient, email.toLowerCase()))
      .orderBy(desc(emailQueue.createdAt))
      .limit(1);
    expect(row?.template).toBe('email_verify');
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
  });

  it('sends a password reset attempt for an existing user', async () => {
    const db = getDb();
    const email = `mailreset_${Date.now()}@test.local`;
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Reset Flow', email, password: 'Str0ngPass', acceptTerms: true },
    });
    const forgot = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email },
    });
    expect([200, 201, 202, 204]).toContain(forgot.statusCode);

    const [row] = await db
      .select()
      .from(emailQueue)
      .where(sql`${emailQueue.recipient} = ${email.toLowerCase()} and ${emailQueue.template} = 'password_reset'`)
      .limit(1);
    expect(row?.template).toBe('password_reset');
    expect(row?.status).toBe('queued');
  });
});
