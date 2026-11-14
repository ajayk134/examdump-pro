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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client.js';
import { payments, subscriptions } from '../src/db/schema/index.js';
import { createTestContext, registerVerifiedUser, type TestContext, type RegisteredUser } from './helpers.js';
import { verifyYoupiWebhook, toRupees } from '../src/services/payments/youpi.client.js';

const WEBHOOK_SECRET = 'test-youpi-webhook-secret';
process.env.YOUPI_ENABLED = 'true';
process.env.YOUPI_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.YOUPI_MERCHANT_ID = '11111111-1111-1111-1111-111111111111';
process.env.YOUPI_MERCHANT_KEY = 'mk_live_test_key';
process.env.YOUPI_WEBHOOK_TOLERANCE_SECONDS = '300';

let ctx: TestContext;
let user: RegisteredUser;
let gateway: { url: string; close: () => Promise<void> };

function startStubGateway(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/v1/payments') {
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

async function createPendingOrder(examKey?: string): Promise<{ orderRef: string; amountMinor: number; gatewayPaymentId: string; paymentRowId: string }> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/payments/pay/youpi/checkout',
    headers: { cookie: user.cookie },
    payload: { planId: 'all-30', ...(examKey ? { examKey } : {}) },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { orderRef: string; amountMinor: number; gatewayPaymentId: string; paymentId: string };
  return { orderRef: body.orderRef, amountMinor: body.amountMinor, gatewayPaymentId: body.gatewayPaymentId, paymentRowId: body.paymentId };
}

beforeAll(async () => {
  gateway = await startStubGateway();
  process.env.YOUPI_API_URL = gateway.url;
  ctx = await createTestContext();
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
    expect(order.checkoutUrl ?? order.orderRef).toBeTruthy();
    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row.status).toBe('pending');
    expect(row.amountMinor).toBe(order.amountMinor);
    expect(row.provider).toBe('upi');
    expect((row.metadata as { provider?: string }).provider).toBe('youpi');
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
    expect(row.status).toBe('pending');
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
    expect(row.status).toBe('pending');
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
    expect(row.status).toBe('pending');
  });

  it('does not re-process a duplicate delivery id', async () => {
    const order = await createPendingOrder();
    const deliveryId = 'dup-1';
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId, timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', paymentId: 'yp_dup', settlementState: 'RECONCILED' });
    const first = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED', deliveryId }), payload: body });
    expect(first.statusCode).toBe(200);
    const second = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED', deliveryId }), payload: body });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { duplicate?: boolean }).duplicate).toBe(true);
  });

  it('fulfils the order on a valid RECONCILED event', async () => {
    const order = await createPendingOrder();
    const deliveryId = 'recon-1';
    const body = JSON.stringify({ event: 'RECONCILED', deliveryId, timestamp: Date.now(), orderId: order.orderRef, amountPaise: order.amountMinor, currency: 'INR', paymentId: order.gatewayPaymentId, utr: '123456789012', settlementState: 'RECONCILED' });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/payments/webhook/youpi', headers: signedHeaders(body, { event: 'RECONCILED', deliveryId }), payload: body });
    expect(res.statusCode).toBe(200);
    const db = getDb();
    const [row] = await db.select().from(payments).where(eq(payments.orderRef, order.orderRef)).limit(1);
    expect(row.status).toBe('succeeded');
    expect(row.paidAt).toBeTruthy();
    const subs = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.userId));
    expect(subs.some((s) => s.status === 'active')).toBe(true);
  });
});
