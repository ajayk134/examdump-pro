export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** High-level plan tier materialised on the user row for fast checks. */
export const PLANS = ['free', 'premium'] as const;
export type Plan = (typeof PLANS)[number];

/** What a paid subscription unlocks. */
export const ACCESS_SCOPES = ['single', 'all'] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

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

export const PAYMENT_STATUS = [
  'succeeded',
  'pending',
  'failed',
  'refunded',
  'partially_refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const GRANT_SOURCES = ['subscription', 'admin', 'promo', 'referral'] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

export const GOAL_METRICS = ['questions', 'correct', 'mock_tests', 'study_minutes'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

/* ------------------------------------------------------------------------ */
/* Granular permissions (RBAC)                                              */
/* ------------------------------------------------------------------------ */

export const PERMISSIONS = [
  'users.read',
  'users.write',
  'users.delete',
  'roles.manage',
  'subscriptions.read',
  'subscriptions.write',
  'plans.manage',
  'coupons.manage',
  'payments.read',
  'payments.refund',
  'grants.manage',
  'exams.manage',
  'dataset.sync',
  'analytics.read',
  'reports.read',
  'notifications.send',
  'email_templates.manage',
  'audit.read',
  'audit.export',
  'settings.manage',
  'feature_flags.manage',
  'system.health',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: readonly Permission[];
}

/**
 * Built-in roles. `admin` implicitly receives every permission; `owner` is an
 * alias used by the first bootstrapped account. Additional custom roles can be
 * created from the admin dashboard and stored in the database.
 */
export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    id: 'user',
    name: 'Learner',
    description: 'Standard learner account.',
    isSystem: true,
    permissions: [],
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Read-only access to users, subscriptions, payments and audit logs.',
    isSystem: true,
    permissions: ['users.read', 'subscriptions.read', 'payments.read', 'audit.read', 'system.health'],
  },
  {
    id: 'billing',
    name: 'Billing',
    description: 'Manage plans, coupons, subscriptions and issue refunds.',
    isSystem: true,
    permissions: [
      'users.read',
      'subscriptions.read',
      'subscriptions.write',
      'plans.manage',
      'coupons.manage',
      'payments.read',
      'payments.refund',
      'grants.manage',
      'reports.read',
    ],
  },
  {
    id: 'content',
    name: 'Content',
    description: 'Manage exam catalogue and sync the GitHub dataset.',
    isSystem: true,
    permissions: ['exams.manage', 'dataset.sync', 'analytics.read', 'system.health'],
  },
  {
    id: 'admin',
    name: 'Administrator',
    description: 'Full platform access.',
    isSystem: true,
    permissions: PERMISSIONS,
  },
] as const;

/* ------------------------------------------------------------------------ */
/* Pricing — single source of truth for plans (INR)                         */
/* ------------------------------------------------------------------------ */

export const CURRENCY = 'INR' as const;
export const CURRENCY_SYMBOL = '\u20b9';

export interface PlanDefinition {
  id: string;
  name: string;
  description: string;
  scope: AccessScope;
  durationDays: number;
  earlyAccess: boolean;
  /** Price in minor units (paise). ₹1 = 100 paise. */
  priceMinor: number;
  currency: typeof CURRENCY;
  features: string[];
  sortOrder: number;
  active: boolean;
}

export const DEFAULT_PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  {
    id: 'single-30',
    name: 'One Exam \u00b7 30 days',
    description: 'Full access to one exam of your choice for 30 days.',
    scope: 'single',
    durationDays: 30,
    earlyAccess: false,
    priceMinor: 50_000,
    currency: CURRENCY,
    features: [
      'Full access to one selected exam',
      'Unlimited questions & mock tests for that exam',
      'AI explanations and weak-topic analytics',
      'Valid for 30 days',
    ],
    sortOrder: 1,
    active: true,
  },
  {
    id: 'single-30-early',
    name: 'One Exam \u00b7 Early Access \u00b7 30 days',
    description: 'One selected exam plus early access to eligible new content, for 30 days.',
    scope: 'single',
    durationDays: 30,
    earlyAccess: true,
    priceMinor: 100_000,
    currency: CURRENCY,
    features: [
      'Everything in One Exam \u00b7 30 days',
      'Early access to newly released eligible questions',
      'Priority content updates for your exam',
      'Valid for 30 days',
    ],
    sortOrder: 2,
    active: true,
  },
  {
    id: 'all-30',
    name: 'All Exams \u00b7 30 days',
    description: 'Unlimited access to every exam for 30 days.',
    scope: 'all',
    durationDays: 30,
    earlyAccess: false,
    priceMinor: 150_000,
    currency: CURRENCY,
    features: [
      'Full access to every provider and exam',
      'Unlimited questions, mock & timed exams',
      'AI explanations and full analytics',
      'Valid for 30 days',
    ],
    sortOrder: 3,
    active: true,
  },
  {
    id: 'all-365',
    name: 'All Exams \u00b7 365 days',
    description: 'Unlimited access to every exam for a full year.',
    scope: 'all',
    durationDays: 365,
    earlyAccess: false,
    priceMinor: 250_000,
    currency: CURRENCY,
    features: [
      'Everything in All Exams \u00b7 30 days',
      'Best value — save over 85% vs monthly',
      'Valid for 365 days',
    ],
    sortOrder: 4,
    active: true,
  },
] as const;

/* ------------------------------------------------------------------------ */
/* Audit actions                                                            */
/* ------------------------------------------------------------------------ */

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
  'user.updated',
  'subscription.created',
  'subscription.renewed',
  'subscription.upgraded',
  'subscription.canceled',
  'subscription.expired',
  'payment.refunded',
  'coupon.created',
  'coupon.updated',
  'coupon.redeemed',
  'grant.created',
  'grant.revoked',
  'plan.created',
  'plan.updated',
  'role.created',
  'role.permissions_updated',
  'admin.settings_updated',
  'admin.feature_flag_updated',
  'admin.email_template_updated',
  'admin.dataset_synced',
  'admin.user_deleted',
  'admin.dataset_pruned',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Default entitlements. Overridable at runtime via the settings table. */
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
