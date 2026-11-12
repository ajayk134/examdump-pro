import { and, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  DEFAULT_PLAN_DEFINITIONS,
  MULTI_EXAM_QUOTA,
  type AccessScope,
  type PlanDefinition,
} from '@examdump/shared';
import type { Env } from '../config/env.js';
import { getDb } from '../db/client.js';
import {
  accessGrants,
  couponRedemptions,
  coupons,
  invoiceSequences,
  invoices,
  payments,
  plans,
  referrals,
  refunds,
  subscriptions,
  users,
  type Plan,
  type Subscription,
  type User,
} from '../db/schema/index.js';
import { badRequest, conflict, notFound, serviceUnavailable } from '../lib/errors.js';
import type { AnyPgTx } from '../lib/tx.js';
import { createNotification } from './notification.service.js';
import { recordAudit } from './audit.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanSeed = PlanDefinition;

export const DEFAULT_PLANS: readonly PlanDefinition[] = DEFAULT_PLAN_DEFINITIONS;

export async function ensureDefaultPlans(): Promise<void> {
  const db = getDb();
  for (const plan of DEFAULT_PLAN_DEFINITIONS) {
    const values = {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      scope: plan.scope,
      examQuota: plan.examQuota,
      durationDays: plan.durationDays,
      billingCycle: plan.billingCycle,
      earlyAccess: plan.earlyAccess,
      highlight: plan.highlight,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      features: [...plan.features],
      active: plan.active,
      sortOrder: plan.sortOrder,
    };
    await db.insert(plans).values(values).onConflictDoNothing();
    // Keep pricing/features in sync with the product catalogue on boot while
    // never clobbering an admin's `active` flag or custom name.
    await db
      .update(plans)
      .set({
        priceMinor: values.priceMinor,
        durationDays: values.durationDays,
        scope: values.scope,
        examQuota: values.examQuota,
        billingCycle: values.billingCycle,
        features: values.features,
        updatedAt: new Date(),
      })
      .where(eq(plans.id, plan.id));
  }
}

export async function listPlans(): Promise<Plan[]> {
  const db = getDb();
  return db.select().from(plans).where(eq(plans.active, true)).orderBy(plans.sortOrder);
}

export async function listAllPlans(): Promise<Plan[]> {
  const db = getDb();
  return db.select().from(plans).orderBy(plans.sortOrder);
}

export interface CouponValidation {
  valid: boolean;
  code: string;
  percentOff: number;
  message: string;
}

export async function validateCoupon(code: string, userId?: string): Promise<CouponValidation> {
  const db = getDb();
  const normalized = code.toUpperCase();
  const [coupon] = await db.select().from(coupons).where(eq(coupons.code, normalized)).limit(1);
  if (!coupon || !coupon.active) {
    return { valid: false, code: normalized, percentOff: 0, message: 'This coupon code is not valid.' };
  }
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
    return { valid: false, code: normalized, percentOff: 0, message: 'This coupon has expired.' };
  }
  if (coupon.maxRedemptions > 0 && coupon.redemptionCount >= coupon.maxRedemptions) {
    return { valid: false, code: normalized, percentOff: 0, message: 'This coupon has reached its redemption limit.' };
  }
  if (userId) {
    const [already] = await db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.userId, userId)))
      .limit(1);
    if (already) {
      return { valid: false, code: normalized, percentOff: 0, message: 'You have already used this coupon.' };
    }
  }
  return { valid: true, code: coupon.code, percentOff: coupon.percentOff, message: `${coupon.percentOff}% off applied.` };
}

