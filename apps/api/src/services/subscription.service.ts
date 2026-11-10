import type { HydratedDocument, Types } from 'mongoose';
import type { Env } from '../config/env.js';
import {
  Coupon,
  CouponRedemption,
  Payment,
  Plan,
  Referral,
  Subscription,
  User,
  type PaymentDoc,
  type PlanDoc,
  type SubscriptionDoc,
  type UserDoc,
} from '../db/models/index.js';
import { conflict, notFound, serviceUnavailable } from '../lib/errors.js';
import { createNotification } from './notification.service.js';
import { recordAudit } from './audit.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_PLANS: Array<Omit<PlanDoc, '_id' | 'createdAt' | 'updatedAt'>> = [
  {
    planId: 'premium-monthly',
    name: 'Premium Monthly',
    description: 'Unlimited access to every exam, mock tests and AI explanations.',
    monthlyPrice: 12,
    yearlyPrice: 0,
    currency: 'USD',
    features: [
      'Unlimited questions on every exam',
      'Unlimited mock & timed exams',
      'AI explanations',
      'Weak-topic analytics',
      'Priority support',
    ],
    active: true,
    sortOrder: 1,
  },
  {
    planId: 'premium-yearly',
    name: 'Premium Yearly',
    description: 'Everything in Premium Monthly, billed annually with a big discount.',
    monthlyPrice: 0,
    yearlyPrice: 89,
    currency: 'USD',
    features: [
      'All Premium features',
      'Save over 35% vs monthly',
      'Unlimited mock & timed exams',
      'AI explanations',
      'Priority support',
    ],
    active: true,
    sortOrder: 2,
  },
];

export async function ensureDefaultPlans(): Promise<void> {
  const count = await Plan.countDocuments();
  if (count > 0) return;
  await Plan.insertMany(DEFAULT_PLANS);
}

export async function listPlans(): Promise<PlanDoc[]> {
  return Plan.find({ active: true }).sort({ sortOrder: 1, monthlyPrice: 1 }).lean<PlanDoc[]>();
}

export async function listAllPlans(): Promise<PlanDoc[]> {
  return Plan.find().sort({ sortOrder: 1 }).lean<PlanDoc[]>();
}

export interface CouponValidation {
  valid: boolean;
  code: string;
  percentOff: number;
  message: string;
}

export async function validateCoupon(
  code: string,
  userId?: Types.ObjectId | string,
): Promise<CouponValidation> {
  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (!coupon || !coupon.active) {
    return { valid: false, code, percentOff: 0, message: 'This coupon code is not valid.' };
  }
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
    return { valid: false, code, percentOff: 0, message: 'This coupon has expired.' };
  }
  if (coupon.maxRedemptions > 0 && coupon.redemptionCount >= coupon.maxRedemptions) {
    return { valid: false, code, percentOff: 0, message: 'This coupon has reached its redemption limit.' };
  }
  if (userId) {
    const already = await CouponRedemption.exists({ couponId: coupon._id, userId });
    if (already) {
      return { valid: false, code, percentOff: 0, message: 'You have already used this coupon.' };
    }
  }
  return {
    valid: true,
    code: coupon.code,
    percentOff: coupon.percentOff,
    message: `${coupon.percentOff}% off applied.`,
  };
}

export interface CreateSubscriptionInput {
  planId: string;
  billingCycle: 'monthly' | 'yearly';
  couponCode?: string;
}

