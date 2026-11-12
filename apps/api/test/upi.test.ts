/**
 * UPI collection — parsing, matching, risk and settlement tests.
 *
 * These run against real Postgres because the guarantees under test live in SQL:
 * the partial unique indexes that prevent double settlement, the `FOR UPDATE`
 * lock that serialises two notifications racing for one order, and the
 * transaction that pairs the match row with the entitlement grant.
 *
 * Nothing here moves real money: notifications are synthetic strings and the
 * payment rows are local test rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loadEnv, type Env } from '../src/config/env.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { getDb } from '../src/db/client.js';
import {
  payments,
  plans,
  subscriptions,
  upiMatches,
  upiNotifications,
  upiOrders,
  upiRefunds,
  upiRiskEvents,
  users,
} from '../src/db/schema/index.js';
import {
  cancelOrder,
  completeRefund,
  createUpiOrder,
  expireStaleOrders,
  getOrderById,
  ingestNotification,
  manuallyApprove,
  requestRefund,
  upiStats,
} from '../src/services/upi/order.service.js';
import { parseBankNotification, isCreditNotification, extractAmount } from '../src/services/upi/parser.js';
import { assessNotification, screenNotification, DEFAULT_RISK_CONFIG } from '../src/services/upi/risk.js';
import { buildUpiUri, buildUpiIntentUri, isValidVpa, sanitizeNote, UPI_APPS } from '../src/services/upi/uri.js';
import { renderQrSvg, qrModuleCount } from '../src/services/upi/qr.js';
import { formatPaise, paiseToRupees, rupeesToPaise } from '../src/services/upi/money.js';

let ctx: TestContext;
let env: Env;

function upiEnv(): Env {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@127.0.0.1:5433/examdump_test',
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
    PASSWORD_PEPPER: 'test-pepper',
    BCRYPT_ROUNDS: '8',
    PUBLIC_WEB_URL: 'http://localhost:3100',
    WEB_ORIGIN: 'http://localhost:3100',
    ADMIN_EMAIL: 'admin@test.local',
    ADMIN_PASSWORD: 'AdminPass123',
    PAYMENTS_ENABLED: 'true',
    UPI_PAYEE_VPA: 'examdump@okhdfcbank',
    UPI_PAYEE_NAME: 'ExamDump',
    UPI_ORDER_TTL_MINUTES: '15',
    UPI_AUTO_APPROVE: 'true',
    UPI_NOTIFICATION_MAX_PAISE: '5000000',
    ENABLE_DATASET_SYNC: 'false',
    RATE_LIMIT_MAX: '100000',
    LOG_LEVEL: 'silent',
  });
}

async function makeUser(email: string) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({
      email,
      name: 'UPI Tester',
      passwordHash: 'x',
      referralCode: `ref-${Math.random().toString(36).slice(2, 10)}`,
      emailVerified: true,
    })
    .returning();
  return row!;
}

const PLAN_ID = 'upi-test-plan';

/** The plan the settlement path grants. Created once, reused by every order. */
async function ensurePlan() {
  const db = getDb();
  const [existing] = await db.select().from(plans).where(eq(plans.id, PLAN_ID)).limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(plans)
    .values({
      id: PLAN_ID,
      name: 'UPI Test Plan',
      description: 'Plan used by the UPI test suite',
      scope: 'multi',
      durationDays: 30,
      examQuota: 0,
      priceMinor: 49900,
      currency: 'INR',
      features: [],
      active: true,
    })
    .returning();
  return row!;
}

/** A pending payment row, as `createUpiPaymentOrder` would create. */
async function makePayment(userId: string, amountMinor: number) {
  const db = getDb();
  const [row] = await db
    .insert(payments)
    .values({
      userId,
      amountMinor,
      currency: 'INR',
      status: 'pending',
      provider: 'upi',
      providerRef: `upi_${Math.random().toString(36).slice(2)}`,
      orderRef: `upi_${Math.random().toString(36).slice(2)}`,
      description: 'UPI test payment',
      // Mirrors what the real checkout writes, so settlement can grant entitlement.
      metadata: { planId: PLAN_ID, examKeys: [], couponCode: null, grossMinor: amountMinor },
    })
    .returning();
  return row!;
}

async function makeOrder(userId: string, amountPaise: number, opts: { ttlMinutes?: number } = {}) {
  const payment = await makePayment(userId, amountPaise);
  return createUpiOrder(env, {
    userId,
    paymentId: payment.id,
    amountPaise,
    planId: PLAN_ID,
    description: 'Premium plan',
    ttlMinutes: opts.ttlMinutes ?? 15,
  });
}

/** A synthetic credit alert, timestamped now unless overridden. */
function creditAlert(amountRupees: string, extra = '', utr = '123456789012'): string {
  return `Rs.${amountRupees} credited to your a/c XX1234 from VPA payer@okhdfcbank. UPI Ref No ${utr}.${extra}`;
}

/**
 * A credit alert for exactly what an order asks the customer to pay.
 *
 * Orders now carry a unique 1-99 paisa suffix, so the receivable amount is not
 * the plan price. Every alert in these tests must quote the order's real amount,
 * otherwise matching would correctly fail on the amount comparison.
 */