/** Recompute the denormalised users.plan/premiumUntil cache from real access. */
export async function recomputeUserPlan(userId: string): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;

  if (user.role === 'admin') {
    await db.update(users).set({ plan: 'premium', premiumUntil: null, updatedAt: new Date() }).where(eq(users.id, userId));
    return;
  }

  const now = new Date();
  const activeSubs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        or(
          inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
          and(eq(subscriptions.status, 'canceled'), gt(subscriptions.currentPeriodEnd, now)),
        ),
        gt(subscriptions.currentPeriodEnd, now),
      ),
    );
  const grants = await db
    .select()
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.userId, userId),
        isNull(accessGrants.revokedAt),
        or(isNull(accessGrants.expiresAt), gt(accessGrants.expiresAt, now)),
      ),
    );

  const hasAccess = activeSubs.length > 0 || grants.length > 0;
  const expiries = [
    ...activeSubs.map((s) => s.currentPeriodEnd),
    ...grants.map((g) => g.expiresAt),
  ].filter((d): d is Date => Boolean(d));
  const premiumUntil = expiries.length ? expiries.reduce((a, b) => (a > b ? a : b)) : null;

  await db
    .update(users)
    .set({ plan: hasAccess ? 'premium' : 'free', premiumUntil, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/* ------------------------------------------------------------------ */
/* Pricing / quotes                                                    */
/* ------------------------------------------------------------------ */

export interface PlanQuote {
  plan: Plan;
  examKeys: string[];
  grossMinor: number;
  discountMinor: number;
  totalMinor: number;
  couponCode: string | null;
  couponId: string | null;
  currency: string;
}

export interface QuoteInput {
  planId: string;
  /** Exams to unlock (multi plans accept several). */
  examKeys?: string[];
  /** Backwards-compatible single-exam selector. */
  examKey?: string;
  couponCode?: string;
}

/**
 * Validate the requested plan/exams/coupon and compute the authoritative price.
 * The server is the single source of truth: the browser can never send an
 * amount and the exam quota is enforced here.
 */
export async function quotePlan(
  userId: string | null,
  input: QuoteInput,
): Promise<PlanQuote> {
  const db = getDb();
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, input.planId), eq(plans.active, true)))
    .limit(1);
  if (!plan) throw notFound('That plan is not available.');

  const examKeys = [
    ...new Set(
      [...(input.examKeys ?? []), ...(input.examKey ? [input.examKey] : [])]
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
  const quota = plan.scope === 'multi' ? Math.max(1, plan.examQuota || MULTI_EXAM_QUOTA) : plan.scope === 'single' ? 1 : 0;

  if (plan.scope !== 'all') {
    if (examKeys.length === 0) {
      throw badRequest(
        plan.scope === 'single'
          ? 'Choose the exam you want to unlock.'
          : `Choose up to ${quota} exams to unlock.`,
      );
    }
    if (examKeys.length > quota) {
      throw badRequest(
        plan.scope === 'single'
          ? 'This plan unlocks exactly one exam.'
          : `The Multi-Exam Pass unlocks up to ${quota} exams.`,
      );
    }
    if (await examKeysExist(examKeys) === false) {
      throw badRequest('One or more selected exams could not be found.');
    }
  }

  let discountMinor = 0;
  let couponId: string | null = null;
  let couponCode: string | null = null;
  if (input.couponCode) {
    const validation = await validateCoupon(input.couponCode, userId ?? undefined);
    if (!validation.valid) throw conflict(validation.message);
    const [coupon] = await db.select().from(coupons).where(eq(coupons.code, validation.code)).limit(1);
    if (coupon) {
      couponId = coupon.id;
      couponCode = coupon.code;
      discountMinor = Math.round((plan.priceMinor * coupon.percentOff) / 100);
    }
  }

  return {
    plan,
    examKeys,
    grossMinor: plan.priceMinor,
    discountMinor,
    totalMinor: Math.max(0, plan.priceMinor - discountMinor),
    couponCode,
    couponId,
    currency: plan.currency,
  };
}

async function examKeysExist(keys: string[]): Promise<boolean> {
  const db = getDb();
  const rows = await db.execute<{ key: string }>(
    sql`select key from catalog_exams where key in ${sql`(${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`}`,
  );
  const found = new Set((rows as unknown as Array<{ key: string }>).map((r) => r.key));
  return keys.every((k) => found.has(k));
}

/* ------------------------------------------------------------------ */
/* Order lifecycle (HyperSwitch)                                       */
/* ------------------------------------------------------------------ */

export interface CreateOrderInput {
  planId: string;
  examKeys?: string[];
  examKey?: string;
  couponCode?: string;
  returnUrl: string;
}

/**
 * Create a *pending* payment row plus the gateway payment. No entitlement is
 * granted here - only `settlePayment()` (webhook or verified reconciliation)
 * can activate access.
 */
export async function createPaymentOrder(env: Env, user: User, input: CreateOrderInput) {
  const { createPayment, checkoutReady } = await import('./hyperswitch.client.js');
  // Quote first so plan/exam/coupon validation errors are actionable even when
  // the gateway is not configured yet.
  const quote = await quotePlan(user.id, input);

  if (!checkoutReady(env)) {
    throw serviceUnavailable(
      'Card payments are not configured yet. Please try again later or contact support.',
    );
  }
  const db = getDb();
  const orderRef = `ed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const meta = {
    planId: quote.plan.id,
    planName: quote.plan.name,
    userId: user.id,
    examKeys: quote.examKeys.join(','),
    couponCode: quote.couponCode ?? '',
    orderRef,
  };

  const gateway = await createPayment(env, {
    amountMinor: quote.totalMinor,
    currency: quote.currency,
    orderRef,
    description: `${quote.plan.name}${quote.examKeys.length ? ` (${quote.examKeys.join(', ')})` : ''}`,
    customer: { id: user.id.replace(/-/g, ''), email: user.email, name: user.name || 'Learner' },
    returnUrl: input.returnUrl,
    metadata: meta,
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
      provider: 'hyperswitch',
      providerRef: gateway.payment_id,
      providerPaymentId: gateway.payment_id,
      clientSecret: gateway.client_secret ?? null,
      orderRef,
      description: `${quote.plan.name} — awaiting confirmation`,
      metadata: {
        planId: quote.plan.id,
        examKeys: quote.examKeys,
        couponCode: quote.couponCode,
        grossMinor: quote.grossMinor,
      },
    })
    .returning();
  if (!payment) throw new Error('Failed to persist the payment order.');

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'payment.checkout_started',
    targetType: 'payment',
    targetId: payment.id,
    metadata: { planId: quote.plan.id, amountMinor: quote.totalMinor, orderRef },
  });

  return {
    payment,
    quote,
    // The SDK needs the publishable key + client secret. The secret is bound to
    // this single payment intent, so it is safe to expose to the buyer.
    checkout: {
      provider: 'hyperswitch' as const,
      paymentId: gateway.payment_id,
      clientSecret: gateway.client_secret ?? null,
      publishableKey: env.HYPERSWITCH_API_KEY ?? '',
      merchantId: env.HYPERSWITCH_MERCHANT_ID ?? '',
      baseUrl: env.HYPERSWITCH_BASE_URL ?? '',
      amountMinor: quote.totalMinor,
      currency: quote.currency,
      returnUrl: input.returnUrl,
    },
  };
}

/**
 * Create a *pending* payment row for a UPI self-collection checkout.
 *
 * There is no gateway here: the customer pays our VPA directly and a bank
 * notification is what eventually calls `settlePayment()`. No entitlement is
 * granted at this point, exactly as with card checkout.
 */
export async function createUpiPaymentOrder(
  env: Env,
  user: User,
  input: { planId: string; billingPeriod?: 'monthly' | 'yearly'; couponCode?: string; examKeys?: string[] },
) {
  const quote = await quotePlan(user.id, {
    planId: input.planId,
    examKeys: input.examKeys,
    couponCode: input.couponCode,
  });

  const db = getDb();
  const orderRef = `upi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  const [payment] = await db
    .insert(payments)
    .values({
      userId: user.id,
      subscriptionId: null,
      amountMinor: quote.totalMinor,
      discountMinor: quote.discountMinor,
      currency: quote.currency,
      status: 'pending',
      provider: 'upi',
      // Replaced by the bank reference once a notification settles this payment.
      providerRef: orderRef,
      orderRef,
      description: `${quote.plan.name} — awaiting UPI transfer`,
      metadata: {
        planId: quote.plan.id,
        examKeys: quote.examKeys,
        couponCode: quote.couponCode,
        grossMinor: quote.grossMinor,
        billingPeriod: input.billingPeriod ?? 'monthly',
      },
    })
    .returning();
  if (!payment) throw new Error('Failed to persist the UPI payment order.');

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'payment.upi_checkout_started',
    targetType: 'payment',
    targetId: payment.id,
    metadata: { planId: quote.plan.id, amountMinor: quote.totalMinor, orderRef },
  });

  return { payment, quote };
}

export interface SettleResult {
  paymentId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'already_settled' | 'ignored';
  subscriptionId?: string;
  reason?: string;
  /** Present only on a fresh success; consumed by the receipt emailer. */
  receipt?: ReceiptContext;
}

interface SettleOptions {
  gatewayStatus?: string;
  providerPaymentId?: string;
  providerAttemptId?: string | null;
  failureReason?: string | null;
  /**
   * Where the settlement decision came from. `upi` and `upi_manual` are
   * notification-driven: recorded distinctly so reporting can always separate
   * a bank-verified settlement from one inferred from an alert.
   */
  source: 'webhook' | 'reconcile' | 'return' | 'upi' | 'upi_manual';
}

/**
 * Idempotently settle a payment. This is the ONLY place that grants access
 * following a gateway payment, and it always runs inside a transaction with a
 * row lock so duplicate webhooks cannot double-grant.
 */
export async function settlePayment(
  paymentId: string,
  options: SettleOptions,
): Promise<SettleResult> {
  const db = getDb();
  const gatewayStatus = (options.gatewayStatus ?? '').toLowerCase();

  const result = await db.transaction(async (tx): Promise<SettleResult> => {
    /*
     * Resolve the payment row in two steps, most-specific first.
     *
     * A single `OR` across (id, providerPaymentId, providerRef) could return a
     * *different* row than the caller addressed: when a caller settles by
     * explicit `paymentId` (as UPI does) and also passes a bank UTR, an unrelated
     * pending payment whose `providerRef` happened to equal that UTR would match
     * first. Granting that row's plan would entitle the wrong account. So the
     * explicit id is tried alone first and only falls back to reference lookup
     * when the caller did not supply one.
     */
    const byId = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
      .for('update');

    let payment = byId[0];

    if (!payment && options.providerPaymentId) {
      // Adapters such as Razorpay store the order id at creation time and only
      // learn the payment id later, so a webhook may address the payment by
      // either identifier rather than by our own row id.
      const byReference = await tx
        .select()
        .from(payments)
        .where(
          or(
            eq(payments.providerPaymentId, options.providerPaymentId),
            eq(payments.providerRef, options.providerPaymentId),
          ),
        )
        .limit(1)
        .for('update');
      payment = byReference[0];
    }

    if (!payment) return { paymentId, status: 'ignored', reason: 'unknown_payment' };

    if (payment.status === 'succeeded' || payment.status === 'partially_refunded') {
      return { paymentId: payment.id, status: 'already_settled', subscriptionId: payment.subscriptionId ?? undefined };
    }

    const paid = ['succeeded', 'charged', 'partially_captured', 'captured'].includes(gatewayStatus);
    const failed = ['failed', 'cancelled', 'cancelled_post_capture', 'expired', 'router_declined', 'voided'].includes(
      gatewayStatus,
    );

    if (!paid && !failed) {
      await tx
        .update(payments)
        .set({
          providerAttemptId: options.providerAttemptId ?? payment.providerAttemptId,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));
      return { paymentId: payment.id, status: 'pending' };
    }

    if (failed) {
      await tx
        .update(payments)
        .set({
          status: 'failed',
          failureReason: options.failureReason ?? gatewayStatus,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));
      await recordAudit({
        actorId: null,
        action: 'payment.webhook_received',
        targetType: 'payment',
        targetId: payment.id,
        metadata: { status: gatewayStatus, source: options.source },
      });
      return { paymentId: payment.id, status: 'failed', reason: gatewayStatus };
    }

    // --- paid: activate the subscription -----------------------------------
    const meta = (payment.metadata ?? {}) as {
      planId?: string;
      examKeys?: string[];
      couponCode?: string;
      grossMinor?: number;
    };

    const [plan] = meta.planId
      ? await tx.select().from(plans).where(eq(plans.id, meta.planId)).limit(1)
      : [undefined];
    if (!plan) {
      await tx
        .update(payments)
        .set({ status: 'failed', failureReason: 'plan_missing', updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      return { paymentId: payment.id, status: 'failed', reason: 'plan_missing' };
    }

    const examKeys = (meta.examKeys ?? []).slice(0, plan.scope === 'all' ? 0 : Math.max(1, plan.examQuota || 1));
    const now = new Date();

    // Renewal detection: an active subscription on the same plan + same exams
    // extends the existing period instead of replacing it.
    const existing = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, payment.userId),
          eq(subscriptions.planId, plan.id),
          inArray(subscriptions.status, ['active', 'trialing', 'past_due', 'canceled']),
        ),
      )
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1)
      .for('update');

    const candidate = existing[0];
    const sameExams =
      candidate &&
      (plan.scope === 'all'
        ? true
        : JSON.stringify([...(candidate.examKeys ?? [])].sort()) ===
          JSON.stringify([...examKeys].sort()));

    let subscription: Subscription;
    let renewal = false;

    if (candidate && sameExams && candidate.currentPeriodEnd.getTime() > now.getTime()) {
      renewal = true;
      const base = candidate.currentPeriodEnd;
      const [updated] = await tx
        .update(subscriptions)
        .set({
          status: 'active',
          currentPeriodEnd: new Date(base.getTime() + plan.durationDays * DAY_MS),
          cancelAtPeriodEnd: false,
          canceledAt: null,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, candidate.id))
        .returning();
      subscription = updated!;
      await tx
        .update(payments)
        .set({ subscriptionId: subscription.id })
        .where(eq(payments.id, payment.id));
    } else {
      // Supersede only overlapping access; a `multi` purchase must not cancel
      // access to exams it does not include.
      await supersedeWith(tx, {
        userId: payment.userId,
        scope: plan.scope,
        examKeys,
      });
      const [created] = await tx
        .insert(subscriptions)
        .values({
          userId: payment.userId,
          planId: plan.id,
          scope: plan.scope,
          billingCycle: plan.billingCycle,
          status: 'active',
          examKey: plan.scope === 'single' ? (examKeys[0] ?? null) : null,
          examKeys,
          providerId: null,
          examTitle: null,
          priceMinor: payment.amountMinor,
          currency: plan.currency,
          couponCode: meta.couponCode ?? null,
          discountMinor: payment.discountMinor,
          earlyAccess: plan.earlyAccess,
          startedAt: now,
          currentPeriodEnd: new Date(now.getTime() + plan.durationDays * DAY_MS),
          autoRenew: plan.billingCycle !== 'fixed',
          provider: 'hyperswitch',
          providerRef: payment.providerPaymentId ?? payment.providerRef,
        })
        .returning();
      subscription = created!;
      await tx.update(payments).set({ subscriptionId: subscription.id }).where(eq(payments.id, payment.id));
    }

    await tx
      .update(payments)
      .set({
        status: 'succeeded',
        paidAt: now,
        failureReason: null,
        providerAttemptId: options.providerAttemptId ?? payment.providerAttemptId,
        description: `${plan.name}${examKeys.length ? ` — ${examKeys.join(', ')}` : ''}`,
        updatedAt: now,
      })
      .where(eq(payments.id, payment.id));

    // Coupon redemption + counter (only once per coupon/user thanks to the
    // unique index; failures are non-fatal for the entitlement).
    if (meta.couponCode) {
      const [coupon] = await tx.select().from(coupons).where(eq(coupons.code, meta.couponCode)).limit(1);
      if (coupon) {
        await tx
          .insert(couponRedemptions)
          .values({ couponId: coupon.id, userId: payment.userId, subscriptionId: subscription.id })
          .onConflictDoNothing();
        await tx
          .update(coupons)
          .set({ redemptionCount: coupon.redemptionCount + 1, updatedAt: now })
          .where(eq(coupons.id, coupon.id));
      }
    }

    // Referral qualification: the referrer earns bonus days on the referee's
    // first successful payment (one reward per referee, enforced by a unique
    // index). Failures must never roll back a paid entitlement.
    try {
      const [referee] = await tx.select().from(users).where(eq(users.id, payment.userId)).limit(1);
      if (referee?.referredBy) {
        const [existing] = await tx
          .select()
          .from(referrals)
          .where(eq(referrals.refereeId, payment.userId))
          .limit(1);
        if (!existing) {
          await tx.insert(referrals).values({
            referrerId: referee.referredBy,
            refereeId: payment.userId,
            code: referee.referralCode,
            status: 'completed',
            rewardDays: 7,
          });
          await createNotification({
            userId: referee.referredBy,
            type: 'achievement',
            title: 'Referral reward unlocked',
            body: 'Someone you invited just subscribed. 7 bonus days will be added at your next renewal.',
            link: '/referrals',
          });
        }
      }
    } catch {
      /* referral bookkeeping is best-effort */
    }

    await tx
      .update(users)
      .set({ plan: 'premium', premiumUntil: subscription.currentPeriodEnd, updatedAt: now })
      .where(eq(users.id, payment.userId));

    return {
      paymentId: payment.id,
      status: 'succeeded',
      subscriptionId: subscription.id,
      reason: renewal ? 'renewal' : 'new',
      // Handed back so the receipt can be emailed after commit.
      receipt: {
        userId: payment.userId,
        planName: plan.name,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        paymentId: payment.id,
        renewal,
        periodEnd: subscription.currentPeriodEnd,
      },
    };
  });

  // Receipt + subscription notice are sent after the transaction commits and
  // are best-effort: a mail outage must never undo a paid entitlement.
  if (result.status === 'succeeded' && result.receipt) {
    void sendReceiptEmails(result.receipt).catch(() => undefined);
  }
  return result;
}

