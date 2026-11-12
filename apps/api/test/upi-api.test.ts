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
      const order = (
        ok.json() as {
          order: {
            amountPaise: number;
            baseAmountPaise: number;
            suffixPaise: number;
            amountLabel: string;
            upiUri: string;
            reference: string;
            intents: Array<{ href: string }>;
          };
        }
      ).order;
      expect(order.amountPaise).toBeGreaterThan(0);
      expect(order.reference).toMatch(/^ED[A-Z0-9]{8}$/);

      // The checkout payload must describe the payable amount consistently: the
      // QR, every app intent and the label all quote the suffixed total, while the
      // quoted plan price stays available separately.
      const label = (order.amountPaise / 100).toFixed(2);
      expect(order.suffixPaise).toBeGreaterThanOrEqual(1);
      expect(order.suffixPaise).toBeLessThanOrEqual(99);
      expect(order.amountPaise - order.baseAmountPaise).toBe(order.suffixPaise);
      expect(order.amountLabel).toContain(label);
      expect(order.upiUri).toContain(`am=${label}`);
      for (const intent of order.intents) expect(intent.href).toContain(`am=${label}`);
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

/* ======================================================================== */
/* Regression tests added by the production-readiness audit                  */
/* ======================================================================== */

describe('timestamp-bound ingest signature', () => {
  /**
   * Regression: the HMAC covered only the raw body, so a captured request stayed
   * valid forever. Signing `<timestamp>.<body>` lets stale requests be refused,
   * and because the timestamp is inside the HMAC an attacker cannot move it
   * forward to keep a captured request alive.
   */
  const SECRET = 'test-ingest-secret-0123456789';
  let previous: string | undefined;

  beforeEach(() => {
    const mutable = ctx.env as { UPI_SMS_INGEST_SECRET?: string };
    previous = mutable.UPI_SMS_INGEST_SECRET;
    mutable.UPI_SMS_INGEST_SECRET = SECRET;
  });

  afterEach(() => {
    (ctx.env as { UPI_SMS_INGEST_SECRET?: string }).UPI_SMS_INGEST_SECRET = previous;
  });

  async function post(body: unknown, headers: Record<string, string>) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/upi/ingest/sms',
      headers: { 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(body),
    });
  }

  function signWithTimestamp(ts: string, body: unknown): string {
    return createHmac('sha256', SECRET).update(`${ts}.${JSON.stringify(body)}`).digest('hex');
  }

  it('accepts a fresh timestamped signature', async () => {
    const body = {
      text: 'Rs.499.00 credited to your a/c XX1234 from VPA payer@okhdfcbank. UPI Ref No 909090909090',
      timestamp: new Date().toISOString(),
    };
    const ts = String(Date.now());
    const res = await post(body, { 'x-upi-signature': signWithTimestamp(ts, body), 'x-upi-timestamp': ts });
    expect(res.statusCode).toBeLessThan(400);
  });

  it('refuses a timestamped signature that is too old', async () => {
    const body = { text: 'Rs.10.00 credited ... UPI Ref No 111111111111' };
    // Three days old: outside the replay window even though the HMAC is valid.
    const ts = String(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const res = await post(body, { 'x-upi-signature': signWithTimestamp(ts, body), 'x-upi-timestamp': ts });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a signature whose timestamp was tampered with', async () => {
    const body = { text: 'Rs.10.00 credited ... UPI Ref No 222222222222' };
    const signedAt = String(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const sig = signWithTimestamp(signedAt, body);
    // Attacker replays an old signature but claims a fresh timestamp.
    const res = await post(body, { 'x-upi-signature': sig, 'x-upi-timestamp': String(Date.now()) });
    expect(res.statusCode).toBe(401);
  });

  it('still accepts the legacy body-only signature', async () => {
    const body = { text: 'Rs.499.00 credited to your a/c XX1234 from VPA payer@okhdfcbank. UPI Ref No 313131313131' };
    const res = await post(body, { 'x-upi-signature': await sign(SECRET, body) });
    expect(res.statusCode).toBeLessThan(400);
  });

  it('rejects an unusable message timestamp rather than trusting it', async () => {
    const body = { text: 'Rs.499.00 credited ... UPI Ref No 414141414141', timestamp: 'not-a-date' };
    const ts = String(Date.now());
    const res = await post(body, { 'x-upi-signature': signWithTimestamp(ts, body), 'x-upi-timestamp': ts });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a request whose raw bytes were not captured', async () => {
    /*
     * Regression: the route used `request.rawBody ?? ''`, so a request that
     * reached the handler without captured bytes would be hashed as an empty
     * string instead of being refused. The empty-body signature below is exactly
     * what that fallback would have accepted.
     *
     * A request with no body is answered by the JSON content-type parser before
     * the handler runs (empty payload -> `{}`, rawBody never set), so it exits
     * through schema validation. That is still a refusal, which is the property
     * under test: nothing is hashed, nothing is stored, no 2xx. The raw-body rule
     * itself is covered directly in `payments.test.ts` against `requireRawBody`.
     */
    const emptySignature = createHmac('sha256', SECRET).update('').digest('hex');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upi/ingest/sms',
      headers: { 'x-upi-signature': emptySignature },
      payload: '',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const rows = await getDb().select().from(upiNotifications);
    expect(rows.length).toBe(0);
  });

  it('refuses an oversized body before hashing it', async () => {
    // A public endpoint must not HMAC an attacker-chosen megabyte of bytes.
    const body = { text: 'x'.repeat(9 * 1024) };
    const ts = String(Date.now());
    const res = await post(body, { 'x-upi-signature': signWithTimestamp(ts, body), 'x-upi-timestamp': ts });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toMatch(/too large/i);
  });
});