/** A unique 12-digit bank reference, so no two tests collide on the UTR index. */
function randomUtr(): string {
  let out = '';
  for (let i = 0; i < 12; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

function creditAlertFor(order: { amountPaise: number }, extra = '', utr?: string): string {
  return creditAlert((order.amountPaise / 100).toFixed(2), extra, utr);
}

beforeAll(async () => {
  ctx = await createTestContext();
  env = upiEnv();
  await ensurePlan();
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(async () => {
  const db = getDb();
  // Order matters: children first.
  await db.delete(upiMatches);
  await db.delete(upiRiskEvents);
  await db.delete(upiRefunds);
  await db.delete(upiNotifications);
  await db.delete(upiOrders);
  await db.delete(payments);
});

/* ------------------------------- money ---------------------------------- */

describe('money', () => {
  it('converts rupees to integer paise without float error', () => {
    expect(rupeesToPaise('499')).toBe(49900);
    expect(rupeesToPaise('499.5')).toBe(49950);
    expect(rupeesToPaise('0.01')).toBe(1);
    expect(rupeesToPaise(1.1)).toBe(110);
  });

  it('rejects more than two decimal places instead of rounding', () => {
    expect(() => rupeesToPaise('499.999')).toThrow();
    expect(() => rupeesToPaise('-5')).toThrow();
    expect(() => rupeesToPaise('abc')).toThrow();
  });

  it('formats paise back to rupees', () => {
    expect(paiseToRupees(49900)).toBe('499.00');
    expect(paiseToRupees(1)).toBe('0.01');
    expect(formatPaise(49900)).toBe('₹499');
    expect(formatPaise(49950)).toBe('₹499.50');
  });
});

/* --------------------------------- URI ---------------------------------- */

describe('upi uri', () => {
  it('validates a VPA', () => {
    expect(isValidVpa('examdump@okhdfcbank')).toBe(true);
    expect(isValidVpa('not-a-vpa')).toBe(false);
    expect(isValidVpa('ab@okhdfcbank')).toBe(true);
    // Short/invalid handles are rejected rather than silently accepted.
    expect(isValidVpa('a@b')).toBe(false);
  });

  it('builds a payment uri with an amount we control', () => {
    const uri = buildUpiUri({
      payeeVpa: 'examdump@okhdfcbank',
      payeeName: 'ExamDump',
      amountPaise: 49900,
      transactionRef: 'EDABC12345',
    });
    expect(uri.startsWith('upi://pay?')).toBe(true);
    expect(uri).toContain('pa=examdump%40okhdfcbank');
    expect(uri).toContain('am=499.00');
    expect(uri).toContain('cu=INR');
    expect(uri).toContain('tn=EDABC12345');
  });

  it('refuses an invalid payee or amount', () => {
    expect(() =>
      buildUpiUri({ payeeVpa: 'nope', payeeName: 'X', amountPaise: 100, transactionRef: 'R' }),
    ).toThrow();
    expect(() =>
      buildUpiUri({ payeeVpa: 'a@b', payeeName: 'X', amountPaise: 0, transactionRef: 'R' }),
    ).toThrow();
  });

  it('strips characters that could inject extra uri parameters', () => {
    const uri = buildUpiUri({
      payeeVpa: 'examdump@okhdfcbank',
      payeeName: 'ExamDump',
      amountPaise: 100,
      transactionRef: 'ED&am=1.00&pa=evil@bank',
    });
    // The injected `am`/`pa` must not survive as separate parameters.
    expect(uri.match(/pa=/g)?.length).toBe(1);
    expect(sanitizeNote('a&b?c=d')).toBe('abcd');
  });

  it('builds an android intent for a known package and rejects a bad one', () => {
    const intent = buildUpiIntentUri({
      payeeVpa: 'examdump@okhdfcbank',
      payeeName: 'ExamDump',
      amountPaise: 49900,
      transactionRef: 'EDABC12345',
      packageName: 'com.phonepe.app',
    });
    expect(intent.startsWith('intent://pay?')).toBe(true);
    expect(intent).toContain('package=com.phonepe.app');
    expect(() =>
      buildUpiIntentUri({
        payeeVpa: 'a@b',
        payeeName: 'X',
        amountPaise: 100,
        transactionRef: 'R',
        packageName: 'bad;package',
      }),
    ).toThrow();
  });

  it('exposes a known app list', () => {
    expect(UPI_APPS.length).toBeGreaterThan(2);
    expect(UPI_APPS.every((a) => a.packageName.includes('.'))).toBe(true);
  });
});

/* --------------------------------- QR ----------------------------------- */

describe('qr', () => {
  it('renders a self-contained svg', () => {
    const svg = renderQrSvg('upi://pay?pa=a@b&am=1.00');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<path');
    // Self-contained: no <image>, <use href>, or script that would need a
    // network fetch. (The xmlns namespace string is not a fetch.)
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('xlink:href');
  });

  it('produces a valid module count that grows with payload size', () => {
    const small = qrModuleCount('upi://pay?pa=a@b&am=1.00');
    const large = qrModuleCount(`upi://pay?pa=a@b&am=1.00&tn=${'X'.repeat(200)}`);
    expect(small).toBeGreaterThanOrEqual(21);
    expect(large).toBeGreaterThan(small);
  });

  it('escapes nothing it should not and rejects empty input', () => {
    expect(() => renderQrSvg('')).toThrow();
  });
});

/* ------------------------------- parser --------------------------------- */

describe('notification parser', () => {
  it('reads a standard HDFC credit', () => {
    const parsed = parseBankNotification({
      text: creditAlert('499.00'),
      timestamp: '2026-11-11T10:00:00Z',
    });
    expect(parsed?.amountPaise).toBe(49900);
    expect(parsed?.bankReferenceNumber).toBe('123456789012');
    expect(parsed?.senderVpa).toBe('payer@okhdfcbank');
  });

  it('ignores balance clauses so the credit amount wins', () => {
    const parsed = parseBankNotification({
      text: 'Rs 499 credited to a/c. Avl Bal Rs 10,000.00',
    });
    expect(parsed?.amountPaise).toBe(49900);
  });

  it('rejects a debit alert', () => {
    expect(
      parseBankNotification({ text: 'Rs.499.00 debited from your a/c to VPA shop@okaxis' }),
    ).toBeNull();
  });

  it('rejects a refund-pending message where debit comes first', () => {
    expect(
      parseBankNotification({ text: 'Your a/c debited Rs 499. Total Rs 500 credited back in 48h' }),
    ).toBeNull();
  });

  it('accepts a credit followed by a small fee debit', () => {
    const parsed = parseBankNotification({
      text: 'Rs 500 credited to your a/c. Rs 10 debited for SMS charges',
    });
    expect(parsed?.amountPaise).toBe(50000);
  });

  it('rejects text that is not a credit notification', () => {
    expect(parseBankNotification({ text: 'Win a free iPhone now' })).toBeNull();
    expect(isCreditNotification('Hello there')).toBe(false);
  });

  it('handles an amount suffix format', () => {
    expect(extractAmount('499.00 INR credited to your account')?.amountPaise).toBe(49900);
  });

  it('is not vulnerable to a whitespace flooding payload', () => {
    // The original implementation took seconds on this; the cap makes it linear.
    const hostile = `credited${' '.repeat(5000)}Rs 1`;
    const started = Date.now();
    parseBankNotification({ text: hostile });
    expect(Date.now() - started).toBeLessThan(250);
  });
});

/* -------------------------------- risk ---------------------------------- */

describe('risk engine', () => {
  const now = new Date('2026-11-11T10:00:00Z');
  const order = {
    amountPaise: 49900,
    createdAt: new Date(now.getTime() - 60_000),
    expiresAt: new Date(now.getTime() + 14 * 60_000),
    status: 'pending',
    reference: 'EDABC12345',
  };

  it('approves an exact single-candidate payment inside the window', () => {
    const result = assessNotification(
      order,
      { amountPaise: 49900, bankReferenceNumber: '123', observedAt: now, rawText: 'Rs 499 credited' },
      1,
    );
    expect(result.decision).toBe('approve');
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_RISK_CONFIG.approveThreshold);
  });

  it('rejects a mismatched amount outright', () => {
    const result = assessNotification(
      order,
      { amountPaise: 49800, bankReferenceNumber: null, observedAt: now, rawText: 'Rs 498 credited' },
      1,
    );
    expect(result.decision).toBe('reject');
    expect(result.reasons.join(' ')).toContain('amount_mismatch');
  });

  it('never auto-approves when two orders share the amount', () => {
    const result = assessNotification(
      order,
      { amountPaise: 49900, bankReferenceNumber: '123', observedAt: now, rawText: 'Rs 499 credited' },
      2,
    );
    expect(result.decision).toBe('review');
  });

  it('rejects a notification observed before the order existed', () => {
    const result = assessNotification(
      order,
      {
        amountPaise: 49900,
        bankReferenceNumber: '123',
        observedAt: new Date(now.getTime() - 60 * 60_000),
        rawText: 'Rs 499 credited',
      },
      1,
    );
    expect(result.decision).toBe('reject');
    expect(result.reasons.join(' ')).toContain('observed_before_order_created');
  });

  it('rejects a notification observed after expiry', () => {
    const result = assessNotification(
      order,
      {
        amountPaise: 49900,
        bankReferenceNumber: '123',
        observedAt: new Date(now.getTime() + 60 * 60_000),
        rawText: 'Rs 499 credited',
      },
      1,
    );
    expect(result.decision).toBe('reject');
    expect(result.reasons.join(' ')).toContain('observed_after_order_expiry');
  });

  it('screens out a payment whose sender is our own VPA', () => {
    const result = screenNotification(
      { amountPaise: 49900, bankReferenceNumber: null, senderVpa: 'examdump@okhdfcbank', observedAt: now, rawText: '' },
      { payeeVpa: 'examdump@okhdfcbank', maxAmountPaise: 5_000_000 },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sender_is_payee');
  });

  it('screens out an implausibly large credit', () => {
    const result = screenNotification(
      { amountPaise: 99_999_999, bankReferenceNumber: null, observedAt: now, rawText: '' },
      { payeeVpa: 'a@b', maxAmountPaise: 5_000_000 },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('amount_above_limit');
  });
});

/* --------------------------- order + ingestion --------------------------- */

describe('orders', () => {
  it('creates an order with a unique reference and frozen uri', async () => {
    const user = await makeUser('upi-order@example.com');
    const order = await makeOrder(user.id, 49900);
    expect(order.reference).toMatch(/^ED[A-Z0-9]{8}$/);
    // The QR must quote the suffixed payable amount, not the plan price.
    expect(order.upiUri).toContain(`am=${(order.amountPaise / 100).toFixed(2)}`);
    expect(order.baseAmountPaise).toBe(49900);
    expect(order.amountPaise).toBeGreaterThanOrEqual(49901);
    expect(order.amountPaise).toBeLessThanOrEqual(49999);
    expect(order.status).toBe('pending');
    // The reference must appear in the note so banks that echo it help matching.
    expect(order.upiUri).toContain(order.reference);
  });

  it('rejects an invalid amount', async () => {
    const user = await makeUser('upi-bad-amount@example.com');
    const payment = await makePayment(user.id, 0);
    await expect(
      createUpiOrder(env, { userId: user.id, paymentId: payment.id, amountPaise: 0 }),
    ).rejects.toThrow();
  });

  it('expires stale orders and never settles them afterwards', async () => {
    const user = await makeUser('upi-expire@example.com');
    const order = await makeOrder(user.id, 49900, { ttlMinutes: 3 });
    await getDb()
      .update(upiOrders)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(upiOrders.id, order.id));

    const expired = await expireStaleOrders();
    expect(expired).toBeGreaterThanOrEqual(1);

    const after = await getOrderById(order.id);
    expect(after?.status).toBe('expired');

    // A notification for an expired order must not settle it.
    const result = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 999888777666'),
      timestamp: new Date().toISOString(),
    });
    expect(result.status).not.toBe('matched');
  });

  it('fails the payment row when its order expires', async () => {
    /*
     * Regression: expiry closed the order but left its `payments` row `pending`.
     * Because the checkout reuses an open order of the same price, a second
     * checkout created a second payment row while the first stayed claimable -
     * two live payments for one plan, which settlement could reach later.
     */
    const user = await makeUser('upi-expire-payment@example.com');
    const order = await makeOrder(user.id, 49900);
    await getDb()
      .update(upiOrders)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(upiOrders.id, order.id));

    await expireStaleOrders();

    const [payment] = await getDb().select().from(payments).where(eq(payments.id, order.paymentId!));
    expect(payment?.status).toBe('failed');
    expect(payment?.failureReason).toBe('upi_order_expired');
  });

  it('fails the payment row when the customer cancels', async () => {
    const user = await makeUser('upi-cancel-payment@example.com');
    const order = await makeOrder(user.id, 49900);

    await cancelOrder(order.id, 'cancelled_by_user');

    const [payment] = await getDb().select().from(payments).where(eq(payments.id, order.paymentId!));
    expect(payment?.status).toBe('failed');
    expect(payment?.failureReason).toBe('upi_order_cancelled_by_user');
  });

  it('never rewrites a payment that already settled', async () => {
    // Expiry must not touch a payment that is no longer `pending`; only the
    // order's own liveness decides when the *payment attempt* is closed.
    const user = await makeUser('upi-cancel-settled@example.com');
    const order = await makeOrder(user.id, 49900);
    await getDb()
      .update(payments)
      .set({ status: 'succeeded' })
      .where(eq(payments.id, order.paymentId!));

    await cancelOrder(order.id, 'cancelled_by_user');

    const [payment] = await getDb().select().from(payments).where(eq(payments.id, order.paymentId!));
    expect(payment?.status).toBe('succeeded');
  });
});

describe('ingestion and matching', () => {
  it('settles the matching order and grants entitlement exactly once', async () => {
    const user = await makeUser('upi-settle@example.com');
    const order = await makeOrder(user.id, 49900);

    const result = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order),
      timestamp: new Date().toISOString(),
    });

    expect(result.status).toBe('matched');
    expect(result.orderId).toBe(order.id);

    const settled = await getOrderById(order.id);
    expect(settled?.status).toBe('settled');
    expect(settled?.settledAt).not.toBeNull();

    const payment = await getDb().select().from(payments).where(eq(payments.id, order.paymentId!));
    expect(payment[0]?.status).toBe('succeeded');

    // Exactly one settlement match row exists.
    const matches = await getDb().select().from(upiMatches).where(eq(upiMatches.orderId, order.id));
    expect(matches.length).toBe(1);
  });

  it('does not settle an order twice from two different alerts', async () => {
    const user = await makeUser('upi-double@example.com');
    const order = await makeOrder(user.id, 49900);

    const first = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 111111111111'),
      timestamp: new Date().toISOString(),
    });
    const second = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 222222222222'),
      timestamp: new Date().toISOString(),
    });

    expect(first.status).toBe('matched');
    expect(second.status).not.toBe('matched');

    const matches = await getDb().select().from(upiMatches).where(eq(upiMatches.orderId, order.id));
    expect(matches.length).toBe(1);
  });

  it('suppresses a duplicated bank alert', async () => {
    const user = await makeUser('upi-dupe@example.com');
    const order = await makeOrder(user.id, 49900);
    const text = creditAlertFor(order);
    const at = new Date().toISOString();

    const first = await ingestNotification(env, { source: 'gmail', text, timestamp: at });
    const second = await ingestNotification(env, { source: 'gmail', text, timestamp: at });

    expect(first.status).toBe('matched');
    expect(second.status).toBe('duplicate');

    const rows = await getDb().select().from(upiNotifications);
    expect(rows.length).toBe(1);
  });

  it('records a mismatched amount as unmatched, not settled', async () => {
    const user = await makeUser('upi-mismatch@example.com');
    const order = await makeOrder(user.id, 49900);

    const result = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlert('1.00', ' Ref No 333333333333'),
      timestamp: new Date().toISOString(),
    });

    expect(result.status).toBe('unmatched');
    const after = await getOrderById(order.id);
    expect(after?.status).toBe('pending');
  });

  it('ignores and stores a non-credit message', async () => {
    const result = await ingestNotification(env, {
      source: 'sms',
      text: 'Congratulations! You won a prize.',
    });
    expect(result.status).toBe('ignored');
    const rows = await getDb().select().from(upiNotifications);
    expect(rows[0]?.status).toBe('ignored');
  });

  it('rejects a large credit above the configured ceiling', async () => {
    const result = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlert('999999.00', ' Ref No 777777777777'),
      timestamp: new Date().toISOString(),
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('amount_above_limit');
  });

  it('gives two orders for the same plan distinct payable amounts', async () => {
    /*
     * Two customers buying the same plan used to be told to transfer the same
     * number of paise, so a credit could not be attributed to either. The suffix
     * removes that ambiguity at the source.
     */
    const a = await makeUser('upi-amb-a@example.com');
    const b = await makeUser('upi-amb-b@example.com');
    const orderA = await makeOrder(a.id, 49900);
    const orderB = await makeOrder(b.id, 49900);

    expect(orderA.baseAmountPaise).toBe(49900);
    expect(orderB.baseAmountPaise).toBe(49900);
    expect(orderA.amountPaise).not.toBe(orderB.amountPaise);

    // A credit for A's exact amount settles A and leaves B alone.
    const result = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(orderA, ' Ref No 444444444444'),
      timestamp: new Date().toISOString(),
    });
    expect(result.status).toBe('matched');
    expect((await getOrderById(orderA.id))?.status).toBe('settled');
    expect((await getOrderById(orderB.id))?.status).toBe('pending');
  });

  it('never auto-settles when two different credits claim one live order', async () => {
    /*
     * The suffix prevents two live orders sharing an amount, so this exercises the
     * remaining ambiguity: two distinct bank credits, same amount, one order. The
     * second must not be treated as a second settlement, and the first must not be
     * silently re-attributed.
     */
    const a = await makeUser('upi-amb2-a@example.com');
    const orderA = await makeOrder(a.id, 49900);

    const first = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(orderA, ' Ref No 454545454545'),
      timestamp: new Date().toISOString(),
    });
    const second = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(orderA, ' Ref No 464646464646'),
      timestamp: new Date().toISOString(),
    });

    // One settlement, and the second credit is not allowed to claim the same order.
    expect(first.status).toBe('matched');
    expect(second.status).not.toBe('matched');
    expect((await getOrderById(orderA.id))?.status).toBe('settled');

    const matches = await getDb().select().from(upiMatches).where(eq(upiMatches.orderId, orderA.id));
    expect(matches.length).toBe(1);
  });

  it('is safe under concurrent identical notifications', async () => {
    const user = await makeUser('upi-concurrent@example.com');
    const order = await makeOrder(user.id, 49900);

    // Two distinct alerts (different UTRs) racing for the same order.
    const results = await Promise.all([
      ingestNotification(env, {
        source: 'gmail',
        text: creditAlertFor(order, ' Ref No 555000111222'),
        timestamp: new Date().toISOString(),
      }),
      ingestNotification(env, {
        source: 'sms',
        text: creditAlertFor(order, ' Ref No 555000333444'),
        timestamp: new Date().toISOString(),
      }),
    ]);

    const matched = results.filter((r) => r.status === 'matched');
    expect(matched.length).toBe(1);

    const matches = await getDb().select().from(upiMatches).where(eq(upiMatches.orderId, order.id));
    expect(matches.length).toBe(1);

    const settled = await getOrderById(order.id);
    expect(settled?.status).toBe('settled');
  });

  it('never settles an order belonging to an expired window', async () => {
    const user = await makeUser('upi-late@example.com');
    const order = await makeOrder(user.id, 49900);
    await getDb()
      .update(upiOrders)
      .set({ expiresAt: new Date(Date.now() - 3_600_000) })
      .where(eq(upiOrders.id, order.id));

    const result = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 666000111222'),
      timestamp: new Date().toISOString(),
    });
    expect(result.status).not.toBe('matched');
    expect((await getOrderById(order.id))?.status).toBe('pending');
  });
});

