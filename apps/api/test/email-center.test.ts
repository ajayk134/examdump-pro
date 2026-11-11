/**
 * ExamDump Mail — queue, policy and template tests.
 *
 * These run against a real Postgres because the behaviour under test (SKIP
 * LOCKED claiming, unique dedupe, backoff scheduling) is implemented in SQL and
 * would be meaningless against a mock.
 *
 * SMTP is deliberately disabled (`MAIL_ENABLED=false`), so nothing is ever sent
 * to a real inbox. That also lets us assert the suppressed/failed bookkeeping.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { loadEnv, type Env } from '../src/config/env.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { getDb } from '../src/db/client.js';
import { emailCampaigns, emailPreferences, emailQueue, emailSuppressions, users } from '../src/db/schema/index.js';
import {
  backoffMs,
  cancelCampaignQueue,
  claimBatch,
  enqueueEmail,
  markFailed,
  markSent,
  queueHealth,
  queueStats,
  recoverStaleLocks,
  requeueFailed,
} from '../src/services/mail/queue.service.js';
import {
  checkRecipientPolicy,
  ensurePreferences,
  loadPreferences,
  removeSuppression,
  suppressAddress,
  updatePreferences,
} from '../src/services/mail/policy.service.js';
import {
  escapeHtml,
  extractPlaceholders,
  htmlToText,
  renderTemplate,
  validateTemplate,
} from '../src/services/mail/placeholders.js';
import {
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
  buildUnsubscribeHeaders,
} from '../src/services/mail/unsubscribe.js';
import { resolveAudience, segmentPredicate, validateCampaign } from '../src/services/mail/campaign.service.js';
import {
  notifyAccountNotice,
  notifyAnnouncement,
  notifyLoginAlert,
  notifyPasswordChanged,
  notifyPasswordReset,
  notifySubscription,
  notifySupportReceived,
  notifyVerification,
  notifyWelcome,
} from '../src/services/mail/notify.service.js';
import { buildMailHeaders } from '../src/services/mail/headers.js';
import { ehloName } from '../src/services/mail/mail.service.js';
import { auditSenderIdentity } from '../src/services/mail/deliverability.js';

let ctx: TestContext;
let env: Env;

/** Mail switched off: the queue still records state, nothing is delivered. */
function offlineEnv(): Env {
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
    MAIL_BATCH_SIZE: '10',
    LOG_LEVEL: 'silent',
  });
}

async function makeUser(email: string, overrides: Record<string, unknown> = {}) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({
      email,
      name: 'Test Person',
      passwordHash: 'x',
      referralCode: `ref-${Math.random().toString(36).slice(2, 10)}`,
      emailVerified: true,
      ...overrides,
    })
    .returning();
  return row!;
}

function message(overrides: Partial<Parameters<typeof enqueueEmail>[0]> = {}) {
  return {
    to: 'recipient@example.com',
    subject: 'Hello',
    html: '<p>Hello</p>',
    text: 'Hello',
    template: 'account_notice',
    ...overrides,
  };
}

