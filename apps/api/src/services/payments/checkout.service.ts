/**
 * ExamDump Pay — checkout orchestration.
 *
 * Sits between the HTTP routes and the provider adapter. Everything that must
 * be true regardless of provider lives here:
 *
 *  - The amount always comes from our own quote (plans + coupons in Postgres),
 *    never from the request body.
 *  - Duplicate checkout requests reuse an existing pending payment instead of
 *    creating a second charge.
 *  - The gateway id and our order ref are persisted before the customer pays.
 *  - Settlement is delegated to `settlePayment`, which is already idempotent and
 *    is the only path that grants entitlements.
 */
import type { Env } from '../../config/env.js';
import type { User } from '../../db/schema/index.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { payments } from '../../db/schema/index.js';
import { badRequest, conflict, serviceUnavailable } from '../../lib/errors.js';
import { quotePlan } from '../subscription.service.js';
import { assertAmountAllowed, type PaymentMethod } from './adapter.js';
import { resolvePaymentAdapter } from './registry.js';

export interface CheckoutInput {
  planId: string;
  examKeys?: string[];
  examKey?: string;
  couponCode?: string;
  methods?: PaymentMethod[];
  returnUrl: string;
}

export interface CheckoutResult {
  paymentId: string;
  orderRef: string;
  gatewayPaymentId: string;
  checkoutUrl?: string;
  clientSecret?: string;
  amountMinor: number;
  currency: string;
  status: string;
  adapter: string;
  methods: PaymentMethod[];
  publishableKey?: string;
  /** Plan summary so the UI can render the confirmation without refetching. */
  plan: { id: string; name: string };
}

/** How long a pending order stays reusable before we create a fresh one. */
const PENDING_REUSE_MS = 20 * 60 * 1000;

