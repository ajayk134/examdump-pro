import { z } from 'zod';
import {
  ACCESS_SCOPES,
  GOAL_METRICS,
  GOAL_PERIODS,
  NOTIFICATION_TYPES,
  PERMISSIONS,
  PLANS,
  QUESTION_MODES,
  ROLES,
} from './constants.js';

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80),
  email: emailSchema,
  password: passwordSchema,
  referralCode: z.string().trim().max(32).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(20),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).optional().or(z.literal('')),
  timezone: z.string().max(64).optional(),
});

export const updatePreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  emailNotifications: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
  weeklyReport: z.boolean().optional(),
});

export const updateUserAdminSchema = z.object({
  role: z.enum(ROLES).optional(),
  plan: z.enum(PLANS).optional(),
  suspended: z.boolean().optional(),
  name: z.string().trim().min(2).max(80).optional(),
  emailVerified: z.boolean().optional(),
});

export const grantAccessSchema = z.object({
  scope: z.enum(ACCESS_SCOPES),
  examKey: z.string().trim().min(1).max(240).optional(),
  examKeys: z.array(z.string().trim().min(1).max(240)).max(10).optional(),
  providerId: z.string().trim().min(1).max(160).optional(),
  note: z.string().max(300).optional(),
  expiresAt: z.coerce.date().optional(),
  /** Convenience alternative to `expiresAt`, in days from now. */
  days: z.number().int().min(1).max(3650).optional(),
});

export const refundSchema = z.object({
  amountMinor: z.number().int().min(1).optional(),
  reason: z.string().max(300).optional(),
});

export const createRoleSchema = z.object({
  id: z.string().trim().min(2).max(64).regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(300).default(''),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default([]),
});

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});

export const assignRoleSchema = z.object({
  roleIds: z.array(z.string().min(1).max(64)).max(20),
});

export const featureFlagSchema = z.object({
  key: z.string().trim().min(2).max(64).regex(/^[a-z0-9_.-]+$/),
  enabled: z.boolean(),
  description: z.string().max(300).default(''),
  rolloutPercent: z.number().int().min(0).max(100).default(100),
});

export const emailTemplateSchema = z.object({
  key: z.string().trim().min(2).max(64).regex(/^[a-z0-9_-]+$/),
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(20_000),
  description: z.string().max(300).default(''),
});

export const goalSchema = z.object({
  title: z.string().trim().max(80).default(''),
  metric: z.enum(GOAL_METRICS).default('questions'),
  period: z.enum(GOAL_PERIODS).default('daily'),
  target: z.number().int().min(1).max(100_000),
  active: z.boolean().default(true),
});

export const draftAnswerSchema = z.object({
  questionId: z.string().min(1).max(200),
  selected: z.array(z.string().max(4)).max(26),
  timeSpentMs: z.number().int().min(0).max(86_400_000).optional(),
});

export const startAttemptSchema = z.object({
  provider: z.string().min(1).max(160),
  exam: z.string().min(1).max(240),
  mode: z.enum(QUESTION_MODES).default('practice'),
  questionIds: z.array(z.string().max(200)).max(500).optional(),
  timeLimitSeconds: z.number().int().min(30).max(21_600).optional(),
});

export const completeAttemptSchema = z.object({
  answers: z.array(draftAnswerSchema).max(1000).default([]),
  timeSpentMs: z.number().int().min(0).max(86_400_000).optional(),
});

export const bookmarkSchema = z.object({
  provider: z.string().min(1).max(160),
  exam: z.string().min(1).max(240),
  questionId: z.string().min(1).max(200),
});

export const noteSchema = z.object({
  provider: z.string().min(1).max(160),
  exam: z.string().min(1).max(240),
  questionId: z.string().min(1).max(200),
  body: z.string().min(1, 'Note cannot be empty').max(5000),
});

export const listQuestionsQuerySchema = z.object({
  mode: z.enum(QUESTION_MODES).default('practice'),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  random: z.coerce.boolean().optional(),
  seed: z.coerce.number().int().optional(),
  includeAnswer: z.coerce.boolean().optional(),
});

