import { z } from 'zod';
import { NOTIFICATION_TYPES, PLANS, QUESTION_MODES, ROLES } from './constants.js';

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
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  couponCode: z.string().trim().max(64).optional(),
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
  monthlyPrice: z.number().min(0).max(100000),
  yearlyPrice: z.number().min(0).max(100000),
  currency: z.string().length(3).default('USD'),
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
});

export const notificationReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(100).optional(),
  all: z.boolean().optional(),
});

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).optional(),
  plan: z.enum(PLANS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const aiExplainSchema = z.object({
  provider: z.string().min(1).max(160),
  exam: z.string().min(1).max(240),
  questionId: z.string().min(1).max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type StartAttemptInput = z.infer<typeof startAttemptSchema>;
export type CompleteAttemptInput = z.infer<typeof completeAttemptSchema>;
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;