function orderRef(): string {
  return `ed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createCheckout(env: Env, user: User, input: CheckoutInput): Promise<CheckoutResult> {
  const availability = resolvePaymentAdapter(env);
  if (!availability.adapter) {
    throw serviceUnavailable(
      availability.reason === 'payments_disabled'
        ? 'Payments are temporarily paused. You can keep using the free plan meanwhile.'
        : 'Online payments are not available yet. You can keep using the free plan meanwhile.',
    );
  }
  const adapter = availability.adapter;

  // Server-side truth for the price.
  const quote = await quotePlan(user.id, {
    planId: input.planId,
    examKeys: input.examKeys,
    examKey: input.examKey,
    couponCode: input.couponCode,
  });

  if (quote.totalMinor <= 0) {
    throw badRequest('This order has no chargeable amount.');
  }
  assertAmountAllowed(env, quote.totalMinor, quote.currency);

  const methods = (input.methods && input.methods.length > 0 ? input.methods : availability.methods).filter((m) =>
    availability.methods.includes(m),
  );
  if (methods.length === 0) {
    throw badRequest('None of the requested payment methods are available.');
  }

  const db = getDb();

  // Reuse a recent pending order for the same plan+amount. Without this, a
  // double-clicked Pay button or a retried request creates two gateway orders.
  const [reusable] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.userId, user.id),
        eq(payments.status, 'pending'),
        eq(payments.provider, adapter.id),
        eq(payments.amountMinor, quote.totalMinor),
        eq(payments.currency, quote.currency),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);

  if (reusable && reusable.providerRef && Date.now() - reusable.createdAt.getTime() < PENDING_REUSE_MS) {
    const meta = reusable.metadata as { planId?: string; methods?: PaymentMethod[] } | null;
    if (meta?.planId === quote.plan.id) {
      return {
        paymentId: reusable.id,
        orderRef: reusable.orderRef ?? '',
        gatewayPaymentId: reusable.providerRef,
        clientSecret: reusable.clientSecret ?? undefined,
        amountMinor: reusable.amountMinor,
        currency: reusable.currency,
        status: reusable.status,
        adapter: adapter.id,
        methods: meta.methods ?? methods,
        publishableKey: env.RAZORPAY_KEY_ID,
        plan: { id: quote.plan.id, name: quote.plan.name },
      };
    }
  }

  const ref = orderRef();
  const description = `${quote.plan.name}${quote.examKeys.length ? ` (${quote.examKeys.join(', ')})` : ''}`;

  const created = await adapter.createOrder(env, {
    amountMinor: quote.totalMinor,
    currency: quote.currency,
    orderRef: ref,
    description,
    customer: { id: user.id.replace(/-/g, ''), email: user.email, name: user.name || 'Learner' },
    returnUrl: input.returnUrl,
    methods,
    metadata: {
      planId: quote.plan.id,
      examKeys: quote.examKeys.join(','),
      couponCode: quote.couponCode ?? '',
    },
  });

  const [payment] = await db
    .insert(payments)
    .values({
      userId: user.id,
      subscriptionId: null,
      amountMinor: quote.totalMinor,
      discountMinor: quote.discountMinor,
      currency: quote.currency,
      status: 'pending',
      provider: adapter.id,
      providerRef: created.paymentId,
      // For Razorpay the "payment id" we track is the order id until a payment
      // attempt exists; `fetchPayment`/webhooks fill in the real payment id.
      providerPaymentId: created.paymentId,
      clientSecret: created.clientSecret ?? null,
      orderRef: ref,
      description: `${quote.plan.name} — awaiting confirmation`,
      metadata: {
        planId: quote.plan.id,
        planName: quote.plan.name,
        examKeys: quote.examKeys,
        couponCode: quote.couponCode,
        grossMinor: quote.grossMinor,
        methods,
      },
    })
    .returning();

  if (!payment) throw new Error('Failed to persist the payment order.');

  return {
    paymentId: payment.id,
    orderRef: ref,
    gatewayPaymentId: created.paymentId,
    checkoutUrl: created.checkoutUrl,
    clientSecret: created.clientSecret,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: payment.status,
    adapter: adapter.id,
    methods,
    publishableKey: env.RAZORPAY_KEY_ID,
    plan: { id: quote.plan.id, name: quote.plan.name },
  };
}

/**
 * Ask the adapter for the authoritative status of a payment we already own.
 *
 * The browser is never trusted: this only reads gateway state, and it is the
 * caller's job to feed the result to `settlePayment`.
 */
export async function fetchGatewayStatus(
  env: Env,
  payment: { provider: string; providerRef: string; providerPaymentId: string | null },
): Promise<{ status: string; amountMinor: number | null; currency: string | null } | null> {
  const availability = resolvePaymentAdapter(env);
  const adapter = availability.adapterId === payment.provider ? availability.adapter : null;
  if (!adapter) return null;

  // Razorpay: the order id was stored at creation. Once a payment attempt
  // exists its id is stored in providerRef, which is what we must query.
  const target = payment.providerRef;
  if (!target) return null;
  const result = await adapter.fetchPayment(env, target);
  return { status: result.gatewayStatus, amountMinor: result.amountMinor, currency: result.currency };
}

/** Total refunded so far for a payment, and the remaining refundable amount. */
export async function refundableFor(
  env: Env,
  paymentId: string,
): Promise<{ refundedMinor: number; refundableMinor: number; paymentStatus: string } | null> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) return null;
  const refunded = payment.refundedMinor ?? 0;
  return {
    refundedMinor: refunded,
    refundableMinor: Math.max(0, payment.amountMinor - refunded),
    paymentStatus: payment.status,
  };
}

/** Guard against a stale/duplicate order being settled twice by different ids. */
export async function findPaymentByGatewayId(
  gatewayIds: string[],
): Promise<{ id: string; userId: string } | null> {
  const ids = gatewayIds.filter(Boolean);
  if (ids.length === 0) return null;
  const db = getDb();
  const [row] = await db
    .select({ id: payments.id, userId: payments.userId })
    .from(payments)
    .where(inArray(payments.providerPaymentId, ids))
    .limit(1);
  return row ?? null;
}

export function assertRefundable(payment: { status: string; amountMinor: number; refundedMinor: number }): number {
  if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
    throw conflict('Only a successful payment can be refunded.');
  }
  const remaining = payment.amountMinor - payment.refundedMinor;
  if (remaining <= 0) throw conflict('This payment has already been fully refunded.');
  return remaining;
}