export const examSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  provider: z.string().trim().max(160).optional(),
  sort: z.enum(['popular', 'title', 'questions', 'newest']).default('popular'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createSubscriptionSchema = z.object({
  planId: z.string().min(1).max(64),
  examKey: z.string().trim().min(1).max(240).optional(),
  providerId: z.string().trim().min(1).max(160).optional(),
  couponCode: z.string().trim().max(64).optional(),
});

export const MAX_EXAMS_PER_PLAN = 3;

export const changePlanSchema = z.object({
  planId: z.string().min(1).max(64),
  examKey: z.string().trim().min(1).max(240).optional(),
  providerId: z.string().trim().min(1).max(160).optional(),
  /** Exams to unlock for a `multi` plan (max 3). */
  examKeys: z.array(z.string().trim().min(1).max(240)).max(MAX_EXAMS_PER_PLAN).optional(),
  couponCode: z.string().trim().max(64).optional(),
});

export const quoteSchema = changePlanSchema.extend({
  examKeys: z.array(z.string().trim().min(1).max(240)).max(MAX_EXAMS_PER_PLAN).optional(),
});

/** Start a HyperSwitch checkout for a plan (live) or complete a plan change. */
export const checkoutSchema = quoteSchema.extend({
  /** Optional client-side idempotency key to avoid duplicate orders. */
  requestId: z.string().trim().max(64).optional(),
});

/** Admin-side refund request (full or partial). */
export const refundRequestSchema = z.object({
  paymentId: z.string().trim().min(1).max(64),
  /** Omit for a full refund of the remaining amount. */
  amountMinor: z.number().int().min(1).max(100_000_000).optional(),
  reason: z.string().trim().max(300).default(''),
});

/** Admin bulk actions. */
export const bulkActionSchema = z.object({
  action: z.enum([
    'suspend',
    'unsuspend',
    'verify_email',
    'make_admin',
    'make_user',
    'delete',
    'cancel_subscriptions',
  ]),
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
  /** Days of access for `grant_premium` style actions (validated server-side). */
  days: z.number().int().min(1).max(3650).optional(),
});




export const couponValidateSchema = z.object({
  code: z.string().trim().min(1).max(64),
  planId: z.string().min(1).max(64),
});

export const createCouponAdminSchema = z.object({
  code: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().max(200).optional(),
  percentOff: z.number().int().min(1).max(100),
  maxRedemptions: z.number().int().min(0).default(0),
  expiresAt: z.coerce.date().optional(),
  active: z.boolean().default(true),
});

export const createPlanAdminSchema = z.object({
  id: z.string().trim().min(2).max(64).regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(300).default(''),
  scope: z.enum(ACCESS_SCOPES).default('single'),
  examQuota: z.number().int().min(0).max(10).default(0),
  durationDays: z.number().int().min(1).max(3650),
  billingCycle: z.enum(['monthly', 'yearly', 'fixed']).default('fixed'),
  earlyAccess: z.boolean().default(false),
  highlight: z.boolean().default(false),
  priceMinor: z.number().int().min(0).max(100_000_000),
  currency: z.literal('INR').default('INR'),
  features: z.array(z.string().max(120)).max(30).default([]),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const updateSettingsAdminSchema = z.object({
  freeQuestionsPerExam: z.number().int().min(1).max(100).optional(),
  freeMockExamsPerDay: z.number().int().min(0).max(100).optional(),
  freeRandomQuestionsPerDay: z.number().int().min(0).max(1000).optional(),
  premiumDailyQuestionLimit: z.number().int().min(0).max(100000).optional(),
  maintenanceMode: z.boolean().optional(),
  registrationsOpen: z.boolean().optional(),
  announcement: z.string().max(500).optional(),
  supportEmail: z.string().email().max(200).optional(),
  siteName: z.string().min(1).max(80).optional(),
});

export const notificationReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(100).optional(),
  all: z.boolean().optional(),
});

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.string().trim().max(64).optional(),
  plan: z.enum(PLANS).optional(),
  suspended: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const aiExplainSchema = z.object({
  provider: z.string().min(1).max(160),
  exam: z.string().min(1).max(240),
  questionId: z.string().min(1).max(200),
  /** Options already chosen by the learner (helps the tutor target the gap). */
  choice: z.array(z.string().trim().max(8)).max(8).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type StartAttemptInput = z.infer<typeof startAttemptSchema>;
export type CompleteAttemptInput = z.infer<typeof completeAttemptSchema>;
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

/* ------------------------------------------------------------------ */
/* Admin: plans, invoices, reconciliation, support                     */
/* ------------------------------------------------------------------ */

export const updatePlanAdminSchema = createPlanAdminSchema.partial().extend({
  examQuota: z.number().int().min(0).max(10).optional(),
  billingCycle: z.enum(['monthly', 'yearly', 'fixed']).optional(),
  highlight: z.boolean().optional(),
});

export const updateCouponAdminSchema = createCouponAdminSchema.partial();

export const adminPaymentListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  provider: z.string().trim().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.enum(['newest', 'oldest', 'amount_desc', 'amount_asc']).default('newest'),
});

export const adminSubscriptionListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  scope: z.enum(ACCESS_SCOPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const adminAuditQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  actorId: z.string().trim().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const announcementsSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(2000),
  level: z.enum(['info', 'success', 'warning', 'critical']).default('info'),
  audience: z.enum(['all', 'users', 'admins']).default('all'),
  active: z.boolean().default(true),
  expiresAt: z.coerce.date().optional(),
});

