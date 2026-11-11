import {
  boolean,
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

/** Site-wide banners shown on the dashboard and marketing pages. */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    level: text('level').notNull().default('info'),
    audience: text('audience').notNull().default('all'),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (t) => [index('announcements_active_idx').on(t.active, t.startsAt)],
);

/** Support conversations (billing, refunds, content, technical). */
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    subject: text('subject').notNull(),
    category: text('category').notNull().default('general'),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('open'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('support_tickets_reference_unique').on(t.reference),
    index('support_tickets_status_idx').on(t.status, t.createdAt),
    index('support_tickets_user_idx').on(t.userId),
  ],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorRole: text('author_role').notNull().default('user'),
    body: text('body').notNull(),
    internal: boolean('internal').notNull().default(false),
    createdAt,
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt)],
);

/** Error/event samples surfaced in the ops console. */
export const errorEvents = pgTable(
  'error_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    level: text('level').notNull().default('error'),
    message: text('message').notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => [index('error_events_created_idx').on(t.createdAt)],
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
export type Announcement = typeof announcements.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
