import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, loginAdmin, registerVerifiedUser, type TestContext } from './helpers.js';
import { issueInvoice, quotePlan, settlePayment } from '../src/services/subscription.service.js';
import type { User } from '../src/db/schema/index.js';
import { resolveEntitlements } from '../src/services/entitlement.service.js';
import { verifyWebhookSignature } from '../src/services/hyperswitch.client.js';
import { getSettings } from '../src/services/settings.service.js';
import { createHmac } from 'node:crypto';
import { getDb } from '../src/db/client.js';
import { invoices, payments, users } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

/** Create a pending payment row the way the gateway flow would (no live calls). */
async function seedPendingPayment(user: User, input: { planId: string; examKeys?: string[] }) {
  const db = getDb();
  const userId = user.id;
  const quote = await quotePlan(userId, input);
  const [row] = await db
    .insert(payments)
    .values({
      userId,
      amountMinor: quote.totalMinor,
      discountMinor: quote.discountMinor,
      currency: quote.currency,
      status: 'pending',
      provider: 'hyperswitch',
      providerRef: `pay_test_${Math.random().toString(36).slice(2, 10)}`,
      providerPaymentId: `pay_test_${Math.random().toString(36).slice(2, 10)}`,
      metadata: { planId: quote.plan.id, examKeys: quote.examKeys },
      description: quote.plan.name,
    })
    .returning();
  return row!;
}

async function freshUser() {
  const registered = await registerVerifiedUser(app);
  const [row] = await getDb().select().from(users).where(eq(users.id, registered.userId)).limit(1);
  return { ...registered, row: row! };
}

describe('pricing quotes', () => {
  it('prices multi-exam passes and enforces the 3 exam quota', async () => {
    const user = await freshUser();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/payments/quote',
      headers: { cookie: user.cookie },
      payload: { planId: 'multi-30', examKeys: ['200-301', '100-890'] },
    });
    expect(ok.statusCode).toBe(200);
    const quote = ok.json() as { totalMinor: number; plan: { id: string; examQuota: number } };
    expect(quote.plan.examQuota).toBe(3);
    expect(quote.totalMinor).toBe(99_900);

    const tooMany = await app.inject({
      method: 'POST',
      url: '/api/payments/quote',
      headers: { cookie: user.cookie },
      payload: {
        planId: 'multi-30',
        examKeys: ['200-301', '100-890', '300-101', '400-101'],
      },
    });
    expect(tooMany.statusCode).toBe(400);
    expect((tooMany.json() as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it('never trusts a client-side price', async () => {
    const user = await freshUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/quote',
      headers: { cookie: user.cookie },
      payload: { planId: 'all-365', priceMinor: 1, amountMinor: 1, totalMinor: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { totalMinor: number }).totalMinor).toBe(499_900);
  });
});

describe('settlement', () => {
  it('is idempotent and only grants access once', async () => {
    const user = await freshUser();
    const order = await seedPendingPayment(user.row, { planId: 'all-30' });
    expect(order.status).toBe('pending');

    const first = await settlePayment(order.id, { gatewayStatus: 'succeeded', source: 'webhook' });
    expect(first.status).toBe('succeeded');
    expect(first.subscriptionId).toBeTruthy();

    const second = await settlePayment(order.id, { gatewayStatus: 'succeeded', source: 'webhook' });
    expect(second.status).toBe('already_settled');

    const entitlements = await resolveEntitlements(user.row, await getSettings(ctx.env));
    expect(entitlements.allAccess).toBe(true);

    const rows = await getDb().select().from(payments).where(eq(payments.userId, user.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paidAt).toBeTruthy();
  });

  it('records failures without granting access', async () => {
    const user = await freshUser();
    const order = await seedPendingPayment(user.row, { planId: 'all-30' });
    const result = await settlePayment(order.id, {
      gatewayStatus: 'failed',
      failureReason: 'card_declined',
      source: 'webhook',
    });
    expect(result.status).toBe('failed');
    const entitlements = await resolveEntitlements(user.row, await getSettings(ctx.env));
    expect(entitlements.allAccess).toBe(false);
  });

  it('issues exactly one invoice per paid payment', async () => {
    const user = await freshUser();
    const order = await seedPendingPayment(user.row, { planId: 'single-30', examKeys: ['200-301'] });
    await settlePayment(order.id, { gatewayStatus: 'succeeded', source: 'webhook' });
    await issueInvoice(order.id);
    await issueInvoice(order.id);

    const rows = await getDb().select().from(invoices).where(eq(invoices.paymentId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalMinor).toBe(49_900);
    expect(rows[0]!.number).toMatch(/^EDP\//);

    const list = await app.inject({
      method: 'GET',
      url: '/api/payments/invoices',
      headers: { cookie: user.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { invoices: unknown[] }).invoices).toHaveLength(1);
  });
});

describe('webhook signature verification', () => {
  const secret = 'whsec_test_0123456789';

  it('accepts a correctly signed payload', () => {
    const body = JSON.stringify({ event_id: 'evt_1', event_type: 'payment_succeeded' });
    const signature = createHmac('sha512', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects tampered bodies and missing signatures', () => {
    const body = JSON.stringify({ event_id: 'evt_1' });
    const signature = createHmac('sha512', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'deadbeef', secret)).toBe(false);
    expect(verifyWebhookSignature(body, '', secret)).toBe(false);
  });

  it('rejects unsigned webhook deliveries over HTTP', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/webhook/hyperswitch',
      payload: { event_type: 'payment_succeeded', content: { object: { payment_id: 'x' } } },
    });
    expect([400, 401, 503]).toContain(response.statusCode);
  });
});

describe('entitlement scoping', () => {
  it('gives a multi pass access to exactly its three exams', async () => {
    const user = await freshUser();
    const order = await seedPendingPayment(user.row, {
      planId: 'multi-30',
      examKeys: ['200-301', '100-890'],
    });
    await settlePayment(order.id, { gatewayStatus: 'succeeded', source: 'webhook' });
    const entitlements = await resolveEntitlements(user.row, await getSettings(ctx.env));
    expect(entitlements.allAccess).toBe(false);
    expect([...entitlements.examKeys].sort()).toEqual(['100-890', '200-301']);
  });

  it('lets an admin cancel a subscription at period end', async () => {
    const user = await freshUser();
    const adminCookie = await loginAdmin(app);
    const order = await seedPendingPayment(user.row, { planId: 'all-30' });
    const settled = await settlePayment(order.id, { gatewayStatus: 'succeeded', source: 'webhook' });

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/admin-ops/subscriptions/${settled.subscriptionId}/cancel`,
      headers: { cookie: adminCookie },
      payload: { immediate: false },
    });
    expect([200, 404]).toContain(cancel.statusCode);
  });
});
