import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);
export const planTierEnum = pgEnum('plan_tier', ['free', 'premium']);
export const accessScopeEnum = pgEnum('access_scope', ['single', 'multi', 'all']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'expired',
  'pending',
]);
export const billingCycleEnum = pgEnum('billing_cycle', ['monthly', 'yearly', 'fixed']);
export const questionModeEnum = pgEnum('question_mode', [
  'practice',
  'reading',
  'mock',
  'timed',
  'random',
]);
export const attemptStatusEnum = pgEnum('attempt_status', [
  'in_progress',
  'completed',
  'abandoned',
]);
export const notificationTypeEnum = pgEnum('notification_type', [
  'system',
  'subscription',
  'achievement',
  'streak',
  'announcement',
]);
export const paymentStatusEnum = pgEnum('payment_status', [
  'succeeded',
  'pending',
  'failed',
  'refunded',
  'partially_refunded',
]);
export const paymentProviderEnum = pgEnum('payment_provider', [
  'mock',
  'manual',
  'razorpay',
  'stripe',
  'hyperswitch',
  'none',
]);
export const refundStatusEnum = pgEnum('refund_status', ['pending', 'succeeded', 'failed']);
export const referralStatusEnum = pgEnum('referral_status', ['pending', 'completed']);
export const authTokenTypeEnum = pgEnum('auth_token_type', ['email_verify', 'password_reset']);
export const grantSourceEnum = pgEnum('grant_source', [
  'subscription',
  'admin',
  'promo',
  'referral',
]);
export const goalPeriodEnum = pgEnum('goal_period', ['daily', 'weekly', 'monthly']);
export const goalMetricEnum = pgEnum('goal_metric', [
  'questions',
  'correct',
  'mock_tests',
  'study_minutes',
]);

/**
 * Transactional email lifecycle (ExamDump Mail).
 *
 * `suppressed` means the message was intentionally not sent: mail is disabled,
 * SMTP is not configured, or the per-recipient rate limit was hit. It is
 * distinct from `failed`, which means we tried and the provider rejected or the
 * connection dropped.
 */
export const mailStatusEnum = pgEnum('mail_status', ['queued', 'sent', 'failed', 'suppressed']);

export const mailTemplateEnum = pgEnum('mail_template', [
  'email_verify',
  'password_reset',
  'welcome',
  'payment_receipt',
  'subscription_activated',
  'subscription_renewed',
  'subscription_expiring',
  'subscription_cancelled',
  'refund_processed',
  'test',
]);