export async function createMockSubscription(
  env: Env,
  user: UserDoc,
  input: CreateSubscriptionInput,
): Promise<{ subscription: HydratedDocument<SubscriptionDoc>; payment: HydratedDocument<PaymentDoc> }> {
  if (env.PAYMENTS_ENABLED) {
    throw serviceUnavailable('Card payments are not enabled yet. Please check back soon.');
  }
  if (!env.ALLOW_MOCK_PAYMENTS) {
    throw serviceUnavailable('Payments are currently disabled.');
  }

  const plan = await Plan.findOne({ planId: input.planId, active: true });
  if (!plan) throw notFound('Plan not found');
  if (input.billingCycle === 'monthly' && plan.monthlyPrice <= 0) {
    throw conflict('This plan is not available monthly.');
  }
  if (input.billingCycle === 'yearly' && plan.yearlyPrice <= 0) {
    throw conflict('This plan is not available yearly.');
  }

  let discountPercent = 0;
  let coupon = null;
  if (input.couponCode) {
    const validation = await validateCoupon(input.couponCode, user._id);
    if (!validation.valid) throw conflict(validation.message);
    coupon = await Coupon.findOne({ code: input.couponCode.toUpperCase() });
    discountPercent = validation.percentOff;
  }

  const gross = input.billingCycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
  const discount = Math.round(((gross * discountPercent) / 100) * 100) / 100;
  const amount = Math.max(0, Math.round((gross - discount) * 100) / 100);

  // Supersede any existing active subscription (upgrade / plan change).
  await Subscription.updateMany(
    { userId: user._id, status: { $in: ['active', 'trialing', 'past_due'] } },
    { $set: { status: 'canceled', canceledAt: new Date() } },
  );

  const periodDays = input.billingCycle === 'yearly' ? 365 : 30;
  const currentPeriodEnd = new Date(Date.now() + periodDays * DAY_MS);

  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan.planId,
    billingCycle: input.billingCycle,
    status: 'active',
    price: amount,
    currency: plan.currency,
    couponCode: coupon?.code ?? null,
    discountPercent,
    startedAt: new Date(),
    currentPeriodEnd,
    mock: true,
  });

  const payment = await Payment.create({
    userId: user._id,
    subscriptionId: subscription._id,
    amount,
    discount,
    currency: plan.currency,
    status: 'succeeded',
    provider: 'mock',
    reference: `MOCK-${subscription._id.toString().slice(-10).toUpperCase()}`,
    description: `${plan.name} (${input.billingCycle}) - simulated payment, no charge`,
  });

  if (coupon) {
    await CouponRedemption.create({
      couponId: coupon._id,
      userId: user._id,
      subscriptionId: subscription._id,
    });
    await Coupon.updateOne({ _id: coupon._id }, { $inc: { redemptionCount: 1 } });
  }

  const base = user.premiumUntil && user.premiumUntil.getTime() > Date.now() ? user.premiumUntil : new Date();
  await User.updateOne(
    { _id: user._id },
    { $set: { plan: 'premium', premiumUntil: new Date(base.getTime() + periodDays * DAY_MS) } },
  );

  await createNotification({
    userId: user._id,
    type: 'subscription',
    title: 'Premium activated',
    body: `${plan.name} is now active. Enjoy unlimited access.`,
    link: '/dashboard',
  });

  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'subscription.created',
    targetType: 'subscription',
    targetId: subscription._id.toString(),
    metadata: { planId: plan.planId, amount, mock: true },
  });

  return { subscription, payment };
}

export async function getCurrentSubscription(userId: Types.ObjectId | string) {
  return Subscription.findOne({
    userId,
    $or: [
      { status: { $in: ['active', 'trialing', 'past_due'] } },
      { status: 'canceled', currentPeriodEnd: { $gt: new Date() } },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();
}

export async function listPayments(userId: Types.ObjectId | string, limit = 50) {
  return Payment.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function cancelSubscription(userId: Types.ObjectId | string) {
  const subscription = await Subscription.findOne({
    userId,
    status: { $in: ['active', 'trialing', 'past_due'] },
  });
  if (!subscription) throw notFound('No active subscription found.');

  subscription.cancelAtPeriodEnd = true;
  subscription.canceledAt = new Date();
  subscription.status = 'canceled';
  await subscription.save();

  await createNotification({
    userId: userId as Types.ObjectId,
    type: 'subscription',
    title: 'Subscription canceled',
    body: 'Your Premium access will remain active until the end of the current billing period.',
  });

  await recordAudit({
    actorId: userId as Types.ObjectId,
    action: 'subscription.canceled',
    targetType: 'subscription',
    targetId: subscription._id.toString(),
  });

  return subscription;
}

/** Cron: expire subscriptions and downgrade users whose premium has lapsed. */
export async function expireSubscriptions(): Promise<{ expired: number; downgraded: number }> {
  const now = new Date();
  const expired = await Subscription.find({
    status: { $in: ['active', 'trialing', 'past_due', 'canceled'] },
    currentPeriodEnd: { $lte: now },
  });

  for (const sub of expired) {
    sub.status = 'expired';
    await sub.save();
  }

  const lapsed = await User.find({
    plan: 'premium',
    premiumUntil: { $ne: null, $lte: now },
  });
  for (const user of lapsed) {
    user.plan = 'free';
    user.premiumUntil = null;
    await user.save();
    await createNotification({
      userId: user._id,
      type: 'subscription',
      title: 'Premium has ended',
      body: 'Your Premium access has lapsed. Renew any time to restore unlimited access.',
      link: '/pricing',
    });
  }

  return { expired: expired.length, downgraded: lapsed.length };
}

export async function getReferralStats(userId: Types.ObjectId | string) {
  const [total, referrals] = await Promise.all([
    Referral.countDocuments({ referrerId: userId }),
    Referral.find({ referrerId: userId }).sort({ createdAt: -1 }).limit(25).lean(),
  ]);
  const user = await User.findById(userId).lean();
  return {
    code: user?.referralCode ?? '',
    totalReferrals: total,
    totalRewardDays: referrals.reduce((sum, r) => sum + r.rewardDays, 0),
    referrals: referrals.map((r) => ({
      id: r._id.toString(),
      status: r.status,
      rewardDays: r.rewardDays,
      createdAt: r.createdAt,
    })),
    shareUrl: '',
  };
}