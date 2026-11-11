/**
 * ExamDump Mail — transactional email service.
 *
 * Wraps nodemailer with the parts a bare transport does not give you:
 *
 *  - STARTTLS on port 587 (Gmail), optional implicit TLS on 465.
 *  - Bounded retries with exponential backoff for transient failures
 *    (connection refused/reset, 4xx greylisting, timeouts). Permanent failures
 *    (auth rejected, invalid recipient) are not retried - retrying a bad App
 *    Password just locks the account faster.
 *  - A per-recipient sliding-window rate limit so a retry loop or a
 *    compromised account cannot be used to blast a mailbox.
 *  - A delivery log row per attempt (`mail_logs`) for support and audit.
 *  - A hard degrade path: if mail is not configured or sending fails, the
 *    caller still gets a usable result and the user flow is never blocked.
 *
 * Credentials live only in the environment (Doppler). Nothing here is ever
 * serialised into an API response or sent to the frontend.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { mailLogs } from '../../db/schema/index.js';
import { renderMail, type MailTemplateName, type TemplateData } from './render.js';
import type { BrandContext } from './templates.js';

export interface MailLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface SendMailOptions {
  to: string;
  template: MailTemplateName;
  data: TemplateData;
  userId?: string | null;
  /** Correlation id (payment id, token id) written to the log. */
  referenceId?: string | null;
  logger?: MailLogger;
  /**
   * Skip the per-recipient rate limit. Reserved for admin-triggered sends such
   * as a configuration test, never for user-driven flows.
   */
  bypassRateLimit?: boolean;
}

export interface SendMailResult {
  delivered: boolean;
  /** True when mail is intentionally off (no SMTP, disabled, rate limited). */
  suppressed: boolean;
  attempts: number;
  messageId?: string;
  error?: string;
}

/* ------------------------------ transport ------------------------------ */

let cachedTransport: { key: string; transporter: Transporter } | null = null;

/** Cache key covers every setting that changes the connection. */
function transportKey(env: Env): string {
  return [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_SECURE, env.SMTP_USER].join('|');
}

export function mailConfigured(env: Env): boolean {
  return Boolean(env.MAIL_ENABLED && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function getTransporter(env: Env): Transporter | null {
  if (!mailConfigured(env)) return null;
  const key = transportKey(env);
  if (cachedTransport?.key === key) return cachedTransport.transporter;

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    /**
     * Port 587 uses STARTTLS: connect in plaintext, then upgrade. Nodemailer
     * expects `secure: false` for that; `requireTLS` makes it refuse to
     * continue if the upgrade is not offered, so credentials are never sent
     * over an unencrypted link.
     */
    secure: env.SMTP_SECURE,
    requireTLS: !env.SMTP_SECURE,
    auth: { user: env.SMTP_USER as string, pass: env.SMTP_PASS as string },
    connectionTimeout: env.MAIL_TIMEOUT_MS,
    greetingTimeout: env.MAIL_TIMEOUT_MS,
    socketTimeout: env.MAIL_TIMEOUT_MS,
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    // Gmail adds its own Message-ID; let nodemailer generate ours.
    tls: { minVersion: 'TLSv1.2' },
  });
  cachedTransport = { key, transporter };
  return transporter;
}

/** Exposed for tests and for an explicit startup health check. */
export async function verifyMailer(env: Env): Promise<{ ok: boolean; error?: string }> {
  const tx = getTransporter(env);
  if (!tx) return { ok: false, error: 'mail_not_configured' };
  try {
    await tx.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 300) };
  }
}

/** Test hook: forget the pooled connection after env changes. */
export function resetMailTransport(): void {
  cachedTransport?.transporter.close();
  cachedTransport = null;
}

/* ------------------------------ rate limit ------------------------------ */

/**
 * In-process sliding window, keyed by recipient address.
 *
 * Deliberately per-process. The API runs as a single container here, and a
 * shared store would add infrastructure for no real benefit at this stage. If
 * the API is ever scaled out, move this to Redis - the interface is one
 * function, so that swap is local.
 */
const rateBuckets = new Map<string, number[]>();

export function checkMailRateLimit(
  env: Env,
  recipient: string,
): { allowed: boolean; retryAfterMs: number } {
  const key = recipient.toLowerCase();
  const now = Date.now();
  const windowMs = env.MAIL_RATE_WINDOW_MS;
  const max = env.MAIL_RATE_MAX;

  const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const oldest = hits[0] ?? now;
    rateBuckets.set(key, hits);
    return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
  }
  hits.push(now);
  rateBuckets.set(key, hits);

  // Opportunistic cleanup so the map cannot grow without bound.
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (v.every((t) => now - t >= windowMs)) rateBuckets.delete(k);
    }
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** Test hook. */
export function resetMailRateLimits(): void {
  rateBuckets.clear();
}

/* ------------------------------ retries ------------------------------ */

