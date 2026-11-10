import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import {
  accessScopeEnum,
  billingCycleEnum,
  grantSourceEnum,
  paymentProviderEnum,
  paymentStatusEnum,
  refundStatusEnum,
  referralStatusEnum,
  subscriptionStatusEnum,
} from './enums';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const plans = pgTable(
  'plans',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    scope: accessScopeEnum('scope').notNull().default('single'),
    durationDays: integer('duration_days').notNull().default(30),
    earlyAccess: boolean('early_access').notNull().default(false),
    priceMinor: integer('price_minor').notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    features: jsonb('features').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [index('plans_active_idx').on(t.active, t.sortOrder)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    scope: accessScopeEnum('scope').notNull(),
    billingCycle: billingCycleEnum('billing_cycle').notNull().default('fixed'),
    status: subscriptionStatusEnum('status').notNull().default('pending'),
    examKey: text('exam_key'),
    providerId: text('provider_id'),
    examTitle: text('exam_title'),
    priceMinor: integer('price_minor').notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    couponCode: text('coupon_code'),
    discountMinor: integer('discount_minor').notNull().default(0),
    earlyAccess: boolean('early_access').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    autoRenew: boolean('auto_renew').notNull().default(false),
    provider: paymentProviderEnum('provider').notNull().default('mock'),
    providerRef: text('provider_ref'),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('subscriptions_user_status_idx').on(t.userId, t.status),
    index('subscriptions_period_end_idx').on(t.currentPeriodEnd),
    index('subscriptions_exam_idx').on(t.examKey),
  ],
);

export const accessGrants = pgTable(
  'access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: accessScopeEnum('scope').notNull(),
    providerId: text('provider_id'),
    examKey: text('exam_key'),
    source: grantSourceEnum('source').notNull().default('admin'),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'cascade',
    }),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    note: text('note').notNull().default(''),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('access_grants_user_idx').on(t.userId, t.revokedAt),
    index('access_grants_exam_idx').on(t.examKey),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    amountMinor: integer('amount_minor').notNull().default(0),
    discountMinor: integer('discount_minor').notNull().default(0),
    refundedMinor: integer('refunded_minor').notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    status: paymentStatusEnum('status').notNull().default('succeeded'),
    provider: paymentProviderEnum('provider').notNull().default('mock'),
    providerRef: text('provider_ref').notNull().default(''),
    description: text('description').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('payments_user_created_idx').on(t.userId, t.createdAt),
    index('payments_status_idx').on(t.status),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull().default(0),
    reason: text('reason').notNull().default(''),
    status: refundStatusEnum('status').notNull().default('succeeded'),
    providerRef: text('provider_ref').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
  },
  (t) => [
    index('refunds_payment_idx').on(t.paymentId),
    index('refunds_user_idx').on(t.userId),
  ],
);

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    description: text('description').notNull().default(''),
    percentOff: integer('percent_off').notNull().default(0),
    maxRedemptions: integer('max_redemptions').notNull().default(0),
    redemptionCount: integer('redemption_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('coupons_code_unique').on(t.code),
    index('coupons_active_idx').on(t.active),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    createdAt,
  },
  (t) => [uniqueIndex('coupon_redemptions_unique').on(t.couponId, t.userId)],
);

export const referrals = pgTable(
  'referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refereeId: uuid('referee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    status: referralStatusEnum('status').notNull().default('completed'),
    rewardDays: integer('reward_days').notNull().default(7),
    createdAt,
  },
  (t) => [
    uniqueIndex('referrals_referee_unique').on(t.refereeId),
    index('referrals_referrer_idx').on(t.referrerId, t.createdAt),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type AccessGrant = typeof accessGrants.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