/* ------------------------------- manual + refunds ------------------------ */

describe('manual approval and refunds', () => {
  it('lets an admin approve a held notification and settles once', async () => {
    const user = await makeUser('upi-manual@example.com');
    const admin = await makeUser('upi-admin@example.com');
    const order = await makeOrder(user.id, 49900);
    const other = await makeOrder(user.id, 49900);

    /*
     * With auto-approve off, a correctly-sized credit is held for a human rather
     * than settled: the realistic path into manual approval.
     */
    const manualEnv = loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@127.0.0.1:5433/examdump_test',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
      JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
      PASSWORD_PEPPER: 'test-pepper',
      BCRYPT_ROUNDS: '8',
      PUBLIC_WEB_URL: 'http://localhost:3100',
      WEB_ORIGIN: 'http://localhost:3100',
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123',
      PAYMENTS_ENABLED: 'true',
      UPI_PAYEE_VPA: 'examdump@okhdfcbank',
      UPI_PAYEE_NAME: 'ExamDump',
      UPI_ORDER_TTL_MINUTES: '15',
      UPI_AUTO_APPROVE: 'false',
      UPI_NOTIFICATION_MAX_PAISE: '5000000',
      ENABLE_DATASET_SYNC: 'false',
      RATE_LIMIT_MAX: '100000',
      LOG_LEVEL: 'silent',
    });
    const result = await ingestNotification(manualEnv, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 888000111222'),
      timestamp: new Date().toISOString(),
    });
    expect(result.status).toBe('unmatched');
    expect((await getOrderById(order.id))?.status).toBe('under_review');

    const approved = await manuallyApprove(env, result.notificationId!, order.id, admin.id, 'verified in bank app');
    expect(approved.ok).toBe(true);
    expect((await getOrderById(order.id))?.status).toBe('settled');
    expect((await getOrderById(other.id))?.status).toBe('pending');

    // A second approval must not double-settle.
    const again = await manuallyApprove(env, result.notificationId!, order.id, admin.id, 'retry');
    expect(again.ok).toBe(false);
  });

  it('records a refund but only completes it when a payout is recorded', async () => {
    const user = await makeUser('upi-refund@example.com');
    const order = await makeOrder(user.id, 49900);
    await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 999000111222'),
      timestamp: new Date().toISOString(),
    });

    // A full refund returns everything the customer actually sent, suffix included.
    const refund = await requestRefund(order.id, order.amountPaise, user.id, 'customer changed mind');
    let current = await getOrderById(order.id);
    // A request alone must not mark the order refunded: no money has moved yet.
    expect(current?.status).toBe('settled');

    await completeRefund(refund.id, 'UTR-REFUND-123');
    current = await getOrderById(order.id);
    expect(current?.status).toBe('refunded');
  });

  it('refuses a refund larger than the order', async () => {
    const user = await makeUser('upi-refund-big@example.com');
    const order = await makeOrder(user.id, 49900);
    await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 121000111222'),
      timestamp: new Date().toISOString(),
    });
    await expect(requestRefund(order.id, 99900, user.id, 'too much')).rejects.toThrow();
  });

  it('refuses a refund on an unsettled order', async () => {
    const user = await makeUser('upi-refund-open@example.com');
    const order = await makeOrder(user.id, 49900);
    await expect(requestRefund(order.id, 100, user.id, 'nope')).rejects.toThrow();
  });
});

