import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { notificationTypeEnum } from './enums';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull().default('system'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    read: boolean('read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.read, t.createdAt)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey().default('global'),
  freeQuestionsPerExam: integer('free_questions_per_exam').notNull().default(5),
  freeMockExamsPerDay: integer('free_mock_exams_per_day').notNull().default(1),
  freeRandomQuestionsPerDay: integer('free_random_questions_per_day').notNull().default(20),
  premiumDailyQuestionLimit: integer('premium_daily_question_limit').notNull().default(0),
  maintenanceMode: boolean('maintenance_mode').notNull().default(false),
  registrationsOpen: boolean('registrations_open').notNull().default(true),
  announcement: text('announcement').notNull().default(''),
  supportEmail: text('support_email').notNull().default('support@examdump.pro'),
  siteName: text('site_name').notNull().default('ExamDump Pro'),
  updatedAt,
});

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  description: text('description').notNull().default(''),
  rolloutPercent: integer('rollout_percent').notNull().default(100),
  updatedAt,
});

export const emailTemplates = pgTable('email_templates', {
  key: text('key').primaryKey(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  description: text('description').notNull().default(''),
  updatedAt,
});

export type Notification = typeof notifications.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
