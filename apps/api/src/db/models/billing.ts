import mongoose, { Schema, type Model, type Types } from 'mongoose';
import { SUBSCRIPTION_STATUS, type SubscriptionStatus } from '@examdump/shared';

export interface PlanDoc {
  _id: Types.ObjectId;
  planId: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  features: string[];
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema<PlanDoc>(
  {
    planId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    monthlyPrice: { type: Number, required: true, default: 0 },
    yearlyPrice: { type: Number, required: true, default: 0 },
    currency: { type: String, default: 'USD' },
    features: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Plan: Model<PlanDoc> =
  (mongoose.models.Plan as Model<PlanDoc>) ?? mongoose.model<PlanDoc>('Plan', planSchema);

export interface SubscriptionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  planId: string;
  billingCycle: 'monthly' | 'yearly';
  status: SubscriptionStatus;
  price: number;
  currency: string;
  couponCode?: string | null;
  discountPercent: number;
  startedAt: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date | null;
  mock: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<SubscriptionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planId: { type: String, required: true, index: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
    status: { type: String, enum: SUBSCRIPTION_STATUS, default: 'pending', index: true },
    price: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    couponCode: { type: String, default: null },
    discountPercent: { type: Number, default: 0 },
    startedAt: { type: Date, default: () => new Date() },
    currentPeriodEnd: { type: Date, required: true },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: { type: Date, default: null },
    mock: { type: Boolean, default: true },
  },
  { timestamps: true },
);

subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ currentPeriodEnd: 1 });

export const Subscription: Model<SubscriptionDoc> =
  (mongoose.models.Subscription as Model<SubscriptionDoc>) ??
  mongoose.model<SubscriptionDoc>('Subscription', subscriptionSchema);

export type PaymentStatus = 'succeeded' | 'pending' | 'failed' | 'refunded';

export interface PaymentDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  subscriptionId?: Types.ObjectId | null;
  amount: number;
  discount: number;
  currency: string;
  status: PaymentStatus;
  provider: 'mock' | 'manual' | 'none';
  reference: string;
  description: string;
  createdAt: Date;
}

const paymentSchema = new Schema<PaymentDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },
    amount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    status: { type: String, enum: ['succeeded', 'pending', 'failed', 'refunded'], default: 'succeeded' },
    provider: { type: String, enum: ['mock', 'manual', 'none'], default: 'mock' },
    reference: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

paymentSchema.index({ userId: 1, createdAt: -1 });

export const Payment: Model<PaymentDoc> =
  (mongoose.models.Payment as Model<PaymentDoc>) ?? mongoose.model<PaymentDoc>('Payment', paymentSchema);

export interface CouponDoc {
  _id: Types.ObjectId;
  code: string;
  description: string;
  percentOff: number;
  maxRedemptions: number;
  redemptionCount: number;
  expiresAt?: Date | null;
  active: boolean;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<CouponDoc>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    description: { type: String, default: '' },
    percentOff: { type: Number, required: true, min: 1, max: 100 },
    maxRedemptions: { type: Number, default: 0 },
    redemptionCount: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const Coupon: Model<CouponDoc> =
  (mongoose.models.Coupon as Model<CouponDoc>) ?? mongoose.model<CouponDoc>('Coupon', couponSchema);

export interface CouponRedemptionDoc {
  _id: Types.ObjectId;
  couponId: Types.ObjectId;
  userId: Types.ObjectId;
  subscriptionId?: Types.ObjectId | null;
  createdAt: Date;
}

const couponRedemptionSchema = new Schema<CouponRedemptionDoc>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

couponRedemptionSchema.index({ couponId: 1, userId: 1 }, { unique: true });

export const CouponRedemption: Model<CouponRedemptionDoc> =
  (mongoose.models.CouponRedemption as Model<CouponRedemptionDoc>) ??
  mongoose.model<CouponRedemptionDoc>('CouponRedemption', couponRedemptionSchema);

export interface ReferralDoc {
  _id: Types.ObjectId;
  referrerId: Types.ObjectId;
  refereeId: Types.ObjectId;
  code: string;
  status: 'pending' | 'completed';
  rewardDays: number;
  createdAt: Date;
}

const referralSchema = new Schema<ReferralDoc>(
  {
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refereeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['pending', 'completed'], default: 'completed' },
    rewardDays: { type: Number, default: 7 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

referralSchema.index({ referrerId: 1, createdAt: -1 });

export const Referral: Model<ReferralDoc> =
  (mongoose.models.Referral as Model<ReferralDoc>) ??
  mongoose.model<ReferralDoc>('Referral', referralSchema);