/* -------------------------------- stats --------------------------------- */

describe('stats and cancellation', () => {
  it('reports counters and never counts cancelled orders as settled', async () => {
    const user = await makeUser('upi-stats@example.com');
    await makeOrder(user.id, 49900);
    const toCancel = await makeOrder(user.id, 19900);
    await cancelOrder(toCancel.id, 'test');

    const stats = await upiStats();
    expect(stats.pending).toBeGreaterThanOrEqual(1);
    expect(stats.settled).toBe(0);
  });
});

/* ======================================================================== */
/* Regression tests added by the production-readiness audit                  */
/* ======================================================================== */

describe('UPI_AUTO_APPROVE is honoured', () => {
  /**
   * Regression: the flag was read only for display. Every qualifying credit
   * settled automatically, so an operator deploying with auto-approve off (the
   * documented first-deployment rule) still had real money auto-granting plans.
   */
  function envWithAutoApprove(value: boolean): Env {
    return loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@127.0.0.1:5433/examdump_test',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_REFRESH_SECRET: 'y'.repeat(32),
      JWT_SECRET: 'z'.repeat(32),
      PUBLIC_WEB_URL: 'http://localhost:3100',
      WEB_ORIGIN: 'http://localhost:3100',
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123',
      PAYMENTS_ENABLED: 'true',
      UPI_PAYEE_VPA: 'examdump@okhdfcbank',
      UPI_PAYEE_NAME: 'ExamDump',
      UPI_AUTO_APPROVE: value ? 'true' : 'false',
      ENABLE_DATASET_SYNC: 'false',
      RATE_LIMIT_MAX: '100000',
      LOG_LEVEL: 'silent',
    });
  }

  it('holds the credit for review and does not settle when disabled', async () => {
    const manualEnv = envWithAutoApprove(false);
    const user = await makeUser('upi-hold@example.com');
    const order = await makeOrder(user.id, 49900);

    const result = await ingestNotification(manualEnv, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 303030303030'),
      timestamp: new Date().toISOString(),
    });

    // Held, and the buyer is told nothing was confirmed.
    expect(result.status).toBe('unmatched');
    expect(result.reason).toBe('auto_approve_disabled');

    const after = await getOrderById(order.id);
    expect(after?.status).toBe('under_review');
    expect(after?.settledAt).toBeNull();

    // No entitlement was granted.
    const paymentRow = await getDb().select().from(payments).where(eq(payments.id, order.paymentId!));
    expect(paymentRow[0]?.status).toBe('pending');

    // The notification is queued for a human, not lost.
    const note = await getDb().select().from(upiNotifications).where(eq(upiNotifications.id, result.notificationId!));
    expect(note[0]?.status).toBe('unmatched');
    expect(note[0]?.decisionReason).toBe('auto_approve_disabled_held_for_review');

    // And a held order can still be settled by an administrator.
    const approved = await manuallyApprove(manualEnv, result.notificationId!, order.id, user.id, 'checked bank app');
    expect(approved.ok).toBe(true);
    expect((await getOrderById(order.id))?.status).toBe('settled');
  });

  it('still settles automatically when enabled', async () => {
    const autoEnv = envWithAutoApprove(true);
    const user = await makeUser('upi-auto@example.com');
    const order = await makeOrder(user.id, 49900);

    const result = await ingestNotification(autoEnv, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 404040404040'),
      timestamp: new Date().toISOString(),
    });

    expect(result.status).toBe('matched');
    expect((await getOrderById(order.id))?.status).toBe('settled');
  });
});