interface ReceiptContext {
  userId: string;
  planName: string;
  amountMinor: number;
  currency: string;
  paymentId: string;
  renewal: boolean;
  periodEnd: Date;
}

/**
 * Sends the payment receipt and the matching subscription notice.
 *
 * Kept outside the transaction and isolated per-message so one failing email
 * (bad address, SMTP hiccup) does not suppress the other.
 */
/** Mirrors the web app's formatter so receipts match the UI exactly. */
function formatMoneyMinor(minor: number, currency: string): string {
  const symbol = currency === 'INR' ? '\u20b9' : currency === 'USD' ? '$' : `${currency} `;
  const major = minor / 100;
  return `${symbol}${major.toLocaleString('en-IN', {
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

async function sendReceiptEmails(ctx: ReceiptContext): Promise<void> {
  const { getEnv } = await import('../config/env.js');
  const { sendTransactionalMail } = await import('./mail/mail.service.js');
  const env = getEnv();
  const db = getDb();

  const [user] = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!user) return;

  const formatted = formatMoneyMinor(ctx.amountMinor, ctx.currency);
  const paidAt = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const periodEnd = ctx.periodEnd.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  await sendTransactionalMail(env, {
    to: user.email,
    template: 'payment_receipt',
    userId: user.id,
    referenceId: ctx.paymentId,
    data: {
      name: user.name,
      invoiceNumber: ctx.paymentId.slice(0, 8).toUpperCase(),
      amount: formatted,
      planName: ctx.planName,
      paidAt,
      method: 'Online (ExamDump Pay)',
      invoiceUrl: `${env.PUBLIC_WEB_URL}/invoices/${ctx.paymentId}`,
      lines: [{ label: 'Access until', value: periodEnd }],
      reference: ctx.paymentId,
    },
  });

  await sendTransactionalMail(env, {
    to: user.email,
    template: ctx.renewal ? 'subscription_renewed' : 'subscription_activated',
    userId: user.id,
    referenceId: ctx.paymentId,
    data: {
      name: user.name,
      planName: ctx.planName,
      dateLabel: 'Access until',
      dateValue: periodEnd,
      manageUrl: `${env.PUBLIC_WEB_URL}/profile`,
    },
  });
}

async function supersedeWith(
  tx: AnyPgTx,
  input: { userId: string; scope: AccessScope; examKeys: string[] },
): Promise<void> {
  const now = new Date();
  const activeStatuses = ['active', 'trialing', 'past_due', 'pending'] as const;

  if (input.scope === 'all') {
    // A global pass replaces everything.
    await tx
      .update(subscriptions)
      .set({ status: 'canceled', canceledAt: now, cancelAtPeriodEnd: false, updatedAt: now })
      .where(and(eq(subscriptions.userId, input.userId), inArray(subscriptions.status, [...activeStatuses])));
    return;
  }

  const rows = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, input.userId), inArray(subscriptions.status, [...activeStatuses])));

  for (const row of rows) {
    if (row.scope === 'all') continue; // never downgrade a global pass
    const rowExams = new Set([...(row.examKeys ?? []), ...(row.examKey ? [row.examKey] : [])]);
    const overlap = input.examKeys.some((k) => rowExams.has(k));
    if (!overlap) continue;
    const remaining = [...rowExams].filter((k) => !input.examKeys.includes(k));
    // Multi-exam subscriptions keep the exams that are not being replaced.
    if (row.scope === 'multi' && remaining.length > 0) {
      await tx
        .update(subscriptions)
        .set({ examKeys: remaining, examKey: remaining.length === 1 ? remaining[0]! : null, updatedAt: now })
        .where(eq(subscriptions.id, row.id));
      continue;
    }
    await tx
      .update(subscriptions)
      .set({ status: 'canceled', canceledAt: now, cancelAtPeriodEnd: false, updatedAt: now })
      .where(eq(subscriptions.id, row.id));
  }
}

/** Move an existing subscription's exam selection (Multi-Exam Pass). */
export async function updateExamSelection(
  userId: string,
  subscriptionId: string,
  examKeys: string[],
): Promise<Subscription> {
  const db = getDb();
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .limit(1);
  if (!sub) throw notFound('Subscription not found.');
  if (sub.scope === 'all') throw badRequest('Your plan already includes every exam.');
  if (sub.status === 'expired') throw badRequest('This subscription has expired. Renew to change your exams.');

  const quota = sub.scope === 'multi' ? MULTI_EXAM_QUOTA : 1;
  const unique = [...new Set(examKeys.map((k) => k.trim()).filter(Boolean))];
  if (unique.length === 0) throw badRequest('Select at least one exam.');
  if (unique.length > quota) throw badRequest(`Your plan allows up to ${quota} exam${quota > 1 ? 's' : ''}.`);
  if (!(await examKeysExist(unique))) throw badRequest('One or more selected exams could not be found.');

  const [updated] = await db
    .update(subscriptions)
    .set({
      examKeys: unique,
      examKey: unique.length === 1 ? unique[0]! : null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscriptionId))
    .returning();

  await recordAudit({
    actorId: userId,
    action: 'subscription.exam_selection_updated',
    targetType: 'subscription',
    targetId: subscriptionId,
    metadata: { examKeys: unique },
  });
  return updated!;
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export interface InvoiceLine {
  description: string;
  amountMinor: number;
  quantity: number;
}

/**
 * Issue (or return the existing) invoice for a settled payment. The invoice
 * number is allocated atomically from a single counter row.
 */
export async function issueInvoice(paymentId: string): Promise<typeof invoices.$inferSelect | null> {
  const db = getDb();
  const existing = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId)).limit(1);
  if (existing[0]) return existing[0];

  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment || payment.status === 'failed' || payment.status === 'pending') return null;

  const [user] = await db.select().from(users).where(eq(users.id, payment.userId)).limit(1);
  const meta = (payment.metadata ?? {}) as { planName?: string; examKeys?: string[] };

  return db.transaction(async (tx) => {
    const [seq] = await tx
      .insert(invoiceSequences)
      .values({ id: 'default', lastNumber: 1 })
      .onConflictDoUpdate({
        target: invoiceSequences.id,
        set: { lastNumber: sql`${invoiceSequences.lastNumber} + 1`, updatedAt: new Date() },
      })
      .returning();
    const next = seq?.lastNumber ?? 1;
    const year = new Date().getFullYear();
    const number = `EDP/${year}/${String(next).padStart(6, '0')}`;

    const lines: InvoiceLine[] = [
      {
        description: `${meta.planName ?? (payment.description || 'ExamDump Pro subscription')}${
          meta.examKeys?.length ? ` — ${meta.examKeys.join(', ')}` : ''
        }`,
        amountMinor: payment.amountMinor,
        quantity: 1,
      },
    ];

    const [invoice] = await tx
      .insert(invoices)
      .values({
        number,
        userId: payment.userId,
        paymentId: payment.id,
        subscriptionId: payment.subscriptionId,
        subtotalMinor: payment.amountMinor + payment.discountMinor,
        discountMinor: payment.discountMinor,
        taxMinor: 0,
        totalMinor: payment.amountMinor,
        currency: payment.currency,
        status: 'paid',
        lines,
      })
      .onConflictDoNothing()
      .returning();

    if (!invoice) {
      const [again] = await tx.select().from(invoices).where(eq(invoices.paymentId, payment.id)).limit(1);
      return again ?? null;
    }

    await createNotification({
      userId: payment.userId,
      type: 'system',
      title: `Invoice ${number} available`,
      body: `Your receipt for ${payment.currency} ${(payment.amountMinor / 100).toFixed(2)} is ready to download.`,
      link: `/invoices/${invoice.id}`,
    });
    void user;

    return invoice;
  });
}

export async function listInvoices(userId: string) {
  const db = getDb();
  return db.select().from(invoices).where(eq(invoices.userId, userId)).orderBy(desc(invoices.issuedAt));
}

export async function getInvoice(userId: string, invoiceId: string) {
  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
    .limit(1);
  return invoice ?? null;
}

/* ------------------------------------------------------------------ */
/* User-facing subscription queries                                    */
/* ------------------------------------------------------------------ */

export async function getCurrentSubscription(userId: string): Promise<Subscription | null> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        gt(subscriptions.currentPeriodEnd, now),
        inArray(subscriptions.status, ['active', 'trialing', 'past_due', 'canceled']),
      ),
    )
    .orderBy(desc(subscriptions.currentPeriodEnd));
  if (rows.length === 0) return null;
  return rows.find((s) => s.scope === 'all') ?? rows[0]!;
}

export async function listUserSubscriptions(userId: string): Promise<Subscription[]> {
  const db = getDb();
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));
}

export async function listPayments(userId: string, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(payments)
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt))
    .limit(limit);
}

/**
 * Undo a pending cancellation. Access never lapsed, so this only flips the
 * end-of-period flag back on (before the period has actually ended).
 */
export async function resumeSubscription(userId: string, subscriptionId: string): Promise<Subscription> {
  const db = getDb();
  const [target] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .limit(1);
  if (!target) throw notFound('Subscription not found.');
  if (target.status !== 'active') throw badRequest('Only an active pass can be resumed.');
  if (target.currentPeriodEnd.getTime() <= Date.now()) {
    throw badRequest('This pass has already ended. Buy a new one to continue.');
  }

  const [updated] = await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: false, canceledAt: null, autoRenew: true, updatedAt: new Date() })
    .where(eq(subscriptions.id, target.id))
    .returning();

  await recordAudit({
    actorId: userId,
    action: 'subscription.renewed',
    targetType: 'subscription',
    targetId: target.id,
    metadata: { resumed: true },
  });

  return updated!;
}

export async function cancelSubscription(userId: string, subscriptionId?: string): Promise<Subscription> {
  const db = getDb();
  const target = subscriptionId
    ? (
        await db
          .select()
          .from(subscriptions)
          .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
          .limit(1)
      )[0]
    : await getCurrentSubscription(userId);
  if (!target) throw notFound('No active subscription found.');
  if (['expired', 'canceled'].includes(target.status) && target.cancelAtPeriodEnd) {
    return target;
  }

  const [updated] = await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
      autoRenew: false,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, target.id))
    .returning();

  await createNotification({
    userId,
    type: 'subscription',
    title: 'Subscription cancelled',
    body: 'Your access stays active until the end of the current billing period. You can renew any time.',
    link: '/billing',
  });

  await recordAudit({
    actorId: userId,
    action: 'subscription.canceled',
    targetType: 'subscription',
    targetId: target.id,
  });

  return updated!;
}

/** Cron: expire subscriptions whose period has ended. */
export async function expireSubscriptions(): Promise<{ expired: number; downgraded: number }> {
  const db = getDb();
  const now = new Date();
  const expiredRows = await db
    .update(subscriptions)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        inArray(subscriptions.status, ['active', 'trialing', 'past_due', 'canceled']),
        lt(subscriptions.currentPeriodEnd, now),
      ),
    )
    .returning({ id: subscriptions.id, userId: subscriptions.userId });

  const affectedUsers = [...new Set(expiredRows.map((r) => r.userId))];
  let downgraded = 0;
  for (const userId of affectedUsers) {
    const [before] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
    await recomputeUserPlan(userId);
    const [after] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (before?.plan === 'premium' && after?.plan === 'free') {
      downgraded += 1;
      await createNotification({
        userId,
        type: 'subscription',
        title: 'Your pass has ended',
        body: 'Full access has ended. Renew any time to restore unlimited questions.',
        link: '/pricing',
      });
    }
  }
  return { expired: expiredRows.length, downgraded };
}

/* ------------------------------------------------------------------ */
/* Access grants (admin)                                               */
/* ------------------------------------------------------------------ */

export interface GrantAccessInput {
  userId: string;
  scope: AccessScope;
  examKey?: string;
  examKeys?: string[];
  providerId?: string;
  note?: string;
  expiresAt?: Date;
  grantedBy: string;
}

export async function createAccessGrant(input: GrantAccessInput) {
  const db = getDb();
  const keys = [...new Set([...(input.examKeys ?? []), ...(input.examKey ? [input.examKey] : [])])];
  if (input.scope === 'single' && keys.length === 0) {
    throw badRequest('An exam is required for single-exam access grants.');
  }
  if (input.scope === 'multi' && keys.length === 0) {
    throw badRequest('At least one exam is required for multi-exam access grants.');
  }
  const created = [];
  if (input.scope === 'all') {
    const [grant] = await db
      .insert(accessGrants)
      .values({
        userId: input.userId,
        scope: 'all',
        examKey: null,
        providerId: input.providerId ?? null,
        source: 'admin',
        grantedBy: input.grantedBy,
        note: input.note ?? '',
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    created.push(grant!);
  } else {
    for (const key of keys) {
      const [grant] = await db
        .insert(accessGrants)
        .values({
          userId: input.userId,
          scope: input.scope,
          examKey: key,
          providerId: input.providerId ?? null,
          source: 'admin',
          grantedBy: input.grantedBy,
          note: input.note ?? '',
          expiresAt: input.expiresAt ?? null,
        })
        .returning();
      created.push(grant!);
    }
  }
  await recomputeUserPlan(input.userId);
  await recordAudit({
    actorId: input.grantedBy,
    action: 'grant.created',
    targetType: 'user',
    targetId: input.userId,
    metadata: { scope: input.scope, examKeys: keys },
  });
  return created;
}

export async function revokeAccessGrant(grantId: string, actorId: string): Promise<void> {
  const db = getDb();
  const [grant] = await db.select().from(accessGrants).where(eq(accessGrants.id, grantId)).limit(1);
  if (!grant) throw notFound('Access grant not found.');
  await db.update(accessGrants).set({ revokedAt: new Date() }).where(eq(accessGrants.id, grantId));
  await recomputeUserPlan(grant.userId);
  await recordAudit({
    actorId,
    action: 'grant.revoked',
    targetType: 'user',
    targetId: grant.userId,
    metadata: { grantId },
  });
}

export async function listAccessGrants(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(accessGrants)
    .where(eq(accessGrants.userId, userId))
    .orderBy(desc(accessGrants.grantedAt));
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

export interface RefundOutcome {
  refund: typeof refunds.$inferSelect;
  gatewayRef?: string;
  /** true when the gateway call succeeded (or no gateway call was needed). */
  processed: boolean;
  message: string;
}

/**
 * Refund a payment.
 *
 * - Live HyperSwitch payments are refunded through the gateway first; the local
 *   record only moves to `succeeded` when the gateway accepts the refund.
 * - Mock/manual payments are recorded locally (they never moved money).
 * - Access tied to the refunded payment is revoked immediately.
 */
export async function refundPayment(
  env: Env,
  paymentId: string,
  amountMinor: number | undefined,
  reason: string,
  actor: { id: string; email?: string | null },
): Promise<RefundOutcome> {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw notFound('Payment not found.');
  if (payment.status === 'failed' || payment.status === 'pending') {
    throw badRequest('Only captured payments can be refunded.');
  }

  const remaining = payment.amountMinor - payment.refundedMinor;
  const amount = amountMinor ?? remaining;
  if (amount <= 0 || amount > remaining) {
    throw badRequest(`You can refund up to ${(remaining / 100).toFixed(2)} ${payment.currency}.`);
  }

  // Enforce PAYMENT_MAX_REFUNDS atomically. The count and the amount claim are
  // evaluated inside a single conditional UPDATE, so two concurrent refunds can
  // never both observe the same refund count and both proceed. A read-then-write
  // check here would allow exactly that race.
  const maxRefunds = env.PAYMENT_MAX_REFUNDS;
  const [claimed] = await db
    .update(payments)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(payments.id, paymentId),
        eq(payments.refundedMinor, payment.refundedMinor),
        sql`(select count(*) from ${refunds}
              where ${refunds.paymentId} = ${paymentId}
                and ${refunds.status} <> 'failed') < ${maxRefunds}`,
      ),
    )
    .returning({ id: payments.id });
  if (!claimed) {
    // Either the refunded amount moved under us (a concurrent refund won) or the
    // refund-count ceiling has been reached.
    const [countRow] = await db
      .select({ refundCount: count() })
      .from(refunds)
      .where(and(eq(refunds.paymentId, paymentId), ne(refunds.status, 'failed')));
    const refundCount = countRow?.refundCount ?? 0;
    if (refundCount >= maxRefunds) {
      throw badRequest(
        `This payment has reached the limit of ${maxRefunds} refunds. Further refunds require manual review.`,
      );
    }
    throw conflict('The payment was modified while the refund was being created. Please retry.');
  }

  const [refund] = await db
    .insert(refunds)
    .values({
      paymentId,
      userId: payment.userId,
      amountMinor: amount,
      reason,
      status: 'pending',
      createdBy: actor.id,
    })
    .returning();
  if (!refund) throw new Error('Failed to create the refund record.');

  let gatewayRef = '';
  let processed = true;
  let message = 'Refund recorded.';

  if (payment.provider === 'hyperswitch' && payment.providerPaymentId) {
    const { createRefund } = await import('./hyperswitch.client.js');
    try {
      const result = await createRefund(env, payment.providerPaymentId, {
        amountMinor: amount,
        reason: reason || 'requested_by_customer',
        refundId: refund.id,
      });
      gatewayRef = result.refund_id;
      const gatewayStatus = (result.status ?? '').toLowerCase();
      processed = !['failed', 'failed_'].includes(gatewayStatus);
      message =
        gatewayStatus === 'succeeded' || gatewayStatus === 'processed'
          ? 'Refund processed by HyperSwitch.'
          : `Refund submitted to HyperSwitch (status: ${gatewayStatus || 'pending'}).`;
    } catch (err) {
      processed = false;
      message = `The gateway rejected the refund: ${(err as Error).message}`;
    }
  } else if (payment.provider === 'razorpay' && payment.providerRef) {
    // ExamDump Pay: issue the refund through the configured adapter. The
    // refund id is our own row id, which the adapter forwards as a receipt.
    const { resolvePaymentAdapter } = await import('./payments/registry.js');
    const availability = resolvePaymentAdapter(env);
    if (!availability.adapter) {
      processed = false;
      message = 'Payments are not currently available, so the refund could not be submitted.';
    } else {
      try {
        const result = await availability.adapter.refund(env, {
          paymentId: payment.providerRef,
          amountMinor: amount,
          refundRef: refund.id,
          reason: reason || 'requested_by_customer',
        });
        gatewayRef = result.refundId;
        processed = result.status !== 'failed';
        message =
          result.status === 'succeeded'
            ? 'Refund processed by the payment provider.'
            : `Refund submitted (status: ${result.status}).`;
      } catch (err) {
        processed = false;
        message = `The payment provider rejected the refund: ${(err as Error).message}`;
      }
    }
  }

  await db
    .update(refunds)
    .set({ status: processed ? 'succeeded' : 'failed', providerRef: gatewayRef, createdAt: new Date() })
    .where(eq(refunds.id, refund.id));

  if (processed) {
    const refundedMinor = payment.refundedMinor + amount;
    await db
      .update(payments)
      .set({
        refundedMinor,
        status: refundedMinor >= payment.amountMinor ? 'refunded' : 'partially_refunded',
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    if (payment.subscriptionId) {
      const now = new Date();
      await db
        .update(subscriptions)
        .set({
          status: 'expired',
          canceledAt: now,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: now,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, payment.subscriptionId));
      await recomputeUserPlan(payment.userId);
    }

    await createNotification({
      userId: payment.userId,
      type: 'subscription',
      title: 'Refund issued',
      body: `${payment.currency} ${(amount / 100).toFixed(2)} has been refunded. It can take 5-7 business days to appear.`,
      link: '/billing',
    });

    // Email the customer. Best-effort: the refund is already recorded.
    try {
      const { sendTransactionalMail } = await import('./mail/mail.service.js');
      const [refundUser] = await db.select().from(users).where(eq(users.id, payment.userId)).limit(1);
      if (refundUser) {
        await sendTransactionalMail(env, {
          to: refundUser.email,
          template: 'refund_processed',
          userId: refundUser.id,
          referenceId: paymentId,
          data: {
            name: refundUser.name,
            amount: formatMoneyMinor(amount, payment.currency),
            reference: paymentId.slice(0, 8).toUpperCase(),
            reason: reason || undefined,
          },
        });
      }
    } catch {
      /* mail is best-effort */
    }
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email ?? null,
    action: processed ? 'refund.processed' : 'refund.failed',
    targetType: 'payment',
    targetId: paymentId,
    metadata: { amountMinor: amount, reason, gatewayRef, processed },
  });

  return { refund: { ...refund, status: processed ? 'succeeded' : 'failed', providerRef: gatewayRef }, gatewayRef, processed, message };
}

/* ------------------------------------------------------------------ */
/* Referrals                                                           */
/* ------------------------------------------------------------------ */

export async function getReferralStats(userId: string) {
  const db = getDb();
  const [[totalRow], referralRows, [user]] = await Promise.all([
    db.select({ value: count() }).from(referrals).where(eq(referrals.referrerId, userId)),
    db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerId, userId))
      .orderBy(desc(referrals.createdAt))
      .limit(25),
    db.select().from(users).where(eq(users.id, userId)).limit(1),
  ]);

  return {
    code: user?.referralCode ?? '',
    totalReferrals: Number(totalRow?.value ?? 0),
    totalRewardDays: referralRows.reduce((sum, r) => sum + r.rewardDays, 0),
    referrals: referralRows.map((r) => ({
      id: r.id,
      status: r.status,
      rewardDays: r.rewardDays,
      createdAt: r.createdAt,
    })),
    shareUrl: '',
  };
}

/* ------------------------------------------------------------------ */
/* Development-only activation (no money moves)                        */
/* ------------------------------------------------------------------ */

/**
 * Activate a plan without a payment. Only reachable when live checkout is not
 * configured (see routes/payments.ts), so a production deployment can never
 * grant access this way. The payment row is labelled `mock` and the
 * description says "no charge" so it is distinguishable from real revenue.
 */
export async function activateMockPlan(user: User, input: QuoteInput) {
  const quote = await quotePlan(user.id, input);
  const db = getDb();
  const now = new Date();

  const [payment] = await db
    .insert(payments)
    .values({
      userId: user.id,
      amountMinor: quote.totalMinor,
      discountMinor: quote.discountMinor,
      currency: quote.currency,
      // Pending, then settled through the exact same path a real gateway
      // payment uses (idempotent tx + entitlement grant).
      status: 'pending',
      provider: 'mock',
      providerRef: `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      orderRef: `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      description: `${quote.plan.name} - simulated activation, no charge`,
      metadata: {
        planId: quote.plan.id,
        planName: quote.plan.name,
        examKeys: quote.examKeys,
        couponCode: quote.couponCode,
        simulated: true,
      },
      paidAt: now,
    })
    .returning();
  if (!payment) throw new Error('Failed to record the simulated payment.');

  const result = await settlePayment(payment.id, { gatewayStatus: 'succeeded', source: 'return' });
  await issueInvoice(payment.id);

  const [subscription] = result.subscriptionId
    ? await db.select().from(subscriptions).where(eq(subscriptions.id, result.subscriptionId)).limit(1)
    : [undefined];
  const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'subscription.created',
    targetType: 'subscription',
    targetId: result.subscriptionId ?? '',
    metadata: { simulated: true, planId: quote.plan.id },
  });

  return { subscription, payment: fresh, plan: quote.plan };
}