/** Transient conditions worth retrying. Anything else fails fast. */
export function isRetryableMailError(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const retryableCodes = new Set([
    'ECONNECTION',
    'ECONNRESET',
    'ETIMEDOUT',
    'ESOCKET',
    'EDNS',
    'ECONNREFUSED',
    'EPIPE',
    'EAI_AGAIN',
  ]);
  if (e?.code && retryableCodes.has(e.code)) return true;
  // SMTP 4xx are temporary by definition; 5xx are permanent.
  if (typeof e?.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500;
  if (/timeout|timed out/i.test(e?.message ?? '')) return true;
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ------------------------------ logging ------------------------------ */

async function writeLog(row: {
  userId?: string | null;
  template: MailTemplateName;
  recipient: string;
  subject: string;
  status: 'sent' | 'failed' | 'suppressed';
  attempts: number;
  messageId?: string;
  lastError?: string;
  referenceId?: string | null;
  metadata?: Record<string, unknown>;
  sentAt?: Date | null;
}): Promise<void> {
  try {
    await getDb().insert(mailLogs).values({
      userId: row.userId ?? null,
      template: row.template,
      recipient: row.recipient.toLowerCase(),
      subject: row.subject.slice(0, 300),
      status: row.status,
      attempts: row.attempts,
      messageId: row.messageId ?? null,
      lastError: row.lastError?.slice(0, 500) ?? null,
      referenceId: row.referenceId ?? null,
      metadata: row.metadata ?? {},
      sentAt: row.sentAt ?? null,
    });
  } catch {
    // Logging must never break delivery or the caller's flow.
  }
}

/* ------------------------------ public API ------------------------------ */

export function brandContext(env: Env): BrandContext {
  // Fall back to the official mailbox whenever the SMTP identity is unset, so
  // an email never renders a blank Reply-To / support address.
  const support =
    (env.MAIL_REPLY_TO && env.MAIL_REPLY_TO.trim()) ||
    (env.SMTP_USER && env.SMTP_USER.trim()) ||
    'examdump.official@gmail.com';

  return {
    webUrl: (env.MAIL_PUBLIC_URL ?? env.PUBLIC_WEB_URL).replace(/\/+$/, ''),
    supportEmail: support,
    productName: 'ExamDump',
  };
}

/**
 * Send one templated transactional email.
 *
 * Never throws. Callers branch on `delivered` when they need to know whether a
 * link reached the user (e.g. to expose a dev-only verification URL).
 */
export async function sendTransactionalMail(env: Env, options: SendMailOptions): Promise<SendMailResult> {
  const recipient = options.to.trim().toLowerCase();
  const brand = brandContext(env);
  const content = renderMail(options.template, brand, options.data, env);

  if (!recipient || !recipient.includes('@')) {
    await writeLog({
      userId: options.userId,
      template: options.template,
      recipient: recipient || '(invalid)',
      subject: content.subject,
      status: 'failed',
      attempts: 0,
      lastError: 'invalid_recipient',
      referenceId: options.referenceId,
    });
    return { delivered: false, suppressed: false, attempts: 0, error: 'invalid_recipient' };
  }

  // Mail switched off or credentials missing: log once and move on.
  if (!mailConfigured(env)) {
    options.logger?.info(
      { to: recipient, template: options.template, subject: content.subject },
      'mail.suppressed_not_configured',
    );
    await writeLog({
      userId: options.userId,
      template: options.template,
      recipient,
      subject: content.subject,
      status: 'suppressed',
      attempts: 0,
      lastError: 'smtp_not_configured',
      referenceId: options.referenceId,
    });
    return { delivered: false, suppressed: true, attempts: 0, error: 'smtp_not_configured' };
  }

  if (!options.bypassRateLimit) {
    const limit = checkMailRateLimit(env, recipient);
    if (!limit.allowed) {
      options.logger?.warn(
        { to: recipient, template: options.template, retryAfterMs: limit.retryAfterMs },
        'mail.suppressed_rate_limited',
      );
      await writeLog({
        userId: options.userId,
        template: options.template,
        recipient,
        subject: content.subject,
        status: 'suppressed',
        attempts: 0,
        lastError: `rate_limited_${Math.ceil(limit.retryAfterMs / 1000)}s`,
        referenceId: options.referenceId,
      });
      return { delivered: false, suppressed: true, attempts: 0, error: 'rate_limited' };
    }
  }

  const transporter = getTransporter(env);
  if (!transporter) {
    return { delivered: false, suppressed: true, attempts: 0, error: 'smtp_not_configured' };
  }

  const from = env.MAIL_FROM;
  const replyTo = env.MAIL_REPLY_TO ?? undefined;
  let lastError = '';
  let attempts = 0;

  for (let attempt = 1; attempt <= env.MAIL_MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const info = await transporter.sendMail({
        from,
        to: recipient,
        replyTo,
        subject: content.subject,
        text: content.text,
        html: content.html,
        headers: {
          ...(options.referenceId ? { 'X-Entity-Ref-ID': options.referenceId } : {}),
          'Auto-Submitted': 'auto-generated',
        },
      });
      const messageId = typeof info.messageId === 'string' ? info.messageId : undefined;
      options.logger?.info(
        { to: recipient, template: options.template, attempts, messageId },
        'mail.sent',
      );
      await writeLog({
        userId: options.userId,
        template: options.template,
        recipient,
        subject: content.subject,
        status: 'sent',
        attempts,
        messageId,
        referenceId: options.referenceId,
        sentAt: new Date(),
      });
      return { delivered: true, suppressed: false, attempts, messageId };
    } catch (err) {
      lastError = (err as Error).message.slice(0, 500);
      const retryable = isRetryableMailError(err);
      options.logger?.warn(
        { to: recipient, template: options.template, attempt, retryable, error: lastError },
        retryable ? 'mail.attempt_failed_will_retry' : 'mail.attempt_failed_permanent',
      );
      if (!retryable || attempt >= env.MAIL_MAX_ATTEMPTS) break;
      // Exponential backoff with a little jitter to avoid thundering herds.
      const backoff = env.MAIL_RETRY_BASE_MS * 2 ** (attempt - 1);
      await sleep(backoff + Math.floor(Math.random() * 100));
    }
  }

  await writeLog({
    userId: options.userId,
    template: options.template,
    recipient,
    subject: content.subject,
    status: 'failed',
    attempts,
    lastError,
    referenceId: options.referenceId,
  });
  return { delivered: false, suppressed: false, attempts, error: lastError };
}

/* -------------------------- raw (queued) delivery -------------------------- */

export interface RawMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Inbox-visible headers for unsubscribe (marketing only). */
  headers?: Record<string, string>;
  userId?: string | null;
  template: string;
  referenceId?: string | null;
  logger?: MailLogger;
}

