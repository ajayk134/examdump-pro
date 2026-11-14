/**
 * YouPI-PG merchant integration.
 *
 * These tests pin down the security contract of the YouPI webhook receiver and
 * the checkout route:
 *   - the amount is always the server quote, never the client's;
 *   - a webhook is only accepted with a valid HMAC over the raw bytes, a fresh
 *     timestamp and a unique delivery id;
 *   - ONLY a `RECONCILED` (settlementState `RECONCILED`) event fulfils an order;
 *   - `OBSERVED_SUCCESS` and `MANUAL_REVIEW` are recorded but never fulfil.
 *
 * They run against a throwaway stub of the YouPI merchant API, so no network,
 * no real gateway and no money is involved.
 */
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { payments, subscriptions, webhookEvents } from '../src/db/schema/index.js';
import { createTestContext, registerVerifiedUser, type TestContext, type RegisteredUser } from './helpers.js';
import { buildApp } from '../src/app.js';
import type { Env } from '../src/config/env.js';
import {
  verifyYoupiWebhook,
  youpiCheckoutAvailability,
  toRupees,
} from '../src/services/payments/youpi.client.js';

const WEBHOOK_SECRET = 'test-youpi-webhook-secret';
process.env.YOUPI_ENABLED = 'true';
process.env.YOUPI_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.YOUPI_MERCHANT_ID = '11111111-1111-1111-1111-111111111111';
process.env.YOUPI_MERCHANT_KEY = 'mk_live_test_key';
process.env.YOUPI_WEBHOOK_TOLERANCE_SECONDS = '300';

let ctx: TestContext;
let user: RegisteredUser;
let gateway: { url: string; close: () => Promise<void> };
let gatewayRequests = 0;

function startStubGateway(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/v1/payments') {
        gatewayRequests += 1;
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}') as { orderId?: string };
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              paymentId: `yp_${Math.random().toString(36).slice(2, 10)}`,
              orderId: parsed.orderId,
              amount: '0.00',
              currency: 'INR',
              status: 'INITIATED',
              checkoutUrl: `https://pay.example.test/checkout/${parsed.orderId}`,
            }),
          );
        });
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function signedHeaders(body: string, opts: { timestamp?: number; deliveryId?: string; event: string; badSignature?: boolean }) {
  const ts = opts.timestamp ?? Date.now();
  const signWith = opts.badSignature ? 'wrong-secret' : WEBHOOK_SECRET;
  const v1 = createHmac('sha256', signWith).update(body).digest('hex');
  const v2 = createHmac('sha256', signWith).update(`${ts}.${body}`).digest('hex');
  return {
    'content-type': 'application/json',
    'x-gateway-event': opts.event,
    'x-gateway-timestamp': String(ts),
    'x-gateway-delivery-id': opts.deliveryId ?? `dlv_${Math.random().toString(36).slice(2, 10)}`,
    'x-gateway-signature': `sha256=${v1}`,
    'x-gateway-signature-v2': `sha256=${v2}`,
  };
}

async function createPendingOrder(examKey?: string): Promise<{ orderRef: string; amountMinor: number; gatewayPaymentId: string; paymentRowId: string; checkoutUrl: string }> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/payments/pay/youpi/checkout',
    headers: { cookie: user.cookie },
    payload: { planId: 'all-30', ...(examKey ? { examKey } : {}) },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { orderRef: string; amountMinor: number; gatewayPaymentId: string; paymentId: string; checkoutUrl: string };
  return { orderRef: body.orderRef, amountMinor: body.amountMinor, gatewayPaymentId: body.gatewayPaymentId, paymentRowId: body.paymentId, checkoutUrl: body.checkoutUrl };
}

/** Build a real app with one flag combination, sharing the test database. */
async function withEnv<T>(
  overrides: Partial<Env>,
  fn: (app: FastifyInstance) => Promise<T>,
): Promise<T> {
  const app = await buildApp({ env: { ...ctx.env, ...overrides }, logger: false });
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

async function userPaymentCount(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.userId, userId));
  return rows.length;
}

