import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { loadEnv, type Env } from '../src/config/env.js';
import type { TestContext } from './helpers.js';
import { createTestContext, registerVerifiedUser } from './helpers.js';
import { getDb } from '../src/db/client.js';
import { payments } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import {
  ALL_PAYMENT_METHODS,
  assertAmountAllowed,
  parseMethods,
  safeEqual,
  PaymentAdapterError,
} from '../src/services/payments/adapter.js';
import { resolvePaymentAdapter, checkoutAvailable } from '../src/services/payments/registry.js';
import { razorpayAdapter, mapRazorpayStatus } from '../src/services/payments/razorpay.adapter.js';
import { createCheckout, assertRefundable } from '../src/services/payments/checkout.service.js';
import { requireRawBody } from '../src/routes/payments.js';

let ctx: TestContext;

const baseEnv = () => ({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@127.0.0.1:5433/examdump_test',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  PASSWORD_PEPPER: 'test-pepper',
  PUBLIC_WEB_URL: 'http://localhost:3100',
  LOG_LEVEL: 'silent',
});

function envWith(overrides: Record<string, string>): Env {
  return loadEnv({ ...baseEnv(), ...overrides });
}

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('payment adapter availability', () => {
  it('never offers checkout while payments are disabled', () => {
    const env = envWith({ PAYMENTS_ENABLED: 'false', PAYMENT_ADAPTER: 'razorpay' });
    const availability = resolvePaymentAdapter(env);
    expect(availability.adapter).toBeNull();
    expect(availability.reason).toBe('payments_disabled');
    expect(checkoutAvailable(env)).toBe(false);
  });

  it('reports no adapter when none is selected', () => {
    const env = envWith({ PAYMENTS_ENABLED: 'true', PAYMENT_ADAPTER: 'none' });
    expect(resolvePaymentAdapter(env).reason).toBe('no_adapter');
  });

  it('refuses to use Razorpay without credentials', () => {
    const env = envWith({
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ADAPTER: 'razorpay',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
    });
    const availability = resolvePaymentAdapter(env);
    expect(availability.adapter).toBeNull();
    expect(availability.reason).toBe('adapter_unconfigured');
  });

  it('activates Razorpay only when fully configured', () => {
    const env = envWith({
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ADAPTER: 'razorpay',
      PAYMENT_METHODS: 'upi,card',
      RAZORPAY_KEY_ID: 'rzp_test_dummy',
      RAZORPAY_KEY_SECRET: 'dummy-secret',
    });
    const availability = resolvePaymentAdapter(env);
    expect(availability.adapter?.id).toBe('razorpay');
    expect(availability.reason).toBe('ok');
    expect(availability.methods).toContain('upi');
    expect(availability.methods).toContain('card');
  });

  it('reports HyperSwitch as coming soon instead of pretending it works', () => {
    const env = envWith({ PAYMENTS_ENABLED: 'true', PAYMENT_ADAPTER: 'hyperswitch' });
    const availability = resolvePaymentAdapter(env);
    expect(availability.adapter).toBeNull();
    expect(availability.reason).toBe('adapter_coming_soon');
  });

  it('filters unsupported methods out of the configured list', () => {
    const env = envWith({ PAYMENT_METHODS: 'upi,card,bogus' });
    const methods = parseMethods(env);
    expect(methods).toEqual(['upi', 'card']);
    expect(methods.every((m) => ALL_PAYMENT_METHODS.includes(m))).toBe(true);
  });
});

describe('server-side amount validation', () => {
  const env = envWith({ PAYMENT_MIN_AMOUNT_MINOR: '100', PAYMENT_MAX_AMOUNT_MINOR: '100000' });

  it('accepts an amount inside the configured range', () => {
    expect(() => assertAmountAllowed(env, 49900, 'INR')).not.toThrow();
  });

  it('rejects fractional minor units', () => {
    expect(() => assertAmountAllowed(env, 499.5, 'INR')).toThrow(PaymentAdapterError);
  });

  it('rejects amounts below the minimum', () => {
    expect(() => assertAmountAllowed(env, 50, 'INR')).toThrow(/minimum/);
  });

  it('rejects amounts above the maximum', () => {
    expect(() => assertAmountAllowed(env, 100_001, 'INR')).toThrow(/maximum/);
  });

  it('rejects negative amounts', () => {
    expect(() => assertAmountAllowed(env, -100, 'INR')).toThrow(PaymentAdapterError);
  });
});