export interface RawMailResult {
  delivered: boolean;
  suppressed: boolean;
  retryable: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Deliver an already-rendered message.
 *
 * This is the single send path used by the durable queue. It deliberately keeps
 * the same transport, per-recipient rate limit and `mail_logs` auditing as
 * `sendTransactionalMail`, but takes final subject/html/text instead of a
 * template name, because a queued row must send exactly what was enqueued.
 *
 * Errors are classified: `retryable` means the queue should back off and try
 * again; otherwise the message is dead-lettered for inspection.
 */
export async function deliverRaw(env: Env, input: RawMailInput): Promise<RawMailResult> {
  const recipient = input.to.trim().toLowerCase();

  if (!recipient || !recipient.includes('@')) {
    await writeLog({
      userId: input.userId,
      template: input.template as MailTemplateName,
      recipient: recipient || '(invalid)',
      subject: input.subject,
      status: 'failed',
      attempts: 0,
      lastError: 'invalid_recipient',
      referenceId: input.referenceId,
    });
    return { delivered: false, suppressed: false, retryable: false, error: 'invalid_recipient' };
  }

  if (!mailConfigured(env)) {
    input.logger?.info({ to: recipient, template: input.template }, 'mail.suppressed_not_configured');
    await writeLog({
      userId: input.userId,
      template: input.template as MailTemplateName,
      recipient,
      subject: input.subject,
      status: 'suppressed',
      attempts: 0,
      lastError: 'smtp_not_configured',
      referenceId: input.referenceId,
    });
    return { delivered: false, suppressed: true, retryable: false, error: 'smtp_not_configured' };
  }

  const limit = checkMailRateLimit(env, recipient);
  if (!limit.allowed) {
    // A per-recipient limit is temporary by definition: let the queue retry.
    return {
      delivered: false,
      suppressed: false,
      retryable: true,
      error: `rate_limited_${Math.ceil(limit.retryAfterMs / 1000)}s`,
    };
  }

  const transporter = getTransporter(env);
  if (!transporter) {
    return { delivered: false, suppressed: true, retryable: false, error: 'smtp_not_configured' };
  }

  try {
    const info = await transporter.sendMail({
      from: env.MAIL_FROM,
      to: recipient,
      replyTo: env.MAIL_REPLY_TO ?? undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: input.headers,
    });
    const messageId = info.messageId ?? undefined;
    await writeLog({
      userId: input.userId,
      template: input.template as MailTemplateName,
      recipient,
      subject: input.subject,
      status: 'sent',
      attempts: 1,
      messageId,
      referenceId: input.referenceId,
    });
    input.logger?.info({ to: recipient, template: input.template, messageId }, 'mail.sent');
    return { delivered: true, suppressed: false, retryable: false, messageId };
  } catch (err) {
    const message = (err as Error).message?.slice(0, 500) || 'unknown_error';
    const retryable = isRetryableMailError(err);
    await writeLog({
      userId: input.userId,
      template: input.template as MailTemplateName,
      recipient,
      subject: input.subject,
      status: 'failed',
      attempts: 1,
      lastError: message,
      referenceId: input.referenceId,
    });
    input.logger?.warn({ to: recipient, template: input.template, retryable, err: message }, 'mail.failed');
    return { delivered: false, suppressed: false, retryable, error: message };
  }
}
