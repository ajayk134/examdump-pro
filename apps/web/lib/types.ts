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
  _id: string;
  id?: string;
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

export interface Plan {
  _id: string;
  planId: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  features: string[];
  active: boolean;
  sortOrder: number;
}

export interface Subscription {
  _id: string;
  planId: string;
  billingCycle: 'monthly' | 'yearly';
  status: string;
  price: number;
  currency: string;
  startedAt: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  mock: boolean;
}

export interface Payment {
  _id: string;
  amount: number;
  discount: number;
  currency: string;
  status: string;
  provider: string;
  reference: string;
  description: string;
  createdAt: string;
}

export interface Notification {
  _id: string;
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
  _id: string;
  providerId: string;
  examKey: string;
  questionId: string;
  createdAt: string;
}

export interface Note {
  _id: string;
  providerId: string;
  examKey: string;
  questionId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}