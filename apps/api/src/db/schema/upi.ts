/**
 * UPI self-collection schema.
 *
 * Design notes:
 *
 * - `upi_orders` is the customer-facing intent ("pay ₹499 for plan X"). It is
 *   what the checkout page renders and what the observer tries to satisfy.
 * - `upi_notifications` is every bank/UPI alert we ingest, parsed or not. Kept
 *   even when it matches nothing, because an unmatched credit is the single most
 *   important thing an operator needs to see.
 * - `upi_matches` links one notification to one order. The unique index on
 *   `notification_id` enforces that a bank alert can never settle two orders,
 *   and the unique partial index on `order_id` enforces that an order is settled
 *   by at most one alert.
 *
 * Amounts are integer paise throughout. Nothing is stored in rupees.
 */

import { sql } from 'drizzle-orm';
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
import { payments } from './billing.js';
import { users } from './identity.js';
import {
  upiOrderStatusEnum,
  upiNotificationStatusEnum,
  upiNotificationSourceEnum,
  upiMatchDecisionEnum,
} from './enums.js';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** A request for the customer to send us a specific amount. */
export const upiOrders = pgTable(
  'upi_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Short human-readable reference shown in the UPI note, e.g. "ED-7F3K9Q2M". */
    reference: text('reference').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The `payments` row this order pays for; settlement flows through it. */
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    amountPaise: integer('amount_paise').notNull(),
    /**
     * The plan/quote price before the unique-paisa suffix.
     *
     * `amount_paise` is what the customer must actually transfer: the base price
     * plus a 1-99 paisa suffix that makes concurrent payments distinguishable.
     * Keeping the base separately means the quoted price is still recoverable,
     * refunds can be computed from it, and the UI can explain the suffix instead
     * of showing a number that silently differs from the price list.
     */
    baseAmountPaise: integer('base_amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    /** VPA the customer must pay. Snapshot: changing the payee later must not
     *  rewrite history for an order that was already shown to a customer. */
    payeeVpa: text('payee_vpa').notNull(),
    payeeName: text('payee_name').notNull(),
    status: upiOrderStatusEnum('status').notNull().default('pending'),
    /** Frozen UPI payload so a re-render cannot silently change what was paid. */
    upiUri: text('upi_uri').notNull(),
    /** Denormalised plan info, so the checkout can render without a join. */
    planId: text('plan_id'),
    description: text('description').notNull().default(''),
    /** Short-lived orders; expired orders never settle. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /** Reason recorded when an order is cancelled or rejected. */
    closedReason: text('closed_reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('upi_orders_reference_idx').on(t.reference),
    // The hot query: "is there a live order for this user?" and the observer's
    // "find candidate orders by amount" both filter on status + expiry.
    index('upi_orders_status_expiry_idx').on(t.status, t.expiresAt),
    index('upi_orders_user_idx').on(t.userId, t.createdAt),
    index('upi_orders_amount_idx').on(t.amountPaise, t.status),
    index('upi_orders_payment_idx').on(t.paymentId),
    /*
     * At most one *live* order may hold a given amount.
     *
     * This is the database-level guarantee behind amount reservation. Two
     * concurrent checkouts that randomly drew the same suffix cannot both exist:
     * the second insert fails with 23505 and the caller retries with a new
     * suffix. Scoped to pending/under_review so a settled or expired order does
     * not permanently burn its amount.
     *
     * It is a collision-avoidance device, not proof that money arrived: matching
     * still requires a bank reference and the notification dedupe rules.
     */
    uniqueIndex('upi_orders_active_amount_idx')
      .on(t.amountPaise)
      .where(sql`${t.status} in ('pending', 'under_review')`),
  ],
);

/** Every ingested bank/UPI notification, whether or not it matched. */
export const upiNotifications = pgTable(
  'upi_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: upiNotificationSourceEnum('source').notNull(),
    /** Stable hash of the source message, used for duplicate suppression. */
    dedupeKey: text('dedupe_key').notNull(),
    /** UTR/RRN when the bank supplied one. Also used for duplicate detection. */
    bankReference: text('bank_reference'),
    amountPaise: integer('amount_paise'),
    senderVpa: text('sender_vpa'),
    /** When the bank said it happened, not when we read it. */
    observedAt: timestamp('observed_at', { withTimezone: true }),
    /**
     * When we ingested it. This *is* the `created_at` column, aliased so the
     * code reads as `receivedAt` in the notification context. Adding a second
     * `createdAt` here would emit the column twice.
     */
    receivedAt: createdAt,
    status: upiNotificationStatusEnum('status').notNull().default('received'),
    /** Why we rejected it, or which order it matched. */
    decisionReason: text('decision_reason'),
    /** Confidence 0-100 from the risk engine. */
    confidence: integer('confidence'),
    rawText: text('raw_text').notNull().default(''),
    /** From/Subject for email, sender id for SMS. Never a full mailbox payload. */
    rawMeta: jsonb('raw_meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    // The duplicate guard: the same alert cannot be ingested twice.
    uniqueIndex('upi_notifications_dedupe_idx').on(t.dedupeKey),
    // A UTR may only settle once, ever.
    uniqueIndex('upi_notifications_utr_idx')
      .on(t.bankReference)
      .where(sql`${t.bankReference} IS NOT NULL`),
    index('upi_notifications_status_idx').on(t.status, t.receivedAt),
    index('upi_notifications_observed_idx').on(t.observedAt),
  ],
);

/** The join between a notification and the order it settles. */
export const upiMatches = pgTable(
  'upi_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => upiOrders.id, { onDelete: 'cascade' }),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => upiNotifications.id, { onDelete: 'cascade' }),
    decision: upiMatchDecisionEnum('decision').notNull(),
    /** Free-form explanation: the risk engine's reasons, in order. */
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    confidence: integer('confidence').notNull().default(0),
    amountPaise: integer('amount_paise').notNull(),
    createdAt,
  },
  (t) => [
    // One notification settles at most one order.
    uniqueIndex('upi_matches_notification_idx').on(t.notificationId),
    // One order is settled at most once (auto or manual).
    uniqueIndex('upi_matches_order_settled_idx')
      .on(t.orderId)
      .where(sql`${t.decision} IN ('auto_approved', 'manual_approved')`),
    index('upi_matches_order_idx').on(t.orderId),
  ],
);

