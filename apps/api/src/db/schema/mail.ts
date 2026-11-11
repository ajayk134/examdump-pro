/**
 * ExamDump Mail — outbound email schema.
 *
 * Design notes:
 *
 *  - `email_queue` is the durable work queue. Rows are claimed with
 *    `FOR UPDATE SKIP LOCKED`, so multiple workers (or a restart mid-batch)
 *    never double-send. Everything needed to send is denormalised onto the row
 *    (rendered subject/html/text), so a template edit cannot retroactively
 *    change a message that is already queued.
 *  - `email_templates` holds reusable, admin-editable templates. The built-in
 *    transactional templates live in code; rows here override them by `key`.
 *  - `email_campaigns` is the marketing/bulk side. A campaign fans out into
 *    `email_queue` rows, which keeps one delivery path for everything.
 *  - `email_suppressions` is the do-not-send list, keyed by address so it
 *    survives account deletion.
 *  - `email_preferences` is per-user consent, separate from the general
 *    `users.preferences` blob so consent changes are auditable and queryable.
 */
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
import {
  campaignStatusEnum,
  emailCategoryEnum,
  emailQueueStatusEnum,
  suppressionReasonEnum,
} from './enums';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/* ------------------------------- queue -------------------------------- */

export const emailQueue = pgTable(
  'email_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id'),
    /** Template key that produced this message (for stats grouping). */
    template: text('template').notNull(),
    category: emailCategoryEnum('category').notNull().default('transactional'),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull().default(''),
    text: text('text').notNull().default(''),
    status: emailQueueStatusEnum('status').notNull().default('queued'),
    /** Attempts made so far. */
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    /** When the row becomes eligible for processing. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull().defaultNow(),
    /** Set while a worker holds the row; used to detect crashed workers. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** SMTP message id once accepted by the provider. */
    messageId: text('message_id'),
    /**
     * Idempotency key. A unique index on (dedupe_key) prevents the same logical
     * message being queued twice (e.g. two workers both noticing an expiring
     * subscription).
     */
    dedupeKey: text('dedupe_key'),
    /** Correlation id for support (payment id, token id, campaign id). */
    referenceId: text('reference_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => [
    // The worker's hot path: due, queued rows in time order.
    index('email_queue_due_idx').on(t.status, t.scheduledFor),
    index('email_queue_recipient_idx').on(t.recipient, t.createdAt),
    index('email_queue_campaign_idx').on(t.campaignId, t.status),
    index('email_queue_status_idx').on(t.status, t.createdAt),
    // Partial unique index is created in SQL (drizzle cannot express it here).
  ],
);

/* ------------------------------ campaigns ------------------------------ */

export const emailCampaigns = pgTable(
  'email_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull().default(''),
    text: text('text').notNull().default(''),
    /** Template key this campaign was based on, when any. */
    templateKey: text('template_key'),
    category: emailCategoryEnum('category').notNull().default('marketing'),
    status: campaignStatusEnum('status').notNull().default('draft'),
    /** Audience definition, resolved at send time. */
    segment: jsonb('segment')
      .$type<{
        plan?: 'free' | 'premium' | 'any';
        emailVerified?: boolean;
        role?: 'user' | 'admin';
        createdAfter?: string;
        createdBefore?: string;
        inactiveDays?: number;
        examKey?: string;
      }>()
      .notNull()
      .default({}),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Denormalised counters, updated as the queue drains. */
    totalRecipients: integer('total_recipients').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    suppressedCount: integer('suppressed_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('email_campaigns_status_idx').on(t.status, t.createdAt),
    index('email_campaigns_scheduled_idx').on(t.status, t.scheduledFor),
  ],
);

/* ----------------------------- suppression ----------------------------- */

export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lowercased address. Survives account deletion on purpose. */
    email: text('email').notNull(),
    reason: suppressionReasonEnum('reason').notNull(),
    /** Free-text note for manual entries. */
    note: text('note').notNull().default(''),
    /** Which categories are blocked. `all` blocks transactional too. */
    scope: text('scope').notNull().default('marketing'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
  },
  (t) => [uniqueIndex('email_suppressions_email_idx').on(t.email)],
);

/* ----------------------------- preferences ----------------------------- */

export const emailPreferences = pgTable(
  'email_preferences',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Marketing/announcement consent. Essential mail ignores this. */
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    /** Product news and feature announcements. */
    productUpdates: boolean('product_updates').notNull().default(true),
    /** Subscription expiry / renewal reminders. */
    subscriptionReminders: boolean('subscription_reminders').notNull().default(true),
    /** Weekly study summary. */
    weeklyReport: boolean('weekly_report').notNull().default(true),
    /** Security alerts (new login, password change). Strongly recommended. */
    securityAlerts: boolean('security_alerts').notNull().default(true),
    /** When and how consent was captured, for compliance. */
    consentSource: text('consent_source').notNull().default('default'),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    updatedAt,
  },
);

export type EmailQueueRow = typeof emailQueue.$inferSelect;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type EmailPreference = typeof emailPreferences.$inferSelect;
