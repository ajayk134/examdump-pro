/**
 * ExamDump Mail — HTTP surface tests.
 *
 * Covers the two things that are easiest to get wrong at the route layer:
 * administrator-only access, and that a queued notification is actually created
 * by the real auth flows (not just by the queue unit tests).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { TestContext } from './helpers.js';
import { createTestContext, loginAdmin, registerVerifiedUser } from './helpers.js';
import { getDb } from '../src/db/client.js';
import {
  emailCampaigns,
  emailPreferences,
  emailQueue,
  emailSuppressions,
  users,
} from '../src/db/schema/index.js';
import { unsubscribeToken } from '../src/services/mail/unsubscribe.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(emailQueue);
  await db.delete(emailCampaigns);
  await db.delete(emailSuppressions);
  await db.delete(emailPreferences);
});

/* ------------------------------ permissions ----------------------------- */

describe('admin email permissions', () => {
  const adminRoutes = [
    ['GET', '/api/admin-ops/email/overview'],
    ['GET', '/api/admin-ops/email/templates'],
    ['GET', '/api/admin-ops/email/campaigns'],
    ['GET', '/api/admin-ops/email/queue'],
    ['GET', '/api/admin-ops/email/suppressions'],
  ] as const;

  it('rejects anonymous access to the email center', async () => {
    for (const [method, url] of adminRoutes) {
      const res = await ctx.app.inject({ method, url });
      expect([401, 404]).toContain(res.statusCode);
    }
  });

  it('rejects a normal user', async () => {
    const user = await registerVerifiedUser(ctx.app);
    for (const [method, url] of adminRoutes) {
      const res = await ctx.app.inject({ method, url, headers: { cookie: user.cookie } });
      // 404 rather than 403: the admin surface is not advertised to non-admins.
      expect([403, 404]).toContain(res.statusCode);
    }
  });

  it('allows an administrator', async () => {
    const cookie = await loginAdmin(ctx.app);
    for (const [method, url] of adminRoutes) {
      const res = await ctx.app.inject({ method, url, headers: { cookie } });
      expect(res.statusCode).toBe(200);
    }
  });

  it('rejects a normal user trying to send a campaign', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/email/campaigns',
      headers: { cookie: user.cookie },
      payload: { name: 'X', subject: 'X', html: '<p>x</p>' },
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});

/* ------------------------------- templates ------------------------------ */

describe('admin email templates API', () => {
  it('seeds system templates', async () => {
    const cookie = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/email/templates',
      headers: { cookie },
    });
    const body = res.json() as { templates: Array<{ key: string; isSystem: boolean }> };
    expect(body.templates.length).toBeGreaterThan(5);
    expect(body.templates.some((t) => t.key === 'email_verify')).toBe(true);
  });

  it('creates a template and previews it', async () => {
    const cookie = await loginAdmin(ctx.app);
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/email/templates',
      headers: { cookie },
      payload: {
        key: 'custom_hello',
        subject: 'Hello {{name}}',
        body: '<p>Hi {{name}}</p>',
        category: 'transactional',
      },
    });
    expect(create.statusCode).toBe(200);

    const preview = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/email/preview',
      headers: { cookie },
      payload: { subject: 'Hello {{name}}', html: '<p>Hi {{name}}</p>' },
    });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { html: string }).html).toContain('Alex');
  });

  it('refuses a template with an unknown placeholder', async () => {
    const cookie = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/email/templates',
      headers: { cookie },
      payload: { key: 'bad_one', subject: 'Hi', body: '<p>{{nope}}</p>' },
    });
    expect(res.statusCode).toBe(400);
  });
});

/* ------------------------------- campaigns ------------------------------ */

