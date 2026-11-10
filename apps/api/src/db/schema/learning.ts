import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import {
  attemptStatusEnum,
  goalMetricEnum,
  goalPeriodEnum,
  questionModeEnum,
} from './enums';

export interface AttemptAnswer {
  questionId: string;
  selected: string[];
  correct: boolean;
  timeSpentMs: number;
}

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    providerTitle: text('provider_title').notNull().default(''),
    examKey: text('exam_key').notNull(),
    examCode: text('exam_code').notNull(),
    mode: questionModeEnum('mode').notNull().default('practice'),
    status: attemptStatusEnum('status').notNull().default('in_progress'),
    questionIds: jsonb('question_ids').$type<string[]>().notNull().default([]),
    answers: jsonb('answers').$type<AttemptAnswer[]>().notNull().default([]),
    totalQuestions: integer('total_questions').notNull().default(0),
    answeredCount: integer('answered_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    scorePercent: integer('score_percent').notNull().default(0),
    timeLimitSeconds: integer('time_limit_seconds'),
    timeSpentMs: integer('time_spent_ms').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('attempts_user_created_idx').on(t.userId, t.createdAt),
    index('attempts_user_exam_idx').on(t.userId, t.examKey, t.createdAt),
    index('attempts_user_status_idx').on(t.userId, t.status),
  ],
);

export const questionResults = pgTable(
  'question_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    examKey: text('exam_key').notNull(),
    questionId: text('question_id').notNull(),
    topic: text('topic').notNull().default('General'),
    attempts: integer('attempts').notNull().default(0),
    correct: integer('correct').notNull().default(0),
    lastCorrect: boolean('last_correct').notNull().default(false),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('question_results_unique').on(t.userId, t.examKey, t.questionId),
    index('question_results_topic_idx').on(t.userId, t.topic),
  ],
);

export const examProgress = pgTable(
  'exam_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    examKey: text('exam_key').notNull(),
    examCode: text('exam_code').notNull().default(''),
    questionsSeen: integer('questions_seen').notNull().default(0),
    questionsCorrect: integer('questions_correct').notNull().default(0),
    questionsWrong: integer('questions_wrong').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    bestScore: integer('best_score').notNull().default(0),
    lastStudiedAt: timestamp('last_studied_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('exam_progress_unique').on(t.userId, t.examKey),
    index('exam_progress_recent_idx').on(t.userId, t.lastStudiedAt),
  ],
);

export const userStats = pgTable(
  'user_stats',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    totalQuestions: integer('total_questions').notNull().default(0),
    totalCorrect: integer('total_correct').notNull().default(0),
    totalStudyMs: integer('total_study_ms').notNull().default(0),
    mockTests: integer('mock_tests').notNull().default(0),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    lastActiveDate: text('last_active_date').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (t) => [index('user_stats_correct_idx').on(t.totalCorrect)],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    examKey: text('exam_key').notNull(),
    questionId: text('question_id').notNull(),
    createdAt,
  },
  (t) => [
    uniqueIndex('bookmarks_unique').on(t.userId, t.examKey, t.questionId),
    index('bookmarks_recent_idx').on(t.userId, t.createdAt),
  ],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    examKey: text('exam_key').notNull(),
    questionId: text('question_id').notNull(),
    body: text('body').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('notes_unique').on(t.userId, t.examKey, t.questionId),
    index('notes_recent_idx').on(t.userId, t.updatedAt),
  ],
);

export const dailyUsage = pgTable(
  'daily_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    questionsViewed: integer('questions_viewed').notNull().default(0),
    mockExams: integer('mock_exams').notNull().default(0),
    randomQuestions: integer('random_questions').notNull().default(0),
    aiExplanations: integer('ai_explanations').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('daily_usage_unique').on(t.userId, t.date)],
);

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    metric: goalMetricEnum('metric').notNull().default('questions'),
    period: goalPeriodEnum('period').notNull().default('daily'),
    target: integer('target').notNull().default(20),
    active: boolean('active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [index('goals_user_idx').on(t.userId, t.active)],
);

export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
export type QuestionResult = typeof questionResults.$inferSelect;
export type ExamProgress = typeof examProgress.$inferSelect;
export type UserStats = typeof userStats.$inferSelect;
export type Bookmark = typeof bookmarks.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type DailyUsage = typeof dailyUsage.$inferSelect;
export type Goal = typeof goals.$inferSelect;
