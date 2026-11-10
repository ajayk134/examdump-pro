import { and, count, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import {
  DEFAULT_PLAN_DEFINITIONS,
  type AccessScope,
  type PlanDefinition,
} from '@examdump/shared';
import type { Env } from '../config/env.js';
import { getDb } from '../db/client.js';
import {
  accessGrants,
  couponRedemptions,
  coupons,
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
import { createNotification } from './notification.service.js';
import { recordAudit } from './audit.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanSeed = PlanDefinition;

export const DEFAULT_PLANS: readonly PlanDefinition[] = DEFAULT_PLAN_DEFINITIONS;

export async function ensureDefaultPlans(): Promise<void> {
  const db = getDb();
  for (const plan of DEFAULT_PLAN_DEFINITIONS) {
    await db
      .insert(plans)
      .values({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        scope: plan.scope,
        durationDays: plan.durationDays,
        earlyAccess: plan.earlyAccess,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        features: [...plan.features],
        active: plan.active,
        sortOrder: plan.sortOrder,
      })
      .onConflictDoNothing();
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

export interface CreateSubscriptionInput {
  planId: string;
  examKey?: string;
  providerId?: string;
  couponCode?: string;
}

export interface SubscriptionCheckout {
  subscription: Subscription;
  payment: typeof payments.$inferSelect;
  plan: Plan;
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

async function supersede(input: { userId: string; scope: AccessScope; examKey?: string | null }): Promise<void> {
  const db = getDb();
  const now = new Date();
  if (input.scope === 'all') {
    await db
      .update(subscriptions)
      .set({ status: 'canceled', canceledAt: now, cancelAtPeriodEnd: false, updatedAt: now })
      .where(
        and(
          eq(subscriptions.userId, input.userId),
          inArray(subscriptions.status, ['active', 'trialing', 'past_due', 'pending']),
        ),
      );
    return;
  }
  if (input.examKey) {
    await db
      .update(subscriptions)
      .set({ status: 'canceled', canceledAt: now, cancelAtPeriodEnd: false, updatedAt: now })
      .where(
        and(
          eq(subscriptions.userId, input.userId),
          eq(subscriptions.scope, 'single'),
          eq(subscriptions.examKey, input.examKey),
          inArray(subscriptions.status, ['active', 'trialing', 'past_due', 'pending']),
        ),
      );
  }
}

/**
 * Create a paid subscription. Pricing is resolved entirely on the server from
 * the plan record — the client can never influence the amount.
 */
export async function createSubscription(
  env: Env,
  user: User,
  input: CreateSubscriptionInput,
): Promise<SubscriptionCheckout> {
  if (env.PAYMENTS_ENABLED) {
    throw serviceUnavailable('Live card payments are not enabled yet. Please check back soon.');
  }
  if (!env.ALLOW_MOCK_PAYMENTS) {
    throw serviceUnavailable('Payments are currently disabled.');
  }

  const db = getDb();
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, input.planId), eq(plans.active, true)))
    .limit(1);
  if (!plan) throw notFound('Plan not found');

  let examKey: string | null = null;
  let providerId: string | null = null;
  let examTitle: string | null = null;
  if (plan.scope === 'single') {
    if (!input.examKey) throw badRequest('Select the exam you want to unlock.');
    examKey = input.examKey;
    providerId = input.providerId ?? null;
    examTitle = null;
  }

  let discountPercent = 0;
  let coupon: typeof coupons.$inferSelect | null = null;
  if (input.couponCode) {
    const validation = await validateCoupon(input.couponCode, user.id);
    if (!validation.valid) throw conflict(validation.message);
    const [found] = await db.select().from(coupons).where(eq(coupons.code, validation.code)).limit(1);
    coupon = found ?? null;
    discountPercent = validation.percentOff;
  }

  const grossMinor = plan.priceMinor;
  const discountMinor = Math.round((grossMinor * discountPercent) / 100);
  const amountMinor = Math.max(0, grossMinor - discountMinor);

  await supersede({ userId: user.id, scope: plan.scope, examKey });

  const now = new Date();
  const currentPeriodEnd = new Date(now.getTime() + plan.durationDays * DAY_MS);

  const [subscription] = await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      planId: plan.id,
      scope: plan.scope,
      status: 'active',
      examKey,
      providerId,
      examTitle,
      priceMinor: amountMinor,
      currency: plan.currency,
      couponCode: coupon?.code ?? null,
      discountMinor,
      earlyAccess: plan.earlyAccess,
      startedAt: now,
      currentPeriodEnd,
      autoRenew: false,
      provider: 'mock',
      providerRef: `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    })
    .returning();
  if (!subscription) throw new Error('Subscription insert failed');

  const [payment] = await db
    .insert(payments)
    .values({
      userId: user.id,
      subscriptionId: subscription.id,
      amountMinor,
      discountMinor,
      currency: plan.currency,
      status: 'succeeded',
      provider: 'mock',
      providerRef: subscription.providerRef ?? '',
      description: `${plan.name} - simulated payment, no charge`,
    })
    .returning();

  if (coupon) {
    await db.insert(couponRedemptions).values({
      couponId: coupon.id,
      userId: user.id,
      subscriptionId: subscription.id,
    });
    await db
      .update(coupons)
      .set({ redemptionCount: coupon.redemptionCount + 1, updatedAt: now })
      .where(eq(coupons.id, coupon.id));
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'coupon.redeemed',
      targetType: 'coupon',
      targetId: coupon.id,
      metadata: { code: coupon.code, percentOff: coupon.percentOff },
    });
  }

  await recomputeUserPlan(user.id);

  await createNotification({
    userId: user.id,
    type: 'subscription',
    title: 'Subscription activated',
    body: `${plan.name} is now active${plan.scope === 'single' && examKey ? ` for ${examKey}` : ''}.`,
    link: '/pricing',
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'subscription.created',
    targetType: 'subscription',
    targetId: subscription.id,
    metadata: { planId: plan.id, scope: plan.scope, examKey, amountMinor, currency: plan.currency },
  });

  return { subscription, payment: payment!, plan };
}

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
        or(
          inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
          eq(subscriptions.status, 'canceled'),
        ),
      ),
    )
    .orderBy(desc(subscriptions.createdAt));
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

export async function cancelSubscription(userId: string, subscriptionId?: string): Promise<Subscription> {
  const db = getDb();
  const target = subscriptionId
    ? (await db.select().from(subscriptions).where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId))).limit(1))[0]
    : await getCurrentSubscription(userId);
  if (!target) throw notFound('No active subscription found.');

  const [updated] = await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, canceledAt: new Date(), status: 'canceled', updatedAt: new Date() })
    .where(eq(subscriptions.id, target.id))
    .returning();

  await createNotification({
    userId,
    type: 'subscription',
    title: 'Subscription canceled',
    body: 'Your access will remain active until the end of the current billing period.',
  });

  await recordAudit({
    actorId: userId,
    action: 'subscription.canceled',
    targetType: 'subscription',
    targetId: target.id,
  });

  return updated!;
}

/** Upgrade/downgrade: create the new plan and supersede what it replaces. */
export async function changeSubscription(
  env: Env,
  user: User,
  input: CreateSubscriptionInput,
): Promise<SubscriptionCheckout> {
  return createSubscription(env, user, input);
}

/** Cron: expire subscriptions and downgrade users whose access has lapsed. */
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
        title: 'Subscription ended',
        body: 'Your access has lapsed. Renew any time to restore full access.',
        link: '/pricing',
      });
    }
  }
  return { expired: expiredRows.length, downgraded };
}

/* ------------------------------------------------------------------ */
/* Access grants (admin)                                              */
/* ------------------------------------------------------------------ */

export interface GrantAccessInput {
  userId: string;
  scope: AccessScope;
  examKey?: string;
  providerId?: string;
  note?: string;
  expiresAt?: Date;
  grantedBy: string;
}

export async function createAccessGrant(input: GrantAccessInput) {
  const db = getDb();
  if (input.scope === 'single' && !input.examKey) {
    throw badRequest('An exam is required for single-exam access grants.');
  }
  const [grant] = await db
    .insert(accessGrants)
    .values({
      userId: input.userId,
      scope: input.scope,
      examKey: input.examKey ?? null,
      providerId: input.providerId ?? null,
      source: 'admin',
      grantedBy: input.grantedBy,
      note: input.note ?? '',
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  await recomputeUserPlan(input.userId);
  await recordAudit({
    actorId: input.grantedBy,
    action: 'grant.created',
    targetType: 'user',
    targetId: input.userId,
    metadata: { scope: input.scope, examKey: input.examKey ?? null },
  });
  return grant!;
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
/* Refunds                                                            */
/* ------------------------------------------------------------------ */

export async function refundPayment(
  paymentId: string,
  amountMinor: number | undefined,
  reason: string,
  actorId: string,
) {
  const db = getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw notFound('Payment not found.');

  const remaining = payment.amountMinor - payment.refundedMinor;
  const amount = amountMinor ?? remaining;
  if (amount <= 0 || amount > remaining) throw badRequest('Refund amount exceeds the refundable balance.');

  const [refund] = await db
    .insert(refunds)
    .values({
      paymentId,
      userId: payment.userId,
      amountMinor: amount,
      reason,
      status: 'succeeded',
      providerRef: payment.providerRef,
      createdBy: actorId,
    })
    .returning();

  const refundedMinor = payment.refundedMinor + amount;
  await db
    .update(payments)
    .set({
      refundedMinor,
      status: refundedMinor >= payment.amountMinor ? 'refunded' : 'partially_refunded',
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId));

  // Refunds revoke access immediately (unlike a user cancellation, which
  // remains valid until the end of the current period).
  if (payment.subscriptionId) {
    const now = new Date();
    await db
      .update(subscriptions)
      .set({ status: 'expired', canceledAt: now, cancelAtPeriodEnd: false, currentPeriodEnd: now, updatedAt: now })
      .where(eq(subscriptions.id, payment.subscriptionId));
    await recomputeUserPlan(payment.userId);
  }

  await recordAudit({
    actorId,
    action: 'payment.refunded',
    targetType: 'payment',
    targetId: paymentId,
    metadata: { amountMinor: amount, reason },
  });
  return refund!;
}

/* ------------------------------------------------------------------ */
/* Referrals                                                          */
/* ------------------------------------------------------------------ */

export async function getReferralStats(userId: string) {
  const db = getDb();
  const [[totalRow], referralRows, [user]] = await Promise.all([
    db.select({ value: count() }).from(referrals).where(eq(referrals.referrerId, userId)),
    db.select().from(referrals).where(eq(referrals.referrerId, userId)).orderBy(desc(referrals.createdAt)).limit(25),
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