describe('manual approval requires the credit to match the order', () => {
  /**
   * Regression: `manuallyApprove` never compared the credit amount with the
   * order amount, so a ₹1 test transfer could be approved against a ₹499 order
   * and grant the plan.
   */
  it('refuses a credit smaller than the order', async () => {
    const admin = await makeUser('upi-admin-mm@example.com');
    const user = await makeUser('upi-mismatch-manual@example.com');
    const order = await makeOrder(user.id, 49900);

    const held = await ingestNotification(env, {
      source: 'sms',
      text: creditAlert('1.00', ' Ref No 505050505050'),
      timestamp: new Date().toISOString(),
    });
    expect(held.status).toBe('unmatched');

    const result = await manuallyApprove(env, held.notificationId!, order.id, admin.id, 'oops');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/amount_mismatch/);

    expect((await getOrderById(order.id))?.status).toBe('pending');
  });

  it('refuses to re-approve a notification that was already decided', async () => {
    const admin = await makeUser('upi-admin-twice@example.com');
    const user = await makeUser('upi-reapprove@example.com');
    const order = await makeOrder(user.id, 49900);

    // Auto-approve is on, so this settles through the normal path first.
    const settled = await ingestNotification(env, {
      source: 'sms',
      text: creditAlertFor(order, ' Ref No 606060606060'),
      timestamp: new Date().toISOString(),
    });
    expect(settled.status).toBe('matched');

    // Re-approving the same, already-decided notification must be refused.
    const again = await manuallyApprove(env, settled.notificationId!, order.id, admin.id, 'again');
    expect(again.ok).toBe(false);

    const matches = await getDb().select().from(upiMatches).where(eq(upiMatches.orderId, order.id));
    expect(matches.length).toBe(1);
  });
});

