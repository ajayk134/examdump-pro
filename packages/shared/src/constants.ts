export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** High-level plan tier materialised on the user row for fast checks. */
export const PLANS = ['free', 'premium'] as const;
export type Plan = (typeof PLANS)[number];

/** What a paid subscription unlocks: one exam, a small set of exams, or everything. */
export const ACCESS_SCOPES = ['single', 'multi', 'all'] as const;
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

export const QUESTION_MODES = ['practice', 'mock', 'timed', 'random'] as const;
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
  'payments.manage',
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
  /** Maximum exams a `multi` plan may unlock at the same time. */
  examQuota: number;
  durationDays: number;
  billingCycle: 'monthly' | 'yearly' | 'fixed';
  earlyAccess: boolean;
  /** Highlighted as the recommended plan in pricing UI. */
  highlight: boolean;
  /** Price in minor units (paise). ₹1 = 100 paise. */
  priceMinor: number;
  currency: typeof CURRENCY;
  features: string[];
  sortOrder: number;
  active: boolean;
}

/**
 * Product pricing (INR). Prices are in minor units (paise): ₹499 = 49_900.
 *   - Free            ₹0      · 5 questions per exam, forever
 *   - Single Exam     ₹499    · 30 days, one exam
 *   - Multi Exam      ₹999    · 30 days, up to 3 exams
 *   - All Exams       ₹1,499  · 30 days, every exam
 *   - All Exams Year  ₹4,999  · 365 days, every exam
 */
export const FREE_PLAN: PlanDefinition = {
  id: 'free',
  name: 'Free',
  description: 'Try any exam with 5 free questions per exam. No card required.',
  scope: 'single',
  examQuota: 0,
  durationDays: 0,
  billingCycle: 'fixed',
  earlyAccess: false,
  highlight: false,
  priceMinor: 0,
  currency: CURRENCY,
  features: [
    '5 free questions in every exam',
    'Practice mode with instant feedback',
    'Bookmarks and personal notes',
    'Basic progress tracking',
  ],
  sortOrder: 0,
  active: true,
};

export const DEFAULT_PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  {
    id: 'single-30',
    name: 'Single Exam Pass',
    description: 'Full, unlimited access to one exam of your choice for 30 days.',
    scope: 'single',
    examQuota: 1,
    durationDays: 30,
    billingCycle: 'monthly',
    earlyAccess: false,
    highlight: false,
    priceMinor: 49_900,
    currency: CURRENCY,
    features: [
      'Unlimited questions for one selected exam',
      'All study modes: practice, read, random, mock & timed',
      'AI explanations and weak-topic analytics',
      'Bookmarks, notes and full attempt history',
      'Renews monthly until cancelled · 30 days access',
    ],
    sortOrder: 1,
    active: true,
  },
  {
    id: 'multi-30',
    name: 'Multi-Exam Pass',
    description: 'Unlimited access to up to 3 exams of your choice for 30 days.',
    scope: 'multi',
    examQuota: 3,
    durationDays: 30,
    billingCycle: 'monthly',
    earlyAccess: false,
    highlight: true,
    priceMinor: 99_900,
    currency: CURRENCY,
    features: [
      'Unlimited questions for up to 3 selected exams',
      'Switch your selected exams any time',
      'All study modes plus AI explanations',
      'Full analytics, streaks and recommendations',
      'Renews monthly until cancelled · 30 days access',
    ],
    sortOrder: 2,
    active: true,
  },
  {
    id: 'all-30',
    name: 'All Exams Monthly',
    description: 'Unlimited access to every exam and provider for 30 days.',
    scope: 'all',
    examQuota: 0,
    durationDays: 30,
    billingCycle: 'monthly',
    earlyAccess: true,
    highlight: false,
    priceMinor: 149_900,
    currency: CURRENCY,
    features: [
      'Every exam, every provider - no limits',
      'Unlimited mock & timed exams',
      'Priority AI explanations',
      'Early access to newly released questions',
      'Renews monthly until cancelled · 30 days access',
    ],
    sortOrder: 3,
    active: true,
  },
  {
    id: 'all-365',
    name: 'All Exams Yearly',
    description: 'Every exam for a full year - the best value plan.',
    scope: 'all',
    examQuota: 0,
    durationDays: 365,
    billingCycle: 'yearly',
    earlyAccess: true,
    highlight: false,
    priceMinor: 499_900,
    currency: CURRENCY,
    features: [
      'Everything in All Exams Monthly',
      '365 days of unlimited access',
      'Save 72% compared to monthly billing',
      'Early access to new exam content all year',
      'Renews yearly until cancelled',
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
  'admin.bulk_action',
  'payment.checkout_started',
  'payment.webhook_received',
  'payment.webhook_rejected',
  'payment.reconciled',
  'refund.requested',
  'refund.processed',
  'refund.failed',
  'subscription.exam_selection_updated',
  'admin.plan_deleted',
  'admin.coupon_deleted',
  'announcement.created',
  'announcement.updated',
  'announcement.deleted',
  'notification.broadcast',
  'ticket.created',
  'ticket.replied',
  'ticket.updated',
  'reconciliation.run',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Default entitlements. Overridable at runtime via the settings table. */
export const DEFAULT_LIMITS = {
  /** Product rule: the free tier exposes exactly 5 questions per exam. */
  freeQuestionsPerExam: 5,
  freeMockExamsPerDay: 1,
  freeRandomQuestionsPerDay: 20,
  premiumDailyQuestionLimit: 0,
} as const;

/** AI assistant quotas (requests per day). */
export const AI_LIMITS = {
  free: 5,
  premium: 200,
  /** Per-request max output tokens. */
  maxOutputTokens: 800,
} as const;

/** Maximum exams a Multi-Exam Pass can unlock. */
export const MULTI_EXAM_QUOTA = 3;

export const COOKIE_NAMES = {
  access: 'ed_access',
  refresh: 'ed_refresh',
} as const;

export const ACCESS_COOKIE_PATH = '/';
export const REFRESH_COOKIE_PATH = '/api/auth';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;