beforeAll(async () => {
  gateway = await startStubGateway();
  process.env.YOUPI_API_URL = gateway.url;
  // The successful checkout/webhook tests need live payments enabled. The
  // deployment-wide kill switch is exercised explicitly further down.
  ctx = await createTestContext({
    envOverrides: { PAYMENTS_ENABLED: 'true', YOUPI_ENABLED: 'true' },
  });
  user = await registerVerifiedUser(ctx.app);
});

afterAll(async () => {
  await ctx?.cleanup();
  await gateway?.close();
});

describe('youpi client helpers', () => {
  it('formats integer paise as a rupees string without floats', () => {
    expect(toRupees(49900)).toBe('499.00');
    expect(toRupees(1)).toBe('0.01');
    expect(toRupees(0)).toBe('0.00');
    expect(toRupees(123456)).toBe('1234.56');
  });

  it('rejects a stale timestamp even with a valid signature', () => {
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId: 'x', orderId: 'o' });
    const stale = Date.now() - 10 * 60 * 1000;
    const result = verifyYoupiWebhook(
      { YOUPI_WEBHOOK_SECRET: WEBHOOK_SECRET, YOUPI_WEBHOOK_TOLERANCE_SECONDS: 300 } as never,
      { rawBody: body, headers: signedHeaders(body, { event: 'RECONCILED', timestamp: stale }) },
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('stale_timestamp');
  });
});