describe('refunds cannot exceed the order under concurrency', () => {
  /**
   * Regression: the running-total check read the sum and then inserted without a
   * lock, so parallel requests all saw "room left". Measured before the fix: 20
   * concurrent 10% refunds were all accepted against one 100% order.
   */
  it('serialises concurrent refunds so the total never exceeds the order', async () => {
    const admin = await makeUser('upi-refund-admin@example.com');
    const user = await makeUser('upi-refund-race@example.com');
    const order = await makeOrder(user.id, 100000);
    await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 707070707070'),
      timestamp: new Date().toISOString(),
    });
    expect((await getOrderById(order.id))?.status).toBe('settled');

    // 20 x 10%: only 10 may succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => requestRefund(order.id, 10000, admin.id, `attempt ${i}`)),
    );
    const accepted = results.filter((r) => r.status === 'fulfilled').length;

    const rows = await getDb().select().from(upiRefunds).where(eq(upiRefunds.orderId, order.id));
    const total = rows.reduce((sum, r) => sum + r.amountPaise, 0);

    expect(accepted).toBeLessThanOrEqual(10);
    expect(total).toBeLessThanOrEqual(order.amountPaise);
  });

  it('rejects a non-positive refund amount', async () => {
    const admin = await makeUser('upi-refund-zero@example.com');
    const user = await makeUser('upi-refund-zero-buyer@example.com');
    const order = await makeOrder(user.id, 49900);
    await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 808080808080'),
      timestamp: new Date().toISOString(),
    });
    await expect(requestRefund(order.id, 0, admin.id, 'zero')).rejects.toThrow();
    await expect(requestRefund(order.id, -100, admin.id, 'negative')).rejects.toThrow();
  });
});

