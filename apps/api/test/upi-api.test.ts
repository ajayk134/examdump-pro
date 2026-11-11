/**
 * UPI collection — HTTP surface tests.
 *
 * The behaviour that matters at this layer is access control and that the
 * sensitive ingest endpoint cannot be driven without a valid signature. The
 * matching/settlement logic itself is covered in `upi.test.ts`.
 *
 * Note: the test env has `PAYMENTS_ENABLED=false`, which is the exact production
 * state, so these tests also prove UPI stays closed until it is deliberately
 * turned on.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { TestContext } from './helpers.js';
import { createTestContext, loginAdmin, registerVerifiedUser } from './helpers.js';
import { getDb } from '../src/db/client.js';
import { payments, upiMatches, upiNotifications, upiOrders } from '../src/db/schema/index.js';

let ctx: TestContext;

async function sign(secret: string, body: unknown): Promise<string> {
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(upiMatches);
  await db.delete(upiNotifications);
  await db.delete(upiOrders);
  // Orders create `upi` payment rows, so they must not leak between tests.
  await db.delete(payments).where(eq(payments.provider, 'upi'));
});

describe('upi status', () => {
  it('reports unavailable while payments are disabled', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/upi/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { available: boolean; verification: string };
    expect(body.available).toBe(false);
    // The verification model is stated even when the feature is off.
    expect(body.verification).toBe('notification_based');
  });

  it('never leaks the payee VPA or secrets to an anonymous caller', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/upi/status' });
    const body = res.json() as Record<string, unknown>;
    expect(body.payeeVpa).toBeUndefined();
    expect(body.UPI_GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

describe('checkout requires auth', () => {
  it('refuses to create an order without a session', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/orders',
      payload: { planId: 'anything' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses an active-order lookup without a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/upi/orders/active' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses checkout while UPI is disabled, even when signed in', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/orders',
      payload: { planId: 'anything' },
      headers: { cookie: user.cookie },
    });
    // Disabled must beat "plan not found": no order is ever created.
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toMatch(/not available/i);
  });
});

describe('ingest signature', () => {
  it('refuses ingest when no secret is configured', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/ingest/sms',
      payload: { text: 'Rs 499 credited' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a request with no signature header', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/ingest/sms',
      payload: { text: 'Rs 499 credited' },
      headers: { 'x-upi-signature': '' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a wrong signature', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/ingest/sms',
      payload: { text: 'Rs 499 credited' },
      headers: { 'x-upi-signature': 'deadbeef'.repeat(8) },
    });
    expect(res.statusCode).toBe(401);
    // Nothing was stored from a forged request.
    const rows = await getDb().select().from(upiNotifications);
    expect(rows.length).toBe(0);
  });

  it('does not accept a "mark paid" style payload', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/ingest/notification',
      payload: { orderId: 'x', status: 'paid' },
    });
    expect(res.statusCode).toBe(401);
    const orders = await getDb().select().from(upiOrders);
    expect(orders.length).toBe(0);
  });
});

describe('exam-scoped plans', () => {
  /*
   * Regression: the request schema originally omitted `examKeys`, so zod
   * stripped it and every single-exam purchase failed validation with
   * "Choose the exam you want to unlock" *after* the buyer had been sent to
   * the checkout page. Found by driving the real UI in a browser.
   */
  it('accepts examKeys and rejects a single-scope plan without them', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const cookie = user.cookie;

    const enabled = ctx.env as { PAYMENTS_ENABLED?: boolean; UPI_PAYEE_VPA?: string };
    const prevPaid = enabled.PAYMENTS_ENABLED;
    const prevVpa = enabled.UPI_PAYEE_VPA;
    enabled.PAYMENTS_ENABLED = true;
    enabled.UPI_PAYEE_VPA = 'examdump@okhdfcbank';
    try {
      // Without an exam, a single-scope plan must be refused with a clear reason.
      const missing = await ctx.app.inject({
        method: 'POST',
        url: '/api/upi/orders',
        payload: { planId: 'single-30' },
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(400);
      expect((missing.json() as { error: { message: string } }).error.message).toMatch(/exam/i);

      // With the exam named, the field must survive validation and an order appear.
      const ok = await ctx.app.inject({
        method: 'POST',
        url: '/api/upi/orders',
        payload: { planId: 'single-30', examKeys: ['200-301'] },
        headers: { cookie },
      });
      expect(ok.statusCode).toBe(200);
      const order = (ok.json() as { order: { amountPaise: number; reference: string } }).order;
      expect(order.amountPaise).toBeGreaterThan(0);
      expect(order.reference).toMatch(/^ED[A-Z0-9]{8}$/);
    } finally {
      enabled.PAYMENTS_ENABLED = prevPaid;
      enabled.UPI_PAYEE_VPA = prevVpa;
    }
  });
});