export const broadcastNotificationSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().max(1000).default(''),
  audience: z.enum(['all', 'premium', 'free', 'admins']).default('all'),
  link: z.string().trim().max(300).optional(),
});

export const supportTicketCreateSchema = z.object({
  subject: z.string().trim().min(4).max(160),
  category: z
    .enum(['general', 'billing', 'payments', 'content', 'account', 'technical', 'refund'])
    .default('general'),
  message: z.string().trim().min(10).max(5000),
  email: emailSchema.optional(),
});

export const supportTicketReplySchema = z.object({
  message: z.string().trim().min(1).max(5000),
  internal: z.boolean().default(false),
});

export const supportTicketUpdateSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export const adminUserListQuerySchemaExtended = adminUserListQuerySchema.extend({
  status: z.enum(['any', 'active', 'suspended', 'premium', 'free']).default('any'),
  sort: z.enum(['newest', 'oldest', 'name', 'last_login']).default('newest'),
});

export const aiAssistSchema = z.object({
  provider: z.string().min(1).max(160),
  exam: z.string().min(1).max(240),
  questionId: z.string().min(1).max(200).optional(),
  /** Free-form question asked by the learner about the current item. */
  question: z.string().trim().min(3).max(1000),
});

export const bookmarkNoteSchema = z.object({
  note: z.string().max(1000).default(''),
});

export const examSelectionSchema = z.object({
  subscriptionId: z.string().uuid(),
  examKeys: z.array(z.string().trim().min(1).max(240)).max(MAX_EXAMS_PER_PLAN),
});

/* ------------------------------------------------------------------ */
/* AI tutor chat                                                       */
/* ------------------------------------------------------------------ */

export const aiChatStartSchema = z.object({
  provider: z.string().trim().min(1).max(160),
  exam: z.string().trim().min(1).max(240),
  questionId: z.string().trim().min(1).max(200).optional(),
  /** Optional opening message; when absent the conversation is just created. */
  message: z.string().trim().min(1).max(4000).optional(),
});

export const aiChatMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  /** Options the learner currently has selected for the anchored question. */
  learnerChoice: z.array(z.string().trim().max(8)).max(8).optional(),
});

export const aiConversationRenameSchema = z.object({
  title: z.string().trim().min(1).max(120),
});