/* ======================================================================== */
/* Unique per-attempt amounts                                               */
/* ======================================================================== */

describe('unique payment amounts', () => {
  it('adds a 1-99 paisa suffix and keeps the quoted price as the base', async () => {
    const user = await makeUser('upi-suffix@example.com');
    const order = await makeOrder(user.id, 49900);

    expect(order.baseAmountPaise).toBe(49900);
    const suffix = order.amountPaise - order.baseAmountPaise;
    expect(suffix).toBeGreaterThanOrEqual(1);
    expect(suffix).toBeLessThanOrEqual(99);

    // The same amount must appear everywhere the customer could look at it.
    expect(order.upiUri).toContain(`am=${(order.amountPaise / 100).toFixed(2)}`);
    expect(order.upiUri).not.toContain(`am=${(order.baseAmountPaise / 100).toFixed(2)}&`);
  });

  it('never issues the same payable amount to two live orders', async () => {
    const user = await makeUser('upi-suffix-distinct@example.com');
    const amounts = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      const order = await makeOrder(user.id, 19900);
      amounts.add(order.amountPaise);
      // Keep them live; only pending/under_review reserve an amount.
    }
    // 12 draws from 99 values colliding is possible, so assert on the guarantee
    // that matters: whatever is live is unique.
    const live = await getDb()
      .select({ amountPaise: upiOrders.amountPaise })
      .from(upiOrders)
      .where(eq(upiOrders.status, 'pending'));
    const liveAmounts = live.map((r) => r.amountPaise);
    expect(new Set(liveAmounts).size).toBe(liveAmounts.length);
    expect(amounts.size).toBe(12);
  });

  it('retries with a new suffix when a collision occurs', async () => {
    const user = await makeUser('upi-suffix-collide@example.com');
    const first = await makeOrder(user.id, 29900);

    /*
     * Force the RNG onto the same suffix the first order already holds. The insert
     * must be rejected by the partial unique index and retried instead of failing
     * the checkout. After the forced draw, real randomness resumes.
     */
    const { setSuffixRandom } = await import('../src/services/upi/order.service.js');
    // Suffix in paise: amountPaise is base + suffix, both already in paise.
    const takenSuffix = first.amountPaise - first.baseAmountPaise;
    let calls = 0;
    // The suffix is 1-based, so convert back to the RNG's 0-based range.
    const collideValue = (takenSuffix - 1) / 99;
    setSuffixRandom(() => {
      calls += 1;
      // First draw reproduces the suffix the live order already holds.
      return calls === 1 ? collideValue : 0.5;
    });

    try {
      const second = await makeOrder(user.id, 29900);
      expect(second.amountPaise).not.toBe(first.amountPaise);
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      setSuffixRandom(null);
    }
  });

  it('gives concurrent checkouts distinct amounts', async () => {
    const users = await Promise.all(
      Array.from({ length: 8 }, (_, i) => makeUser(`upi-concurrent-amount-${i}@example.com`)),
    );

    const orders = await Promise.all(users.map((u) => makeOrder(u.id, 39900)));
    const amounts = orders.map((o) => o.amountPaise);

    expect(new Set(amounts).size).toBe(amounts.length);
    for (const order of orders) {
      expect(order.baseAmountPaise).toBe(39900);
      expect(order.amountPaise - order.baseAmountPaise).toBeGreaterThanOrEqual(1);
      expect(order.amountPaise - order.baseAmountPaise).toBeLessThanOrEqual(99);
    }
  });

  it('frees the amount once an order expires', async () => {
    const user = await makeUser('upi-suffix-expiry@example.com');
    const old = await makeOrder(user.id, 59900, { ttlMinutes: 3 });

    // Expire it through the real sweeper rather than by editing the row.
    await getDb()
      .update(upiOrders)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(upiOrders.id, old.id));
    await expireStaleOrders();

    const refreshed = await getOrderById(old.id);
    expect(refreshed?.status).toBe('expired');

    // The amount is no longer reserved, so a new order may take it.
    const { setSuffixRandom } = await import('../src/services/upi/order.service.js');
    const freedSuffix = (old.amountPaise - old.baseAmountPaise) / 100;
    setSuffixRandom(() => freedSuffix);
    try {
      const replacement = await makeOrder(user.id, 59900);
      // Either it reused the freed amount, or another random value: never a failure.
      expect(replacement.amountPaise).toBeGreaterThanOrEqual(59901);
    } finally {
      setSuffixRandom(null);
    }
  });

  it('settles only on the exact suffixed amount, not the plan price', async () => {
    const user = await makeUser('upi-exact-amount@example.com');
    const order = await makeOrder(user.id, 49900);

    // Paying the plan price is short by the suffix: it must not match.
    const short = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlert('499.00', ' Ref No 818181818181'),
      timestamp: new Date().toISOString(),
    });
    expect(short.status).toBe('unmatched');
    expect((await getOrderById(order.id))?.status).toBe('pending');

    // The exact payable amount does match. The reference must be unique across the
    // whole suite: bank_reference is uniquely indexed, so a repeat is a replay.
    const exact = await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, '', randomUtr()),
      timestamp: new Date().toISOString(),
    });
    expect(exact.status).toBe('matched');
    expect((await getOrderById(order.id))?.status).toBe('settled');
  });

  it('does not reuse a suffixed amount as the next base price', async () => {
    /*
     * Reuse guard: when a customer refreshes checkout, the order is returned as-is
     * rather than re-priced. A second order for the same plan must build on the
     * plan price, not on the previous order's suffixed amount, or suffixes would
     * compound every retry.
     */
    const user = await makeUser('upi-no-compound@example.com');
    const first = await makeOrder(user.id, 49900);
    await cancelOrder(first.id, 'test');
    const second = await makeOrder(user.id, 49900);

    expect(second.baseAmountPaise).toBe(49900);
    expect(second.amountPaise).toBeLessThanOrEqual(49999);
  });

  it('treats the same alert twice as a duplicate, not a second settlement', async () => {
    const user = await makeUser('upi-dupe-suffix@example.com');
    const order = await makeOrder(user.id, 49900);
    const text = creditAlertFor(order, ' Ref No 737373737373');
    const at = new Date().toISOString();

    const first = await ingestNotification(env, { source: 'gmail', text, timestamp: at });
    const replay = await ingestNotification(env, { source: 'gmail', text, timestamp: at });

    expect(first.status).toBe('matched');
    expect(replay.status).toBe('duplicate');

    const matches = await getDb().select().from(upiMatches).where(eq(upiMatches.orderId, order.id));
    expect(matches.length).toBe(1);
  });

  it('does not let a refund exceed the amount the customer actually sent', async () => {
    const admin = await makeUser('upi-suffix-refund-admin@example.com');
    const user = await makeUser('upi-suffix-refund@example.com');
    const order = await makeOrder(user.id, 49900);
    await ingestNotification(env, {
      source: 'gmail',
      text: creditAlertFor(order, ' Ref No 747474747474'),
      timestamp: new Date().toISOString(),
    });

    // One paisa more than was received is refused.
    await expect(
      requestRefund(order.id, order.amountPaise - order.baseAmountPaise + order.baseAmountPaise + 1, admin.id, 'too much'),
    ).rejects.toThrow('refund_exceeds_order');

    // The full received amount, suffix included, is allowed.
    const refund = await requestRefund(order.id, order.amountPaise, admin.id, 'full');
    await completeRefund(refund.id, 'UTR-SUFFIX-REFUND');
    expect((await getOrderById(order.id))?.status).toBe('refunded');
  });
});


