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
  'upi',
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
  'login_alert',
  'password_changed',
  'account_notice',
  'support_received',
  'announcement',
  'test',
]);

/* ------------------------- ExamDump Mail (outbound) ------------------------- */

/**
 * Lifecycle of a queued message.
 *
 * queued -> sending -> sent
 *                    -> failed (retryable, back in queued)
 *                    -> dead   (exhausted retries; inspectable, re-queueable)
 * queued -> cancelled            (campaign cancelled before processing)
 * queued -> suppressed           (consent, suppression list or preferences)
 */
export const emailQueueStatusEnum = pgEnum('email_queue_status', [
  'queued',
  'sending',
  'sent',
  'failed',
  'dead',
  'cancelled',
  'suppressed',
]);

/** Transactional mail is legally different from marketing: separate policy. */
export const emailCategoryEnum = pgEnum('email_category', ['transactional', 'marketing']);

export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'cancelled',
  'failed',
]);

/** Why an address is on the suppression list. */
export const suppressionReasonEnum = pgEnum('suppression_reason', [
  'hard_bounce',
  'complaint',
  'unsubscribe_marketing',
  'unsubscribe_all',
  'manual',
]);

/* -------------------------------- UPI ----------------------------------- */

/**
 * Order lifecycle. `pending` -> (`settled` | `expired` | `cancelled`).
 * `under_review` is used when a notification arrived but the risk engine could
 * not reach its confidence threshold: we do not settle, but we keep the order
 * open for an operator rather than expiring it silently.
 */
export const upiOrderStatusEnum = pgEnum('upi_order_status', [
  'pending',
  'under_review',
  'settled',
  'expired',
  'cancelled',
  'refunded',
  'partially_refunded',
]);

/** Where a notification came from. */
export const upiNotificationSourceEnum = pgEnum('upi_notification_source', [
  'gmail',
  'sms',
  'webhook',
  'manual',
]);

/**
 * `received`  - stored, not yet evaluated
 * `matched`   - settled exactly one order automatically
 * `unmatched` - credible credit, but no single order fitted
 * `rejected`  - failed a safety check (duplicate, wrong amount, stale, spoofed)
 * `ignored`   - not a credit notification at all
 */
export const upiNotificationStatusEnum = pgEnum('upi_notification_status', [
  'received',
  'matched',
  'unmatched',
  'rejected',
  'ignored',
]);

export const upiMatchDecisionEnum = pgEnum('upi_match_decision', [
  'auto_approved',
  'manual_approved',
  'rejected',
]);