describe('youpi checkout', () => {
  it('reports youpi availability through /payments/methods', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/payments/methods' });
    const body = res.json() as { pay: { youpi: { enabled: boolean; configured: boolean } } };
    expect(body.pay.youpi.enabled).toBe(true);
    expect(body.pay.youpi.configured).toBe(true);
  });

  it('creates a pending order and returns a hosted checkout URL', async () => {
    const order = await createPendingOrder();
    expect(order.checkoutUrl).toContain('/checkout/');
    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row!.status).toBe('pending');
    expect(row!.amountMinor).toBe(order.amountMinor);
    expect(row!.provider).toBe('upi');
    expect((row!.metadata as { provider?: string }).provider).toBe('youpi');
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/pay/youpi/checkout',
      payload: { planId: 'all-30' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('youpi webhook security', () => {
  it('rejects an invalid signature', async () => {
    const order = await createPendingOrder();
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId: 'bad-sig', timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', settlementState: 'RECONCILED' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/youpi',
      headers: signedHeaders(body, { event: 'RECONCILED', badSignature: true }),
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a body with no signature at all', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/youpi',
      headers: { 'content-type': 'application/json' },
      payload: '{"event":"RECONCILED"}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a stale timestamp (replay defence)', async () => {
    const order = await createPendingOrder();
    const stale = Date.now() - 10 * 60 * 1000;
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId: 'stale', timestamp: stale, orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', settlementState: 'RECONCILED' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/youpi',
      headers: signedHeaders(body, { event: 'RECONCILED', timestamp: stale }),
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong amount without settling', async () => {
    const order = await createPendingOrder();
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId: 'amount', timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor + 1, currency: 'INR', settlementState: 'RECONCILED' });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED' }), payload: body });
    expect(res.statusCode).toBe(409);
    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row!.status).toBe('pending');
  });

  it('rejects a wrong currency without settling', async () => {
    const order = await createPendingOrder();
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId: 'currency', timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'USD', settlementState: 'RECONCILED' });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED' }), payload: body });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an unknown order', async () => {
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId: 'unknown', timestamp: Date.now(), orderId: 'edy_does_not_exist', amountPaise: 100, currency: 'INR', settlementState: 'RECONCILED' });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED' }), payload: body });
    expect(res.statusCode).toBe(404);
  });

  it('records but never fulfils OBSERVED_SUCCESS', async () => {
    const order = await createPendingOrder();
    const deliveryId = 'obs-1';
    const body = JSON.stringify({ event: 'OBSERVED_SUCCESS', deliveryId, timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', settlementState: 'NOT_RECONCILED' });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'OBSERVED_SUCCESS', deliveryId }), payload: body });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ignored?: boolean }).ignored).toBe(true);
    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row!.status).toBe('pending');
    const subs = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.userId));
    expect(subs.some((s) => s.status === 'active')).toBe(false);
  });

  it('records but never fulfils MANUAL_REVIEW', async () => {
    const order = await createPendingOrder();
    const body = JSON.stringify({ event: 'MANUAL_REVIEW', deliveryId: 'mr-1', timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', settlementState: 'MANUAL_REVIEW' });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'MANUAL_REVIEW' }), payload: body });
    expect(res.statusCode).toBe(200);
    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row!.status).toBe('pending');
  });

  it('does not re-process a duplicate delivery id', async () => {
    const order = await createPendingOrder();
    const deliveryId = 'dup-1';
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId, timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', paymentId: order.gatewayPaymentId, settlementState: 'RECONCILED' });
    const first = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED', deliveryId }), payload: body });
    expect(first.statusCode).toBe(200);
    const second = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED', deliveryId }), payload: body });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { duplicate?: boolean }).duplicate).toBe(true);
  });

  it('rejects a bad signature even for a body it has already seen', async () => {
    const order = await createPendingOrder();
    const deliveryId = 'sig-over-dup';
    const body = JSON.stringify({ event: 'OBSERVED_SUCCESS', deliveryId, timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', settlementState: 'NOT_RECONCILED' });
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'OBSERVED_SUCCESS', deliveryId }), payload: body });
    expect(ok.statusCode).toBe(200);
    // Same bytes, forged signature: must be 401, never a "duplicate" 200.
    const forged = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/youpi',
      headers: signedHeaders(body, { event: 'OBSERVED_SUCCESS', deliveryId, badSignature: true }),
      payload: body,
    });
    expect(forged.statusCode).toBe(401);
  });

  it('fulfils the order on a valid RECONCILED event', async () => {
    const order = await createPendingOrder();
    const deliveryId = 'recon-1';
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId, timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', paymentId: order.gatewayPaymentId, utr: '123456789012', settlementState: 'RECONCILED' });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED', deliveryId }), payload: body });
    expect(res.statusCode).toBe(200);
    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row!.status).toBe('succeeded');
    expect(row!.paidAt).toBeTruthy();
    const subs = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.userId));
    expect(subs.some((s) => s.status === 'active')).toBe(true);
  });
});