describe('signed ingest', () => {
  /*
   * With a secret configured, a correctly signed alert is accepted and stored.
   * The env object is shared with the running app, so flipping the secret here
   * exercises the real verification path rather than a stub.
   */
  const SECRET = 'test-ingest-secret-0123456789';
  let previous: string | undefined;

  beforeEach(() => {
    const mutable = ctx.env as { UPI_SMS_INGEST_SECRET?: string };
    previous = mutable.UPI_SMS_INGEST_SECRET;
    mutable.UPI_SMS_INGEST_SECRET = SECRET;
  });

  // Leave the shared env exactly as found, so other suites are unaffected.
  afterEach(() => {
    (ctx.env as { UPI_SMS_INGEST_SECRET?: string }).UPI_SMS_INGEST_SECRET = previous;
  });

  it('accepts a correctly signed SMS alert', async () => {
    const payload = { text: 'Rs 499.00 credited to a/c XX1234. UPI Ref 123456789012', device: 'qa' };
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/ingest/sms',
      payload,
      headers: { 'x-upi-signature': await sign(SECRET, payload) },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { accepted: boolean }).accepted).toBe(true);

    const rows = await getDb().select().from(upiNotifications);
    expect(rows.length).toBe(1);
    expect(rows[0]?.source).toBe('sms');
  });

  it('rejects a body that was signed and then altered', async () => {
    const signed = { text: 'Rs 1.00 credited', device: 'qa' };
    const tampered = { text: 'Rs 99999.00 credited', device: 'qa' };
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/ingest/sms',
      payload: tampered,
      headers: { 'x-upi-signature': await sign(SECRET, signed) },
    });
    expect(res.statusCode).toBe(401);
    const rows = await getDb().select().from(upiNotifications);
    expect(rows.length).toBe(0);
  });
});

describe('admin surface', () => {
  it('refuses the UPI dashboard to an anonymous caller', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/admin-ops/upi/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses the UPI dashboard to a normal account', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/overview',
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('serves the overview to an administrator with the honest verification model', async () => {
    const cookie = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/overview',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      verification: string;
      verificationWarning: string;
      autoApprove: boolean;
    };
    expect(body.verification).toBe('notification_based');
    // The dashboard must carry the caveat, not just the docs.
    expect(body.verificationWarning).toMatch(/not proof/i);
    expect(typeof body.autoApprove).toBe('boolean');
  });

  it('lists orders and notifications for an administrator', async () => {
    const cookie = await loginAdmin(ctx.app);
    const orders = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/orders',
      headers: { cookie },
    });
    expect(orders.statusCode).toBe(200);
    expect(Array.isArray((orders.json() as { orders: unknown[] }).orders)).toBe(true);

    const notes = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/notifications',
      headers: { cookie },
    });
    expect(notes.statusCode).toBe(200);
    expect(Array.isArray((notes.json() as { notifications: unknown[] }).notifications)).toBe(true);
  });

  it('rejects a manual match for an unknown notification instead of inventing one', async () => {
    const cookie = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin-ops/upi/notifications/${crypto.randomUUID()}/match`,
      payload: { orderId: crypto.randomUUID(), note: 'test' },
      headers: { cookie },
    });
    // 400: the notification does not exist, so nothing settles.
    expect(res.statusCode).toBe(400);
    const payments_rows = await getDb().select().from(payments).where(eq(payments.provider, 'upi'));
    expect(payments_rows.length).toBe(0);
  });
});
