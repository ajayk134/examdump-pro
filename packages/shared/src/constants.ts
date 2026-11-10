export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PLANS = ['free', 'premium'] as const;
export type Plan = (typeof PLANS)[number];

export const SUBSCRIPTION_STATUS = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'expired',
  'pending',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number];

export const QUESTION_MODES = ['practice', 'reading', 'mock', 'timed', 'random'] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];

export const ATTEMPT_STATUS = ['in_progress', 'completed', 'abandoned'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS)[number];

export const NOTIFICATION_TYPES = [
  'system',
  'subscription',
  'achievement',
  'streak',
  'announcement',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AUDIT_ACTIONS = [
  'user.register',
  'user.login',
  'user.login_failed',
  'user.logout',
  'user.email_verified',
  'user.verification_resent',
  'user.password_reset_requested',
  'user.password_reset',
  'user.role_changed',
  'user.suspended',
  'subscription.created',
  'subscription.canceled',
  'subscription.expired',
  'coupon.created',
  'coupon.redeemed',
  'admin.settings_updated',
  'admin.dataset_synced',
  'admin.user_deleted',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Default entitlements. Overridable at runtime via the settings collection. */
export const DEFAULT_LIMITS = {
  freeQuestionsPerExam: 5,
  freeMockExamsPerDay: 1,
  freeRandomQuestionsPerDay: 20,
  premiumDailyQuestionLimit: 0,
} as const;

export const COOKIE_NAMES = {
  access: 'ed_access',
  refresh: 'ed_refresh',
} as const;

export const ACCESS_COOKIE_PATH = '/';
export const REFRESH_COOKIE_PATH = '/api/auth';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;