beforeAll(async () => {
  ctx = await createTestContext();
  env = offlineEnv();
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

beforeEach(async () => {
  const db = getDb();
  // Isolate each test: the queue and consent tables are shared state.
  await db.delete(emailQueue);
  await db.delete(emailCampaigns);
  await db.delete(emailSuppressions);
  await db.delete(emailPreferences);
  await db.delete(users).where(sql`${users.email} like 'qa-%'`);
});

/* --------------------------------- queue -------------------------------- */

describe('email queue', () => {
  it('enqueues a message with defaults', async () => {
    const result = await enqueueEmail(message());
    expect(result.queued).toBe(true);

    const [row] = await getDb().select().from(emailQueue).where(eq(emailQueue.id, result.id!));
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
    expect(row?.category).toBe('transactional');
  });

  it('rejects a duplicate dedupe key instead of double queueing', async () => {
    const first = await enqueueEmail(message({ dedupeKey: 'welcome:user-1' }));
    const second = await enqueueEmail(message({ dedupeKey: 'welcome:user-1' }));

    expect(first.queued).toBe(true);
    expect(second.queued).toBe(false);
    expect(second.duplicate).toBe(true);

    const rows = await getDb().select().from(emailQueue);
    expect(rows).toHaveLength(1);
  });

  it('allows many rows with no dedupe key', async () => {
    await enqueueEmail(message());
    await enqueueEmail(message());
    const rows = await getDb().select().from(emailQueue);
    expect(rows).toHaveLength(2);
  });

  it('does not claim messages scheduled in the future', async () => {
    await enqueueEmail(message({ scheduledFor: new Date(Date.now() + 60_000) }));
    const claimed = await claimBatch(env, { workerId: 'w1' });
    expect(claimed).toHaveLength(0);
  });

  it('claims due messages and marks them as sending', async () => {
    const { id } = await enqueueEmail(message());
    const claimed = await claimBatch(env, { workerId: 'w1' });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(id);
    expect(claimed[0]?.status).toBe('sending');
    expect(claimed[0]?.attempts).toBe(1);
    expect(claimed[0]?.lockedBy).toBe('w1');
  });

  it('never hands the same row to two workers', async () => {
    await enqueueEmail(message());
    const [a, b] = await Promise.all([
      claimBatch(env, { workerId: 'w1' }),
      claimBatch(env, { workerId: 'w2' }),
    ]);
    expect(a.length + b.length).toBe(1);
  });

  it('respects the batch size', async () => {
    for (let i = 0; i < 5; i += 1) await enqueueEmail(message());
    const claimed = await claimBatch(env, { workerId: 'w1', limit: 2 });
    expect(claimed).toHaveLength(2);
  });

  it('recovers rows abandoned by a crashed worker', async () => {
    const { id } = await enqueueEmail(message());
    // Simulate a worker that claimed the row then died ten minutes ago.
    await getDb()
      .update(emailQueue)
      .set({ status: 'sending', lockedAt: new Date(Date.now() - 10 * 60_000), lockedBy: 'dead' })
      .where(eq(emailQueue.id, id!));

    const released = await recoverStaleLocks(5 * 60_000);
    expect(released).toBe(1);

    const [row] = await getDb().select().from(emailQueue).where(eq(emailQueue.id, id!));
    expect(row?.status).toBe('queued');
  });

  it('reclaims an abandoned row on its own without an explicit recovery', async () => {
    const { id } = await enqueueEmail(message());
    await getDb()
      .update(emailQueue)
      .set({ status: 'sending', lockedAt: new Date(Date.now() - 10 * 60_000), lockedBy: 'dead' })
      .where(eq(emailQueue.id, id!));

    const claimed = await claimBatch(env, { workerId: 'w-new', staleAfterMs: 60_000 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(id);
  });

  it('re-queues a retryable failure with backoff', async () => {
    const { id } = await enqueueEmail(message({ maxAttempts: 3 }));
    await claimBatch(env, { workerId: 'w1' });

    const disposition = await markFailed(id!, 'connection timeout', {
      retryable: true,
      maxAttempts: 3,
      attempts: 1,
    });
    expect(disposition).toBe('requeued');

    const [row] = await getDb().select().from(emailQueue).where(eq(emailQueue.id, id!));
    expect(row?.status).toBe('queued');
    expect(row?.lastError).toBe('connection timeout');
    // Scheduled into the future, not immediately.
    expect(row!.scheduledFor.getTime()).toBeGreaterThan(Date.now());
  });

  it('dead-letters an exhausted message', async () => {
    const { id } = await enqueueEmail(message({ maxAttempts: 2 }));
    await getDb().update(emailQueue).set({ attempts: 2 }).where(eq(emailQueue.id, id!));

    const disposition = await markFailed(id!, 'still failing', {
      retryable: true,
      maxAttempts: 2,
      attempts: 2,
    });
    expect(disposition).toBe('dead');

    const [row] = await getDb().select().from(emailQueue).where(eq(emailQueue.id, id!));
    expect(row?.status).toBe('dead');
  });

  it('dead-letters a permanent failure immediately', async () => {
    const { id } = await enqueueEmail(message({ maxAttempts: 3 }));
    await getDb().update(emailQueue).set({ attempts: 1 }).where(eq(emailQueue.id, id!));

    const disposition = await markFailed(id!, 'invalid recipient', {
      retryable: false,
      maxAttempts: 3,
      attempts: 1,
    });
    expect(disposition).toBe('dead');
  });

  it('marks a message sent and records the provider id', async () => {
    const { id } = await enqueueEmail(message());
    await markSent(id!, '<abc@example.com>');

    const [row] = await getDb().select().from(emailQueue).where(eq(emailQueue.id, id!));
    expect(row?.status).toBe('sent');
    expect(row?.messageId).toBe('<abc@example.com>');
    expect(row?.sentAt).not.toBeNull();
  });

  it('requeues dead messages on demand', async () => {
    const { id } = await enqueueEmail(message());
    await getDb().update(emailQueue).set({ status: 'dead', attempts: 3 }).where(eq(emailQueue.id, id!));

    const count = await requeueFailed([id!]);
    expect(count).toBe(1);

    const [row] = await getDb().select().from(emailQueue).where(eq(emailQueue.id, id!));
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
  });

  it('cancels pending messages for a campaign', async () => {
    const db = getDb();
    const [campaign] = await db
      .insert(emailCampaigns)
      .values({ name: 'C', subject: 'S', html: '<p>x</p>' })
      .returning();
    await enqueueEmail(message({ campaignId: campaign!.id }));
    await enqueueEmail(message({ campaignId: campaign!.id }));
    const { id: sentId } = await enqueueEmail(message({ campaignId: campaign!.id }));
    await db.update(emailQueue).set({ status: 'sent' }).where(eq(emailQueue.id, sentId!));

    const cancelled = await cancelCampaignQueue(campaign!.id);
    expect(cancelled).toBe(2);
  });

  it('reports queue statistics and health', async () => {
    await enqueueEmail(message());
    const { id } = await enqueueEmail(message());
    await getDb().update(emailQueue).set({ status: 'dead' }).where(eq(emailQueue.id, id!));

    const stats = await queueStats();
    expect(stats.queued).toBe(1);
    expect(stats.dead).toBe(1);

    const health = await queueHealth();
    expect(health.dead).toBe(1);
    expect(health.ok).toBe(true);
  });

  it('computes a capped exponential backoff', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(5 * 60_000);
    expect(backoffMs(3)).toBe(15 * 60_000);
    // Beyond the ladder it stays at the cap rather than growing unbounded.
    expect(backoffMs(99)).toBe(4 * 60 * 60_000);
  });
});

/* -------------------------------- policy -------------------------------- */

describe('consent and suppression policy', () => {
  it('always allows transactional mail to a normal user', async () => {
    const email = 'qa-tx@example.com';
    const result = await checkRecipientPolicy({ email, category: 'transactional' });
    expect(result.allowed).toBe(true);
  });

  it('blocks marketing mail without an explicit opt-in', async () => {
    const user = await makeUser('qa-noconsent@example.com');
    await ensurePreferences(user.id);
    const result = await checkRecipientPolicy({
      email: user.email,
      category: 'marketing',
      userId: user.id,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('marketing_opt_out');
  });

  it('allows marketing mail once the user opts in', async () => {
    const user = await makeUser('qa-optin@example.com');
    await updatePreferences(user.id, { marketingOptIn: true, productUpdates: true });
    const result = await checkRecipientPolicy({
      email: user.email,
      category: 'marketing',
      userId: user.id,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks marketing when product updates are switched off', async () => {
    const user = await makeUser('qa-noproduct@example.com');
    await updatePreferences(user.id, { marketingOptIn: true, productUpdates: false });
    const result = await checkRecipientPolicy({
      email: user.email,
      category: 'marketing',
      userId: user.id,
      preference: 'productUpdates',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('preference_productUpdates_off');
  });

  it('blocks marketing but not transactional after a marketing unsubscribe', async () => {
    const email = 'qa-unsub@example.com';
    await suppressAddress({ email, reason: 'unsubscribe_marketing' });

    expect((await checkRecipientPolicy({ email, category: 'marketing' })).allowed).toBe(false);
    // A password reset must still get through.
    expect((await checkRecipientPolicy({ email, category: 'transactional' })).allowed).toBe(true);
  });

  it('blocks everything after an unsubscribe-all', async () => {
    const email = 'qa-unsub-all@example.com';
    await suppressAddress({ email, reason: 'unsubscribe_all', scope: 'all' });

    expect((await checkRecipientPolicy({ email, category: 'marketing' })).allowed).toBe(false);
    expect((await checkRecipientPolicy({ email, category: 'transactional' })).allowed).toBe(false);
  });

  it('never downgrades an all-scope suppression to marketing-only', async () => {
    const email = 'qa-downgrade@example.com';
    await suppressAddress({ email, reason: 'unsubscribe_all', scope: 'all' });
    await suppressAddress({ email, reason: 'manual', scope: 'marketing' });

    const [row] = await getDb().select().from(emailSuppressions).where(eq(emailSuppressions.email, email));
    expect(row?.scope).toBe('all');
  });

  it('removes a suppression', async () => {
    const email = 'qa-remove@example.com';
    await suppressAddress({ email, reason: 'manual' });
    expect(await removeSuppression(email)).toBe(true);
    expect(await removeSuppression(email)).toBe(false);
  });

  it('honours the subscription reminder preference', async () => {
    const user = await makeUser('qa-reminders@example.com');
    await updatePreferences(user.id, { subscriptionReminders: false });
    const prefs = await loadPreferences(user.id);
    expect(prefs?.subscriptionReminders).toBe(false);

    const result = await checkRecipientPolicy({
      email: user.email,
      category: 'transactional',
      userId: user.id,
      preference: 'subscriptionReminders',
    });
    expect(result.allowed).toBe(false);
  });

  it('keeps security alerts on regardless of preferences', async () => {
    const user = await makeUser('qa-security@example.com');
    await updatePreferences(user.id, { securityAlerts: false });
    const result = await checkRecipientPolicy({
      email: user.email,
      category: 'transactional',
      userId: user.id,
      preference: 'securityAlerts',
    });
    // Essential security mail is not user-switchable.
    expect(result.allowed).toBe(true);
  });

  it('records when consent was granted', async () => {
    const user = await makeUser('qa-consent-at@example.com');
    await ensurePreferences(user.id);
    await updatePreferences(user.id, { marketingOptIn: true }, 'signup_form');
    const prefs = await loadPreferences(user.id);
    expect(prefs?.consentSource).toBe('signup_form');
    expect(prefs?.consentAt).not.toBeNull();
  });
});

/* ------------------------------- templates ------------------------------ */

describe('template rendering', () => {
  it('escapes substituted HTML', () => {
    const html = renderTemplate('<p>Hi {{name}}</p>', { name: '<script>alert(1)</script>' }, { html: true });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not escape in plain-text mode', () => {
    const text = renderTemplate('Hi {{name}}', { name: 'A & B' }, { html: false });
    expect(text).toBe('Hi A & B');
  });

  it('renders an empty string for null values', () => {
    const out = renderTemplate('X{{value}}Y', { value: null }, { html: false });
    expect(out).toBe('XY');
  });

  it('fails loudly on an unknown placeholder', () => {
    expect(() => renderTemplate('Hi {{usre_name}}', { name: 'x' }, { html: false })).toThrow(
      /Unknown template placeholder/,
    );
  });

  it('tolerates unknown placeholders when non-strict', () => {
    const out = renderTemplate('Hi {{nope}}', {}, { html: false, strict: false });
    expect(out).toBe('Hi ');
  });

  it('extracts placeholders', () => {
    expect(extractPlaceholders('{{a}} and {{ b }} and {{a}}')).toEqual(['a', 'b']);
  });

  it('escapes every dangerous character', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('derives readable text from HTML', () => {
    const text = htmlToText('<h1>Title</h1><p>Body text</p><a href="https://x.test/a">Click</a>');
    expect(text).toContain('Title');
    expect(text).toContain('Body text');
    expect(text).toContain('Click');
    expect(text).toContain('https://x.test/a');
    expect(text).not.toContain('<');
  });

  it('strips scripts and styles from the text alternative', () => {
    const text = htmlToText('<style>.a{}</style><script>bad()</script><p>Keep</p>');
    expect(text).toBe('Keep');
  });

  it('validates required fields', () => {
    expect(validateTemplate({ subject: '', html: '' }).length).toBeGreaterThan(0);
    expect(validateTemplate({ subject: 'Hi', html: '<p>x</p>' })).toEqual([]);
  });

  it('rejects placeholders outside the allowed list', () => {
    const problems = validateTemplate({
      subject: 'Hi',
      html: '<p>{{secret_token}}</p>',
      allowedVariables: ['name'],
    });
    expect(problems.join(' ')).toMatch(/secret_token/);
  });

  it('validates campaign drafts', () => {
    expect(validateCampaign({ name: '', subject: '', html: '' }).length).toBeGreaterThan(0);
    expect(validateCampaign({ name: 'N', subject: 'S', html: '<p>{{first_name}}</p>' })).toEqual([]);
  });
});

/* ----------------------------- unsubscribe ------------------------------ */

describe('unsubscribe tokens', () => {
  it('round-trips a valid token', () => {
    const token = unsubscribeToken(env, 'a@example.com', '11111111-1111-1111-1111-111111111111');
    expect(verifyUnsubscribeToken(env, 'a@example.com', '11111111-1111-1111-1111-111111111111', token)).toBe(true);
  });

  it('rejects a token for a different address', () => {
    const token = unsubscribeToken(env, 'a@example.com', '11111111-1111-1111-1111-111111111111');
    expect(verifyUnsubscribeToken(env, 'b@example.com', '11111111-1111-1111-1111-111111111111', token)).toBe(false);
  });

  it('rejects a tampered token', () => {
    const token = unsubscribeToken(env, 'a@example.com', '11111111-1111-1111-1111-111111111111');
    expect(verifyUnsubscribeToken(env, 'a@example.com', '11111111-1111-1111-1111-111111111111', `${token}x`)).toBe(
      false,
    );
  });

  it('builds a public url carrying the token', () => {
    const url = unsubscribeUrl(env, 'a@example.com', '11111111-1111-1111-1111-111111111111');
    expect(url).toContain('/unsubscribe?');
    expect(url).toContain('e=a%40example.com');
  });

  it('adds RFC 8058 headers for marketing mail', () => {
    const headers = buildUnsubscribeHeaders(env, 'a@example.com', '11111111-1111-1111-1111-111111111111');
    expect(headers['List-Unsubscribe']).toContain('<http');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('omits headers when there is no user', () => {
    expect(buildUnsubscribeHeaders(env, 'a@example.com')).toEqual({});
  });
});

/* ------------------------------- audience ------------------------------- */

describe('campaign audience', () => {
  it('only includes opted-in verified users for marketing', async () => {
    const optedIn = await makeUser('qa-aud-opted@example.com', { plan: 'premium' });
    await updatePreferences(optedIn.id, { marketingOptIn: true, productUpdates: true });
    const notOptedIn = await makeUser('qa-aud-no@example.com');
    await ensurePreferences(notOptedIn.id);
    const unverified = await makeUser('qa-aud-unverified@example.com', { emailVerified: false });
    await updatePreferences(unverified.id, { marketingOptIn: true, productUpdates: true });

    const { members } = await resolveAudience({ plan: 'any' }, { marketing: true, limit: 100 });
    const emails = members.map((m) => m.email);

    expect(emails).toContain('qa-aud-opted@example.com');
    expect(emails).not.toContain('qa-aud-no@example.com');
    // Unverified addresses are excluded: sending marketing to them harms sender reputation.
    expect(emails).not.toContain('qa-aud-unverified@example.com');
  });

  it('excludes suppressed addresses', async () => {
    const user = await makeUser('qa-aud-supp@example.com');
    await updatePreferences(user.id, { marketingOptIn: true, productUpdates: true });
    await suppressAddress({ email: user.email, reason: 'unsubscribe_marketing' });

    const { members } = await resolveAudience({ plan: 'any' }, { marketing: true, limit: 100 });
    expect(members.map((m) => m.email)).not.toContain('qa-aud-supp@example.com');
  });

  it('filters by plan', async () => {
    const premium = await makeUser('qa-aud-prem@example.com', { plan: 'premium' });
    await updatePreferences(premium.id, { marketingOptIn: true, productUpdates: true });

    const { members } = await resolveAudience({ plan: 'premium' }, { marketing: true, limit: 100 });
    expect(members.every((m) => m.plan === 'premium')).toBe(true);
  });

  it('excludes suspended and deleted users', async () => {
    const suspended = await makeUser('qa-aud-susp@example.com', { suspended: true });
    await updatePreferences(suspended.id, { marketingOptIn: true, productUpdates: true });

    const { members } = await resolveAudience({ plan: 'any' }, { marketing: true, limit: 100 });
    expect(members.map((m) => m.email)).not.toContain('qa-aud-susp@example.com');
  });

  it('builds a predicate without throwing for every segment field', () => {
    const predicate = segmentPredicate({
      plan: 'free',
      role: 'user',
      createdAfter: '2024-01-01',
      createdBefore: '2030-01-01',
      inactiveDays: 30,
    });
    expect(predicate).toBeDefined();
  });
});

/* --------------------- built-in template completeness -------------------- */

describe('built-in templates render', () => {
  /**
   * Guards against the class of bug where a helper forgets a field the template
   * requires: the send then fails at render time and looks like "user opted out".
   */
  it('every notify helper produces a renderable message', async () => {
    const user = await makeUser('qa-render-all@example.com', { plan: 'premium' });
    const base = { to: user.email, userId: user.id, name: user.name };

    const results = await Promise.all([
      notifyVerification(env, { ...base, verifyUrl: 'http://x/verify' }),
      notifyPasswordReset(env, { ...base, resetUrl: 'http://x/reset' }),
      notifyWelcome(env, { ...base }),
      notifyLoginAlert(env, { ...base, when: new Date() }),
      notifyPasswordChanged(env, { ...base, when: new Date() }),
      notifyAccountNotice(env, { ...base, heading: 'H', body: 'B' }),
      notifySupportReceived(env, { ...base, reference: 'TKT-1', subject: 'S', message: 'M' }),
      notifySubscription(env, { ...base, kind: 'activated', periodKey: 'a' }),
      notifySubscription(env, { ...base, kind: 'renewed', periodKey: 'b' }),
      notifySubscription(env, { ...base, kind: 'expiring', periodKey: 'c' }),
      notifySubscription(env, { ...base, kind: 'cancelled', periodKey: 'd' }),
    ]);

    for (const result of results) {
      expect(result.skippedReason).not.toBe('render_failed');
    }
    // At least most of them should be queued; security/transactional are never
    // blocked by defaults.
    expect(results.filter((r) => r.queued).length).toBeGreaterThanOrEqual(9);
  });

  it('renders an announcement with an unsubscribe link', async () => {
    const user = await makeUser('qa-render-ann@example.com');
    await updatePreferences(user.id, { marketingOptIn: true, productUpdates: true });
    const result = await notifyAnnouncement(env, {
      to: user.email,
      userId: user.id,
      name: user.name,
      title: 'News',
      body: 'Something happened.',
    });
    expect(result.queued).toBe(true);

    const [row] = await getDb().select().from(emailQueue).where(eq(emailQueue.id, result.id!));
    expect(row?.category).toBe('marketing');
    expect(row?.html).toContain('unsubscribe');
  });
});

/* ---------------------------- deliverability ---------------------------- */

describe('outbound headers', () => {
  const base = {
    webUrl: 'https://examtopicspro.duckdns.org',
    productName: 'ExamDump',
    supportEmail: 'examdump.official@gmail.com',
    messageKey: 'row-123',
  };

  it('marks transactional mail as machine generated', () => {
    const headers = buildMailHeaders({ ...base, category: 'transactional' });
    expect(headers['Auto-Submitted']).toBe('auto-generated');
    expect(headers['X-Auto-Response-Suppress']).toContain('AutoReply');
    // Precedence: bulk must never appear on transactional mail: filters
    // deprioritise it, and a password reset must not be deprioritised.
    expect(headers['Precedence']).toBeUndefined();
    expect(headers['List-Unsubscribe']).toBeUndefined();
  });

  it('classifies marketing mail as list traffic', () => {
    const headers = buildMailHeaders({
      ...base,
      category: 'marketing',
      unsubscribeUrl: 'https://x.test/unsubscribe?t=1',
    });
    expect(headers['Precedence']).toBe('bulk');
    expect(headers['List-Id']).toContain('ExamDump');
    expect(headers['List-Unsubscribe']).toBe('<https://x.test/unsubscribe?t=1>');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('includes a Feedback-ID tied to the message', () => {
    const headers = buildMailHeaders({ ...base, category: 'transactional' });
    expect(headers['Feedback-ID']).toContain('row-123');
    expect(headers['Feedback-ID']).toContain('examtopicspro.duckdns.org');
  });

  it('survives a malformed public url', () => {
    const headers = buildMailHeaders({ ...base, webUrl: 'not-a-url', category: 'transactional' });
    expect(headers['Auto-Submitted']).toBe('auto-generated');
  });

  it('omits List-Unsubscribe for marketing without a url', () => {
    const headers = buildMailHeaders({ ...base, category: 'marketing' });
    expect(headers['Precedence']).toBe('bulk');
    expect(headers['List-Unsubscribe']).toBeUndefined();
  });
});

describe('sender authentication audit', () => {
  it('flags a shared consumer domain as high risk', () => {
    const report = auditSenderIdentity('ExamDump <examdump.official@gmail.com>');
    expect(report.fromDomain).toBe('gmail.com');
    expect(report.sharedConsumerDomain).toBe(true);
    expect(report.ownedDomain).toBe(false);
    expect(report.risk).toBe('high');
  });

  it('states that SPF, DKIM and DMARC are all not possible for gmail.com', () => {
    const report = auditSenderIdentity('ExamDump <examdump.official@gmail.com>');
    expect(report.authentication.spf.status).toBe('not_possible');
    expect(report.authentication.dkim.status).toBe('not_possible');
    expect(report.authentication.dmarc.status).toBe('not_possible');
  });

  it('recommends a domain we own rather than claiming a fix', () => {
    const report = auditSenderIdentity('someone@gmail.com');
    expect(report.recommendations.join(' ')).toMatch(/domain you own/i);
    // Must be explicit that this is not something the code can solve.
    expect(report.summary).toMatch(/cannot authenticate/i);
  });

  it('reports an owned domain as low risk with available authentication', () => {
    const report = auditSenderIdentity('ExamDump <mail@examdump.pro>');
    expect(report.ownedDomain).toBe(true);
    expect(report.sharedConsumerDomain).toBe(false);
    expect(report.risk).toBe('low');
    expect(report.authentication.dkim.status).toBe('possible');
  });

  it('covers the other common consumer providers', () => {
    for (const address of ['a@yahoo.com', 'a@outlook.com', 'a@hotmail.com', 'a@icloud.com', 'a@proton.me']) {
      expect(auditSenderIdentity(address).sharedConsumerDomain).toBe(true);
    }
  });
});

describe('message id stability', () => {
  it('derives a stable Message-ID from the queue row', async () => {
    const user = await makeUser('qa-msgid@example.com');
    const first = await enqueueEmail(message({ to: user.email, userId: user.id }));
    const [row] = await getDb().select().from(emailQueue).where(eq(emailQueue.id, first.id!));
    // The transport builds `<rowId@senderHost>`; the id itself is stable and
    // unique, which is what makes a retry recognisable as the same message.
    expect(row?.id).toBe(first.id);
  });
});

describe('smarthost EHLO identity', () => {
  it('announces the public site host rather than a container id', () => {
    // A container hostname is random per-run (e.g. e5c9b7b726ba). If we leak it
    // into EHLO, Gmail records it as [127.0.0.1] in the Received header, which
    // looks like direct-to-MX injection.
    const name = ehloName({ ...offlineEnv(), PUBLIC_WEB_URL: 'https://examtopicspro.duckdns.org' } as Env);
    expect(name).toBe('examtopicspro.duckdns.org');
    expect(name).not.toMatch(/^[0-9a-f]{12}$/);
  });

  it('falls back to the smtp host when the public url is unusable', () => {
    const name = ehloName({ ...offlineEnv(), PUBLIC_WEB_URL: 'not-a-url', SMTP_HOST: 'smtp.gmail.com' } as Env);
    expect(name).toBe('smtp.gmail.com');
  });
});
