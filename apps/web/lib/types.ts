export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  plan: 'free' | 'premium';
  premiumActive: boolean;
  premiumUntil: string | null;
  emailVerified: boolean;
  avatarUrl: string;
  bio: string;
  timezone: string;
  preferences: {
    theme: 'light' | 'dark' | 'system';
    emailNotifications: boolean;
    productUpdates: boolean;
    weeklyReport: boolean;
  };
  referralCode: string;
  suspended: boolean;
  createdAt: string;
}

export interface Provider {
  providerId: string;
  title: string;
  slug: string;
  examCount: number;
  totalQuestions: number;
}

export interface Exam {
  providerId: string;
  providerTitle: string;
  providerSlug: string;
  key: string;
  code: string;
  title: string;
  slug: string;
  questionCount: number;
  syncedAt?: string;
}

export interface ContentItem {
  type: 'text' | 'break' | 'image';
  value?: string;
  src?: string;
}

export interface Choice {
  key: string;
  content: ContentItem[];
  text: string;
  images: string[];
}

export interface Vote {
  answer: string;
  count: number;
  percentage: number;
  mostVoted: boolean;
}

export interface Question {
  id: string;
  number: number | null;
  title: string | null;
  type: 'single' | 'multiple' | 'dragdrop' | 'unknown';
  stem: ContentItem[];
  stemText: string;
  stemImages: string[];
  choices: Choice[];
  explanation: string;
  answer: string | null;
  answerText?: string;
  votes: Vote[];
}

export interface Entitlement {
  plan: 'free' | 'premium';
  totalQuestions: number;
  accessibleQuestions: number;
  returned?: number;
  lockedQuestions: number;
  isLimited: boolean;
  offset?: number;
  limit?: number;
}

export interface QuestionsResponse {
  provider: { id: string; title: string; slug: string };
  exam: { key: string; code: string; title: string; questionCount: number; providerId: string; providerTitle: string };
  questions: Question[];
  entitlement: Entitlement;
}

export interface AttemptSummary {
  id: string;
  mode: string;
  status: string;
  providerId: string;
  examKey: string;
  examCode: string;
  providerTitle?: string;
  totalQuestions?: number;
  answeredCount?: number;
  correctCount?: number;
  scorePercent?: number;
  timeSpentMs?: number;
  startedAt?: string;
  completedAt?: string | null;
  createdAt: string;
}

export interface WeakTopic {
  topic: string;
  attempts: number;
  correct: number;
  questions: number;
  accuracy: number;
}

export interface PerformancePoint {
  date: string;
  attempts: number;
  questions: number;
  correct: number;
  accuracy: number;
}

export interface DashboardData {
  stats: {
    totalQuestions: number;
    totalCorrect: number;
    accuracy: number;
    currentStreak: number;
    longestStreak: number;
    totalStudyMs: number;
    mockTests: number;
  };
  recentAttempts: AttemptSummary[];
  progress: Array<{
    examKey: string;
    examCode: string;
    providerId: string;
    questionsSeen: number;
    questionsCorrect: number;
    questionsWrong: number;
    attempts: number;
    bestScore: number;
    lastStudiedAt: string;
  }>;
  weakTopics: WeakTopic[];
  performance: PerformancePoint[];
  recommendations: Array<{ reason: string; exam: Exam }>;
}

export type AccessScope = 'single' | 'multi' | 'all';

export interface Plan {
  id: string;
  name: string;
  description: string;
  scope: AccessScope;
  durationDays: number;
  earlyAccess: boolean;
  /** Price in minor units (paise for INR). */
  priceMinor: number;
  currency: string;
  features: string[];
  active: boolean;
  sortOrder: number;
  /** How many exams the pass unlocks (0 = unlimited). */
  examQuota: number;
  billingCycle: 'monthly' | 'yearly' | 'fixed';
  highlight: boolean;
  badge: string | null;
}

/** Server-authoritative price for a plan + exam selection + coupon. */
export interface PlanQuote {
  plan: Plan;
  examKeys: string[];
  grossMinor: number;
  discountMinor: number;
  totalMinor: number;
  couponCode: string | null;
  currency: string;
}

export interface Invoice {
  id: string;
  number: string;
  paymentId: string;
  planId: string;
  planName: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  currency: string;
  status: string;
  issuedAt: string;
  lineItems: Array<{ description: string; amountMinor: number; quantity: number }>;
  billedTo: { name: string; email: string; country?: string };
}

export interface CheckoutSession {
  paymentId: string;
  paymentRef: string;
  clientSecret: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  checkoutUrl: string | null;
  publishableKey: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'success' | 'warning' | 'critical';
  audience: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount?: number;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorRole: 'user' | 'admin' | 'system';
  body: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  planId: string;
  scope: AccessScope;
  status: string;
  examKey: string | null;
  examKeys?: string[];
  providerId: string | null;
  examTitle: string | null;
  priceMinor: number;
  currency: string;
  discountMinor: number;
  earlyAccess: boolean;
  startedAt: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  provider: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  amountMinor: number;
  discountMinor: number;
  refundedMinor: number;
  currency: string;
  status: string;
  provider: string;
  providerRef: string;
  providerPaymentId?: string | null;
  description: string;
  failureReason?: string | null;
  paidAt?: string | null;
  createdAt: string;
}

export interface AccessGrant {
  id: string;
  scope: AccessScope;
  examKey: string | null;
  providerId: string | null;
  source: string;
  note: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface Entitlements {
  plan: 'free' | 'premium';
  scope: AccessScope | 'none';
  allAccess: boolean;
  examKeys: string[];
  providerIds?: string[];
  earlyAccess: boolean;
  expiresAt: string | null;
  questionsPerExam?: number | null;
  mockExamsPerDay?: number | null;
  randomQuestionsPerDay?: number | null;
  dailyQuestionLimit?: number;
  sources?: Array<{ type: string; scope: AccessScope; examKey: string | null; expiresAt: string | null }>;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  avatarUrl: string;
  plan: 'free' | 'premium';
  correct: number;
  answered: number;
  attempts: number;
  accuracy: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
}

export interface Bookmark {
  id: string;
  providerId: string;
  examKey: string;
  questionId: string;
  createdAt: string;
}

export interface Note {
  id: string;
  providerId: string;
  examKey: string;
  questionId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
/* ------------------------------------------------------------------ */
/* AI tutor chat                                                       */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string | null;
  degraded?: boolean;
  createdAt?: string;
  /** Client-only: the message is still streaming in. */
  pending?: boolean;
  /** Client-only: transport or provider failure for this turn. */
  error?: string;
}

export interface AiConversation {
  id: string;
  title: string;
  providerId: string | null;
  examKey: string | null;
  examTitle: string | null;
  questionId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiConversationDetail extends AiConversation {
  messages: ChatMessage[];
  suggestions: string[];
}