describe('admin campaigns API', () => {
  it('creates a draft campaign and queues it for one opted-in recipient', async () => {
    const cookie = await loginAdmin(ctx.app);
    const recipient = await registerVerifiedUser(ctx.app);

    // Opt the user in so marketing mail is permitted.
    await getDb()
      .insert(emailPreferences)
      .values({ userId: recipient.userId, marketingOptIn: true, productUpdates: true })
      .onConflictDoNothing();

    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/email/campaigns',
      headers: { cookie },
      payload: {
        name: 'Launch',
        subject: 'Hello {{first_name}}',
        html: '<p>Hi {{first_name}}, news!</p>',
        category: 'marketing',
        segment: { plan: 'any' },
      },
    });
    expect(create.statusCode).toBe(200);
    const campaignId = (create.json() as { campaign: { id: string } }).campaign.id;

    const send = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin-ops/email/campaigns/${campaignId}/send`,
      headers: { cookie },
    });
    expect(send.statusCode).toBe(200);

    const rows = await getDb().select().from(emailQueue).where(eq(emailQueue.campaignId, campaignId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.category === 'marketing')).toBe(true);
    // Personalised and escaped on the way in.
    expect(rows.some((r) => r.subject.startsWith('Hello '))).toBe(true);
  });

  it('cancels a campaign and its pending messages', async () => {
    const cookie = await loginAdmin(ctx.app);
    const recipient = await registerVerifiedUser(ctx.app);
    await getDb()
      .insert(emailPreferences)
      .values({ userId: recipient.userId, marketingOptIn: true, productUpdates: true })
      .onConflictDoNothing();

    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/email/campaigns',
      headers: { cookie },
      payload: { name: 'Cancelled', subject: 'S', html: '<p>x</p>', category: 'marketing' },
    });
    const campaignId = (create.json() as { campaign: { id: string } }).campaign.id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/admin-ops/email/campaigns/${campaignId}/send`,
      headers: { cookie },
    });

    const cancel = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin-ops/email/campaigns/${campaignId}/cancel`,
      headers: { cookie },
    });
    expect(cancel.statusCode).toBe(200);

    const remaining = await getDb()
      .select()
      .from(emailQueue)
      .where(sql`${emailQueue.campaignId} = ${campaignId} and ${emailQueue.status} = 'queued'`);
    expect(remaining).toHaveLength(0);
  });

  it('reports the audience size for a segment', async () => {
    const cookie = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/email/audience',
      headers: { cookie },
      payload: { segment: { plan: 'any' }, marketing: false },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof (res.json() as { total: number }).total).toBe('number');
  });
});

/* --------------------------- preference & optout ------------------------ */

describe('user email preferences API', () => {
  it('returns defaults for a new user', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/email/preferences',
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const prefs = (res.json() as { preferences: { marketingOptIn: boolean; securityAlerts: boolean } }).preferences;
    expect(prefs.marketingOptIn).toBe(false);
    expect(prefs.securityAlerts).toBe(true);
  });

  it('persists an opt-in', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/email/preferences',
      headers: { cookie: user.cookie },
      payload: { marketingOptIn: true },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { preferences: { marketingOptIn: boolean } }).preferences.marketingOptIn).toBe(true);
  });

  it('rejects an anonymous preference read', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/email/preferences' });
    expect(res.statusCode).toBe(401);
  });

  it('unsubscribes with a valid token and blocks marketing', async () => {
    const user = await registerVerifiedUser(ctx.app);
    await getDb()
      .insert(emailPreferences)
      .values({ userId: user.userId, marketingOptIn: true })
      .onConflictDoNothing();

    const token = unsubscribeToken(ctx.env, user.email, user.userId);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/email/unsubscribe',
      payload: { e: user.email, u: user.userId, t: token, scope: 'marketing' },
    });
    expect(res.statusCode).toBe(200);

    const [suppression] = await getDb()
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, user.email.toLowerCase()));
    expect(suppression?.scope).toBe('marketing');

    const [prefs] = await getDb().select().from(emailPreferences).where(eq(emailPreferences.userId, user.userId));
    expect(prefs?.marketingOptIn).toBe(false);
  });

  it('rejects an unsubscribe with a forged token', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/email/unsubscribe',
      payload: { e: user.email, u: user.userId, t: 'forged-token-value-x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unsubscribe for a different address than the token covers', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const token = unsubscribeToken(ctx.env, user.email, user.userId);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/email/unsubscribe',
      payload: { e: 'someone-else@example.com', u: user.userId, t: token },
    });
    expect(res.statusCode).toBe(400);
  });
});

/* --------------------------- real flow integration ---------------------- */

describe('notifications are queued by real flows', () => {
  it('queues a verification email on signup', async () => {
    const email = `qa-signup-${Date.now()}@test.local`;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Queue Check', email, password: 'UserPass123', acceptTerms: true },
    });
    expect(res.statusCode).toBe(201);

    const rows = await getDb().select().from(emailQueue).where(eq(emailQueue.recipient, email.toLowerCase()));
    expect(rows.length).toBe(1);
    expect(rows[0]?.template).toBe('email_verify');
    expect(rows[0]?.status).toBe('queued');
    expect(rows[0]?.category).toBe('transactional');
  });

  it('queues a password reset and a security alert on login', async () => {
    const user = await registerVerifiedUser(ctx.app);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: user.email },
    });
    const resets = await getDb()
      .select()
      .from(emailQueue)
      .where(sql`${emailQueue.recipient} = ${user.email.toLowerCase()} and ${emailQueue.template} = 'password_reset'`);
    expect(resets.length).toBe(1);

    // registerVerifiedUser logs in, which queues exactly one login alert.
    const alerts = await getDb()
      .select()
      .from(emailQueue)
      .where(sql`${emailQueue.recipient} = ${user.email.toLowerCase()} and ${emailQueue.template} = 'login_alert'`);
    expect(alerts.length).toBe(1);
  });

  it('dedupes repeated login alerts within the same hour', async () => {
    const user = await registerVerifiedUser(ctx.app);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: user.password },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: user.password },
    });

    const alerts = await getDb()
      .select()
      .from(emailQueue)
      .where(sql`${emailQueue.recipient} = ${user.email.toLowerCase()} and ${emailQueue.template} = 'login_alert'`);
    // One per hour bucket, not one per login.
    expect(alerts.length).toBe(1);
  });

  it('queues a support acknowledgement', async () => {
    const email = `qa-support-${Date.now()}@test.local`;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/support/tickets',
      payload: {
        email,
        subject: 'Cannot log in',
        category: 'account',
        message: 'I cannot log in to my account.',
      },
    });
    expect([200, 201]).toContain(res.statusCode);

    const rows = await getDb()
      .select()
      .from(emailQueue)
      .where(sql`${emailQueue.recipient} = ${email.toLowerCase()} and ${emailQueue.template} = 'support_received'`);
    expect(rows.length).toBe(1);
  });

  it('does not queue marketing to a user who has not opted in', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const cookie = await loginAdmin(ctx.app);

    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/email/campaigns',
      headers: { cookie },
      payload: { name: 'No consent', subject: 'S', html: '<p>x</p>', category: 'marketing' },
    });
    const campaignId = (create.json() as { campaign: { id: string } }).campaign.id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/admin-ops/email/campaigns/${campaignId}/send`,
      headers: { cookie },
    });

    const rows = await getDb()
      .select()
      .from(emailQueue)
      .where(sql`${emailQueue.recipient} = ${user.email.toLowerCase()} and ${emailQueue.campaignId} = ${campaignId}`);
    expect(rows).toHaveLength(0);
  });
});