describe('youpi webhook lifecycle', () => {
  it.each(['FAILED', 'EXPIRED', 'CANCELLED'] as const)(
    '%s closes a pending local payment without creating a subscription',
    async (event) => {
      const order = await createPendingOrder();
      const deliveryId = `lifecycle-${event.toLowerCase()}`;
      const body = JSON.stringify({
        event,
        deliveryId,
        timestamp: Date.now(),
        orderId: order.orderRef,
        amountPaise: order.amountMinor,
        currency: 'INR',
        settlementState: 'NOT_APPLICABLE',
      });

      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/payments/webhook/youpi',
        headers: signedHeaders(body, { event, deliveryId }),
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { localStatus?: string }).localStatus).toBe('failed');

      const db = getDb();
      const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
      expect(row!.status).toBe('failed');
      expect(row!.failureReason).toBe(`youpi_${event.toLowerCase()}`);
      expect(row!.subscriptionId).toBeNull();

      const [eventRow] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, deliveryId)).limit(1);
      expect(eventRow!.status).toBe('ignored');
    },
  );

  it('does not activate on OBSERVED_SUCCESS and activates only after RECONCILED', async () => {
    const order = await createPendingOrder();
    const observedBody = JSON.stringify({
      event: 'OBSERVED_SUCCESS',
      deliveryId: 'observed-before-reconcile',
      timestamp: Date.now(),
      orderId: order.orderRef,
      paymentId: order.gatewayPaymentId,
      amountPaise: order.amountMinor,
      currency: 'INR',
      settlementState: 'NOT_RECONCILED',
    });
    const observed = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/youpi',
      headers: signedHeaders(observedBody, { event: 'OBSERVED_SUCCESS', deliveryId: 'observed-before-reconcile' }),
      payload: observedBody,
    });
    expect(observed.statusCode).toBe(200);

    const db = getDb();
    const [afterObservation] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderRef, order.orderRef))
      .limit(1);
    expect(afterObservation!.status).toBe('pending');
    expect(afterObservation!.subscriptionId).toBeNull();

    const reconciledBody = JSON.stringify({
      event: 'RECONCILED',
      deliveryId: 'reconciled-after-observation',
      timestamp: Date.now(),
      orderId: order.orderRef,
      paymentId: order.gatewayPaymentId,
      amountPaise: order.amountMinor,
      currency: 'INR',
      utr: '123456789014',
      settlementState: 'RECONCILED',
    });
    const reconciled = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/youpi',
      headers: signedHeaders(reconciledBody, { event: 'RECONCILED', deliveryId: 'reconciled-after-observation' }),
      payload: reconciledBody,
    });
    expect(reconciled.statusCode).toBe(200);

    const [afterReconcile] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderRef, order.orderRef))
      .limit(1);
    expect(afterReconcile!.status).toBe('succeeded');
    expect(afterReconcile!.subscriptionId).toBeTruthy();
  });

  it('rejects a reconciled event that names a different gateway payment', async () => {
    const order = await createPendingOrder();
    const deliveryId = 'gateway-payment-mismatch';
    const body = JSON.stringify({
      event: 'RECONCILED',
      deliveryId,
      timestamp: Date.now(),
      orderId: order.orderRef,
      paymentId: 'yp_not_this_order',
      amountPaise: order.amountMinor,
      currency: 'INR',
      settlementState: 'RECONCILED',
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/youpi',
      headers: signedHeaders(body, { event: 'RECONCILED', deliveryId }),
      payload: body,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'GATEWAY_PAYMENT_MISMATCH' } });

    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row!.status).toBe('pending');
    const [eventRow] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, deliveryId)).limit(1);
    expect(eventRow!.status).toBe('ignored');
  });

  it('reprocesses a retry whose first attempt stopped before completion', async () => {
    const order = await createPendingOrder();
    const deliveryId = 'retry-after-partial-failure';
    await getDb().insert(webhookEvents).values({
      provider: 'youpi',
      eventId: deliveryId,
      eventType: 'RECONCILED',
      signatureValid: true,
      payloadHash: 'seeded-partial-failure',
      payload: {},
      status: 'received',
      note: 'simulated crash before processing',
    });

    const body = JSON.stringify({
      event: 'RECONCILED',
      deliveryId,
      timestamp: Date.now(),
      orderId: order.orderRef,
      paymentId: order.gatewayPaymentId,
      amountPaise: order.amountMinor,
      currency: 'INR',
      utr: '123456789013',
      settlementState: 'RECONCILED',
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/youpi',
      headers: signedHeaders(body, { event: 'RECONCILED', deliveryId }),
      payload: body,
    });
    expect(res.statusCode).toBe(200);

    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row!.status).toBe('succeeded');
    const [eventRow] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, deliveryId)).limit(1);
    expect(eventRow!.status).toBe('processed');
  });
});