/**
 * Audit log of every decision the risk engine made, including rejections.
 * Kept separate from `upi_matches` so a rejected attempt leaves a trace even
 * though no match row is written.
 */
export const upiRiskEvents = pgTable(
  'upi_risk_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').references(() => upiOrders.id, { onDelete: 'set null' }),
    notificationId: uuid('notification_id').references(() => upiNotifications.id, {
      onDelete: 'set null',
    }),
    decision: text('decision').notNull(),
    confidence: integer('confidence').notNull().default(0),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    /** Signals that drove the decision, for later tuning. */
    signals: jsonb('signals').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => [index('upi_risk_events_created_idx').on(t.createdAt)],
);

/**
 * Observer health. One row per configured observer so the admin dashboard can
 * show "Gmail polled 40s ago" without scraping logs.
 */
export const upiObserverState = pgTable(
  'upi_observer_state',
  {
    id: text('id').primaryKey(),
    lastPollAt: timestamp('last_poll_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    /** Opaque, non-secret cursor (e.g. Gmail historyId or last internalDate). */
    cursor: text('cursor'),
    updatedAt,
  },
  (t) => [index('upi_observer_state_poll_idx').on(t.lastPollAt)],
);

/** Refunds against a settled UPI order. */
export const upiRefunds = pgTable(
  'upi_refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => upiOrders.id, { onDelete: 'cascade' }),
    amountPaise: integer('amount_paise').notNull(),
    status: text('status').notNull().default('requested'),
    reason: text('reason').notNull().default(''),
    /** Who initiated it. Refunds are money leaving the account, so always named. */
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Where the refund was actually sent. We cannot move money back
     * automatically over P2P UPI, so an operator pays it and records the UTR.
     */
    payoutReference: text('payout_reference'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [index('upi_refunds_order_idx').on(t.orderId), index('upi_refunds_status_idx').on(t.status)],
);

/**
 * Operator-editable UPI configuration.
 *
 * Before this table existed the whole integration was configured by editing
 * environment variables and re-running an OAuth script on the host. That made
 * routine changes (a new payee VPA, reconnecting the mailbox) a deploy.
 *
 * Exactly one row is used, with `key = 'global'`, mirroring `settings`.
 *
 * Two rules govern every column here:
 *
 *  - Credentials are stored **only** encrypted (`*_enc`), never in clear. The
 *    encryption key lives in Doppler, so a database dump alone does not yield a
 *    usable Gmail token.
 *  - A NULL means "not configured here"; the resolver then falls back to the
 *    environment. That keeps an env-only deployment working exactly as before
 *    and makes rollback a matter of clearing this row.
 */
export const upiConfig = pgTable('upi_config', {
  key: text('key').primaryKey().default('global'),

  /** UPI id that receives money. Checkout is unavailable until this is valid. */
  payeeVpa: text('payee_vpa'),
  payeeName: text('payee_name'),

  /**
   * Accepting money and detecting payments are deliberately separate switches.
   * The observer must be provable before checkout is opened, because a working
   * detector with checkout closed costs nothing while the reverse takes money
   * it cannot confirm.
   */
  /*
   * Nullable on purpose. NULL means "no dashboard opinion, use the environment",
   * so an environment-only deployment is unaffected by this table existing.
   * An explicit true/false is an operator decision and outranks the environment.
   */
  paymentsEnabled: boolean('payments_enabled'),
  gmailEnabled: boolean('gmail_enabled'),

  /** Never turned on by the dashboard without an explicit, confirmed action. */
  autoApprove: boolean('auto_approve'),

  /** Mailbox address, used as the `UPI_GMAIL_USER` equivalent. */
  gmailUser: text('gmail_user'),
  gmailClientId: text('gmail_client_id'),
  /** AES-256-GCM envelopes; see `lib/secretbox.ts`. */
  gmailClientSecretEnc: text('gmail_client_secret_enc'),
  gmailRefreshTokenEnc: text('gmail_refresh_token_enc'),

  /** Provenance and health of the current connection. */
  gmailConnectedAt: timestamp('gmail_connected_at', { withTimezone: true }),
  gmailConnectedEmail: text('gmail_connected_email'),
  gmailScopes: text('gmail_scopes'),
  gmailLastVerifiedAt: timestamp('gmail_last_verified_at', { withTimezone: true }),

  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt,
});

export type UpiOrder = typeof upiOrders.$inferSelect;
export type UpiNotification = typeof upiNotifications.$inferSelect;
export type UpiMatch = typeof upiMatches.$inferSelect;
export type UpiRefund = typeof upiRefunds.$inferSelect;
export type UpiConfig = typeof upiConfig.$inferSelect;
export type NewUpiConfig = typeof upiConfig.$inferInsert;