describe('admin order detail does not leak other orders', () => {
  /**
   * Regression: the detail route filtered notifications only on
   * `status = 'matched'`, so it returned the five most recent matches in the
   * whole system. Opening one order showed unrelated customers' bank references
   * and message excerpts.
   */
  it('returns only the notifications that settled the requested order', async () => {
    const db = getDb();
    await db.delete(upiMatches);
    await db.delete(upiNotifications);
    await db.delete(upiOrders);

    const buyer = await registerVerifiedUser(ctx.app, { email: 'upi-leak-a@example.com' });

    const [order] = await db
      .insert(upiOrders)
      .values({
        reference: 'EDLEAKA01',
        userId: buyer.userId,
        amountPaise: 49900,
        baseAmountPaise: 49900,
        payeeVpa: 'examdump@okhdfcbank',
        payeeName: 'ExamDump',
        upiUri: 'upi://pay',
        status: 'settled',
        settledAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    const [related] = await db
      .insert(upiNotifications)
      .values({
        source: 'gmail',
        status: 'matched',
        amountPaise: 49900,
        bankReference: 'AAAAORDERA',
        rawText: 'order A credit',
        observedAt: new Date(),
        dedupeKey: `k-a-${Date.now()}`,
      })
      .returning();

    // Matched, but belongs to no order in this test.
    await db.insert(upiNotifications).values({
      source: 'gmail',
      status: 'matched',
      amountPaise: 19900,
      bankReference: 'BBBBOTHER',
      rawText: 'unrelated credit',
      observedAt: new Date(),
      dedupeKey: `k-b-${Date.now()}`,
    });

    await db.insert(upiMatches).values({
      orderId: order!.id,
      notificationId: related!.id,
      decision: 'manual_approved',
      reasons: ['test'],
      confidence: 100,
      amountPaise: 49900,
    });

    const cookie = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/admin-ops/upi/orders/${order!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { recentMatches: Array<{ bankReference: string | null }> };
    expect(body.recentMatches.length).toBe(1);
    expect(body.recentMatches[0]?.bankReference).toBe('AAAAORDERA');
  });
});

/* ======================================================================== */
/* Customer-visible order status                                            */
/* ======================================================================== */

describe('customer-visible order status', () => {
  /**
   * The checkout page polls one order and renders whatever `status` says. Those
   * are customer-facing names (pending / processing / paid / expired / cancelled),
   * not database enum values, so the page cannot accidentally become a second
   * place that knows the schema.
   *
   * `processing` is the one that matters for automation: without it a credit
   * waiting for verification looks exactly like "nothing has arrived", so the
   * payer sends the money a second time.
   */
  async function seedOrder(opts: { status: string; amountPaise?: number }) {
    const db = getDb();
    await db.delete(upiMatches);
    await db.delete(upiNotifications);
    await db.delete(upiOrders);
    const buyer = await registerVerifiedUser(ctx.app, { email: `upi-status-${crypto.randomUUID()}@example.com` });
    const [order] = await db
      .insert(upiOrders)
      .values({
        reference: `ED${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        userId: buyer.userId,
        amountPaise: opts.amountPaise ?? 49937,
        baseAmountPaise: 49900,
        payeeVpa: 'examdump@okhdfcbank',
        payeeName: 'ExamDump',
        upiUri: 'upi://pay?pa=examdump@okhdfcbank&am=499.37',
        description: 'Test plan',
        status: opts.status as never,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .returning();
    return { order: order!, cookie: buyer.cookie };
  }

  async function getOrder(id: string, cookie: string) {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/upi/orders/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return res.json() as {
      order: {
        status: string;
        amountPaise: number;
        amountLabel: string;
        review: { observedAt: string; amountPaise: number } | null;
        verification: string;
        qrSvg: string;
        upiUri: string;
      };
    };
  }

  it('reports a live order as pending with no review summary', async () => {
    const { order, cookie } = await seedOrder({ status: 'pending' });
    const body = await getOrder(order.id, cookie);
    expect(body.order.status).toBe('pending');
    expect(body.order.review).toBeNull();
  });

  it('reports a held match as processing, which is what stops a second payment', async () => {
    const { order, cookie } = await seedOrder({ status: 'under_review' });
    const db = getDb();
    const [note] = await db
      .insert(upiNotifications)
      .values({
        source: 'gmail',
        status: 'unmatched',
        amountPaise: 49937,
        bankReference: 'STATUSREVIEW',
        rawText: `Rs.499.37 credited. Ref ${order.reference}`,
        observedAt: new Date(),
        dedupeKey: `k-status-${Date.now()}`,
      })
      .returning();
    await db.insert(upiMatches).values({
      orderId: order.id,
      notificationId: note!.id,
      decision: 'rejected',
      reasons: ['held_for_review'],
      confidence: 90,
      amountPaise: 49937,
    });

    const body = await getOrder(order.id, cookie);
    expect(body.order.status).toBe('processing');
    expect(body.order.review?.amountPaise).toBe(49937);
    // The bank reference must not be exposed to the payer.
    expect(JSON.stringify(body.order)).not.toContain('STATUSREVIEW');
  });

  it('reports a settled order as paid and never re-opens it', async () => {
    const { order, cookie } = await seedOrder({ status: 'settled' });
    const body = await getOrder(order.id, cookie);
    expect(body.order.status).toBe('paid');
    expect(body.order.review).toBeNull();
  });

  it('reports a cancelled order as cancelled, not as pending', async () => {
    const { order, cookie } = await seedOrder({ status: 'cancelled' });
    const body = await getOrder(order.id, cookie);
    expect(body.order.status).toBe('cancelled');
  });

  it('says which verification the payer will actually get', async () => {
    const { order, cookie } = await seedOrder({ status: 'pending' });
    const body = await getOrder(order.id, cookie);
    // The test env runs with auto-approval off, exactly like the first deployment.
    expect(['automatic_match', 'reviewed_match']).toContain(body.order.verification);
  });

  it('never lets another account read the order', async () => {
    const { order } = await seedOrder({ status: 'pending' });
    const stranger = await registerVerifiedUser(ctx.app, {
      email: `upi-status-stranger-${crypto.randomUUID()}@example.com`,
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/upi/orders/${order.id}`,
      headers: { cookie: stranger.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('keeps the QR payload identical across polls', async () => {
    // A poll must not re-derive the payment parameters: what the payer scanned
    // has to stay byte-identical or a mid-payment refresh would change the amount.
    const { order, cookie } = await seedOrder({ status: 'pending' });
    const first = await getOrder(order.id, cookie);
    const second = await getOrder(order.id, cookie);
    expect(second.order.qrSvg).toBe(first.order.qrSvg);
    expect(second.order.upiUri).toBe(first.order.upiUri);
    expect(second.order.amountPaise).toBe(first.order.amountPaise);
  });
});