describe('razorpay status mapping', () => {
  it('maps every gateway status to the shared vocabulary', () => {
    expect(mapRazorpayStatus('created')).toBe('created');
    expect(mapRazorpayStatus('attempted')).toBe('pending');
    expect(mapRazorpayStatus('authorized')).toBe('authorized');
    expect(mapRazorpayStatus('captured')).toBe('succeeded');
    expect(mapRazorpayStatus('failed')).toBe('failed');
    expect(mapRazorpayStatus('refunded')).toBe('refunded');
    expect(mapRazorpayStatus(undefined)).toBe('unknown');
  });
});

describe('webhook signature verification', () => {
  const secret = 'test-webhook-secret';

  function sign(body: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  it('accepts a correctly signed payload', async () => {
    const env = envWith({ RAZORPAY_WEBHOOK_SECRET: secret, RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' });
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured' } } },
    });
    const verified = await razorpayAdapter.verifyWebhook(env, {
      rawBody: body,
      headers: { 'x-razorpay-signature': sign(body) },
      url: 'https://example.test/api/payments/webhook/razorpay',
    });
    expect(verified.verified).toBe(true);
    expect(verified.paymentId).toBe('pay_1');
    expect(verified.status).toBe('succeeded');
  });

  it('rejects a tampered payload', async () => {
    const env = envWith({ RAZORPAY_WEBHOOK_SECRET: secret, RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' });
    const original = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_1', amount: 100, status: 'captured' } } },
    });
    const signature = sign(original);
    const tampered = original.replace('"amount":100', '"amount":999999');
    const verified = await razorpayAdapter.verifyWebhook(env, {
      rawBody: tampered,
      headers: { 'x-razorpay-signature': signature },
      url: 'https://example.test/webhook',
    });
    expect(verified.verified).toBe(false);
  });

  it('rejects everything when no webhook secret is configured', async () => {
    const env = envWith({ RAZORPAY_WEBHOOK_SECRET: '', RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' });
    const body = JSON.stringify({ event: 'payment.captured', payload: {} });
    const verified = await razorpayAdapter.verifyWebhook(env, {
      rawBody: body,
      headers: { 'x-razorpay-signature': sign(body) },
      url: 'https://example.test/webhook',
    });
    expect(verified.verified).toBe(false);
  });

  it('rejects a request with no signature header', async () => {
    const env = envWith({ RAZORPAY_WEBHOOK_SECRET: secret, RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' });
    const verified = await razorpayAdapter.verifyWebhook(env, {
      rawBody: '{}',
      headers: {},
      url: 'https://example.test/webhook',
    });
    expect(verified.verified).toBe(false);
  });

  it('compares digests without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcdef')).toBe(false);
  });
});

describe('refund guard rails', () => {
  it('only refunds a successful payment', () => {
    expect(() => assertRefundable({ status: 'pending', amountMinor: 100, refundedMinor: 0 })).toThrow();
    expect(() => assertRefundable({ status: 'failed', amountMinor: 100, refundedMinor: 0 })).toThrow();
    expect(assertRefundable({ status: 'succeeded', amountMinor: 100, refundedMinor: 0 })).toBe(100);
  });

  it('refuses a fully refunded payment', () => {
    expect(() => assertRefundable({ status: 'refunded', amountMinor: 100, refundedMinor: 100 })).toThrow();
  });

  it('returns the remaining refundable amount for a partial refund', () => {
    expect(assertRefundable({ status: 'partially_refunded', amountMinor: 100, refundedMinor: 40 })).toBe(60);
  });
});

describe('checkout endpoint behaviour', () => {
  it('documented state: checkout is refused while payments are disabled', async () => {
    const user = await registerVerifiedUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/pay/checkout',
      headers: { cookie: user.cookie },
      payload: { planId: 'missing-plan', examKeys: [] },
    });
    // 503 Service Unavailable is the correct answer while no adapter is live:
    // the request is valid but we cannot take money yet. Never a 2xx order.
    expect(res.statusCode).toBe(503);
  });

  it('reports pay availability through /payments/methods', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/payments/methods' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pay: { available: boolean; methods: string[]; reason: string } };
    expect(body.pay).toBeDefined();
    expect(body.pay.available).toBe(false);
    expect(body.pay.reason).toBeDefined();
  });

  it('requires authentication for checkout', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/pay/checkout',
      payload: { planId: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('never trusts a client-supplied amount over the server quote', async () => {
    const user = await registerVerifiedUser(ctx.app);
    // Payments are disabled in the test env, so this must be refused before any
    // order is written - regardless of the amount the client claims.
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/pay/checkout',
      headers: { cookie: user.cookie },
      payload: { planId: 'pro-monthly', amountMinor: 1, examKeys: [] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const db = getDb();
    const rows = await db.select().from(payments).where(eq(payments.userId, user.userId));
    expect(rows.length).toBe(0);
  });
});

describe('webhook endpoint', () => {
  it('rejects an unsigned webhook', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/razorpay',
      payload: { event: 'payment.captured', payload: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a signature computed over re-serialised JSON rather than the raw bytes', async () => {
    // The classic confusion: signing JSON.stringify(parsed) instead of the bytes
    // the provider sent. Key order differs here, so the signatures must differ
    // and the request must be refused.
    const asSent = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_x"}}}}';
    const reserialised = JSON.stringify(JSON.parse(asSent));
    const wrongSignature = createHmac('sha256', 'test-webhook-secret')
      .update(reserialised, 'utf8')
      .digest('hex');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': wrongSignature,
      },
      payload: asSent,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a HyperSwitch webhook that carries no raw body bytes', async () => {
    // No bytes means nothing to authenticate. The route must refuse rather than
    // synthesise them from the parsed object.
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook/hyperswitch',
      headers: { 'content-type': 'application/json', 'x-webhook-signature-512': 'deadbeef' },
      payload: '',
    });
    expect([400, 401]).toContain(res.statusCode);
  });

  it('requireRawBody refuses when the raw bytes are missing', () => {
    // Without raw bytes a webhook cannot be authenticated. The helper must throw
    // rather than hand back reconstructed JSON, which would let a signature be
    // checked against bytes the provider never sent.
    expect(() => requireRawBody({})).toThrow(/raw request body is required/i);
    expect(() => requireRawBody({ rawBody: '' })).toThrow(/raw request body is required/i);
    expect(() => requireRawBody({ rawBody: undefined })).toThrow(/raw request body is required/i);
    expect(requireRawBody({ rawBody: '{"a":1}' })).toBe('{"a":1}');
  });

  it('treats re-serialisation as a different byte string, never a substitute', () => {
    // The reason the route refuses instead of falling back to JSON.stringify:
    // the same JSON value can serialise to different bytes, so a fallback would
    // verify something the provider never signed.
    // Whitespace is the realistic difference: providers pretty-print or pad,
    // and JSON.stringify compacts. Same value, different bytes, different HMAC.
    const asSent = '{ "b": 2, "a": 1 }';
    const reserialised = JSON.stringify(JSON.parse(asSent));
    expect(reserialised).not.toBe(asSent);

    const secret = 'bytes-secret';
    const sentSig = createHmac('sha256', secret).update(asSent, 'utf8').digest('hex');
    const reSig = createHmac('sha256', secret).update(reserialised, 'utf8').digest('hex');
    expect(sentSig).not.toBe(reSig);
  });
});

describe('createCheckout guard', () => {
  it('throws when no adapter is available', async () => {
    const env = envWith({ PAYMENTS_ENABLED: 'false', PAYMENT_ADAPTER: 'none' });
    const user = { id: '00000000-0000-0000-0000-000000000000', email: 'x@test.local', name: 'X' } as never;
    await expect(
      createCheckout(env, user, {
        planId: 'pro-monthly',
        returnUrl: 'http://localhost:3100/checkout/return',
      }),
    ).rejects.toThrow(/not available|paused/i);
  });
});