describe('youpi checkout gating', () => {
  const flags = [
    { label: 'payments disabled, youpi disabled', payments: false, youpi: false, code: 'PAYMENTS_DISABLED' },
    { label: 'payments disabled, youpi enabled', payments: false, youpi: true, code: 'PAYMENTS_DISABLED' },
    { label: 'payments enabled, youpi disabled', payments: true, youpi: false, code: 'YOUPI_DISABLED' },
  ] as const;

  it.each(flags)('blocks $label without creating an order or gateway request', async ({ payments, youpi, code }) => {
    const rowsBefore = await userPaymentCount(user.userId);
    const requestsBefore = gatewayRequests;

    await withEnv({ PAYMENTS_ENABLED: payments, YOUPI_ENABLED: youpi }, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/payments/pay/youpi/checkout',
        headers: { cookie: user.cookie },
        payload: { planId: 'all-30' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: { code } });
    });

    expect(await userPaymentCount(user.userId)).toBe(rowsBefore);
    expect(gatewayRequests).toBe(requestsBefore);
  });

  it('blocks a fully flagged deployment when the gateway is not configured', async () => {
    const rowsBefore = await userPaymentCount(user.userId);
    const requestsBefore = gatewayRequests;

    await withEnv(
      { PAYMENTS_ENABLED: true, YOUPI_ENABLED: true, YOUPI_WEBHOOK_SECRET: undefined },
      async (app) => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/payments/pay/youpi/checkout',
          headers: { cookie: user.cookie },
          payload: { planId: 'all-30' },
        });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toMatchObject({ error: { code: 'GATEWAY_NOT_CONFIGURED' } });
      },
    );

    expect(await userPaymentCount(user.userId)).toBe(rowsBefore);
    expect(gatewayRequests).toBe(requestsBefore);
  });

  it('allows checkout only when both flags are on and the gateway is configured', async () => {
    const requestsBefore = gatewayRequests;
    const order = await createPendingOrder();
    expect(order.checkoutUrl).toContain('/checkout/');
    expect(gatewayRequests).toBe(requestsBefore + 1);
  });

  it('advertises YouPI checkout only when both flags are on', async () => {
    await withEnv({ PAYMENTS_ENABLED: false, YOUPI_ENABLED: true }, async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/subscriptions/plans' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        paymentsEnabled: boolean;
        youpi: { enabled: boolean; configured: boolean; available: boolean };
      };
      expect(body.paymentsEnabled).toBe(false);
      expect(body.youpi).toMatchObject({ enabled: true, configured: true, available: false });
    });

    await withEnv({ PAYMENTS_ENABLED: true, YOUPI_ENABLED: true }, async (app) => {
      const res = await app.inject({ method: 'GET', url: '/api/subscriptions/plans' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        paymentsEnabled: boolean;
        youpi: { enabled: boolean; configured: boolean; available: boolean };
      };
      expect(body.paymentsEnabled).toBe(true);
      expect(body.youpi).toMatchObject({ enabled: true, configured: true, available: true });
    });
  });
});

describe('youpi checkout availability', () => {
  const configured = {
    YOUPI_API_URL: 'https://pay-api.test/v1',
    YOUPI_MERCHANT_ID: '11111111-1111-1111-1111-111111111111',
    YOUPI_MERCHANT_KEY: 'mk_live_test_key',
    YOUPI_WEBHOOK_SECRET: 'test-secret',
  };

  it.each([
    { payments: false, youpi: false, expected: 'payments_disabled' },
    { payments: false, youpi: true, expected: 'payments_disabled' },
    { payments: true, youpi: false, expected: 'youpi_disabled' },
    { payments: true, youpi: true, expected: 'ok' },
  ] as const)(
    'PAYMENTS_ENABLED=$payments YOUPI_ENABLED=$youpi -> $expected',
    ({ payments, youpi, expected }) => {
      expect(
        youpiCheckoutAvailability({
          ...configured,
          PAYMENTS_ENABLED: payments,
          YOUPI_ENABLED: youpi,
        }),
      ).toBe(expected);
    },
  );

  it('reports not_configured when either switch is on but credentials are missing', () => {
    expect(
      youpiCheckoutAvailability({
        ...configured,
        PAYMENTS_ENABLED: true,
        YOUPI_ENABLED: true,
        YOUPI_WEBHOOK_SECRET: undefined,
      }),
    ).toBe('not_configured');
  });
});
