/**
 * ExamDump Mail — background worker and schedulers.
 *
 * Runs inside the API process on a timer. Deliberately not a separate service:
 * at this volume a second container costs more than it saves, and the queue is
 * durable so a restart simply resumes.
 *
 * Three jobs:
 *   1. drainQueue   - send due messages (every MAIL_WORKER_INTERVAL_SECONDS)
 *   2. scheduleReminders - queue expiry/cancellation notices (daily cron)
 *   3. dispatchCampaigns - fan scheduled campaigns out into the queue
 */
import type { and, SQL } from 'drizzle-orm';
import { and as andFn, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { emailCampaigns, payments, users } from '../../db/schema/index.js';
import type { MailLogger } from './mail.service.js';
import { processQueueBatch, recoverStaleLocks, type ProcessResult } from './queue.service.js';
import { notifySubscription } from './notify.service.js';
import { enqueueCampaign } from './campaign.service.js';

export interface WorkerState {
  running: boolean;
  lastRunAt: Date | null;
  lastResult: ProcessResult | null;
  lastError: string | null;
  totalSent: number;
}

export const workerState: WorkerState = {
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  totalSent: 0,
};

let workerId = `worker-${process.pid}`;

/**
 * Drain one batch.
 *
 * Guarded by a boolean so overlapping timers cannot double-process; the database
 * lock would prevent double *sends* anyway, this just avoids wasted work.
 */
export async function drainQueue(env: Env, logger?: MailLogger): Promise<ProcessResult | null> {
  if (!env.MAIL_QUEUE_ENABLED) return null;
  if (workerState.running) return null;
  workerState.running = true;
  try {
    const result = await processQueueBatch(env, { workerId, limit: env.MAIL_BATCH_SIZE, logger });
    workerState.lastRunAt = new Date();
    workerState.lastResult = result;
    workerState.lastError = null;
    workerState.totalSent += result.sent;
    if (result.sent || result.dead) logger?.info(result, 'mail.queue_batch');
    return result;
  } catch (err) {
    workerState.lastError = (err as Error).message;
    logger?.error({ err }, 'mail.queue_batch_failed');
    return null;
  } finally {
    workerState.running = false;
  }
}

/** Set the worker id (useful in tests to assert lock ownership). */
export function setWorkerId(id: string): void {
  workerId = id;
}

/* ------------------------- subscription reminders ------------------------- */

export interface ReminderResult {
  expiringQueued: number;
  expiringSkipped: number;
  cancelledQueued: number;
}

/**
 * Queue expiry reminders for premium users whose plan lapses within `daysAhead`.
 *
 * Once per user per expiry date, enforced by the queue's dedupe key. Running
 * this every day - or twice in one day - cannot produce a second email, and a
 * user who cancels simply never matches the query again.
 */
export async function scheduleSubscriptionReminders(
  env: Env,
  options: { daysAhead?: number; logger?: MailLogger } = {},
): Promise<ReminderResult> {
  if (!env.MAIL_QUEUE_ENABLED) return { expiringQueued: 0, expiringSkipped: 0, cancelledQueued: 0 };
  const db = getDb();
  const daysAhead = options.daysAhead ?? 3;
  const now = new Date();
  const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const expiring = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      premiumUntil: users.premiumUntil,
    })
    .from(users)
    .where(
      andFn(
        eq(users.plan, 'premium'),
        eq(users.suspended, false),
        isNotNull(users.premiumUntil),
        // Window is (now, horizon] so already-expired accounts are not reminded.
        gte(users.premiumUntil, now),
        lte(users.premiumUntil, horizon),
      ),
    )
    .limit(500);

  let expiringQueued = 0;
  let expiringSkipped = 0;
  for (const user of expiring) {
    if (!user.premiumUntil) continue;
    const periodKey = user.premiumUntil.toISOString().slice(0, 10);
    const result = await notifySubscription(env, {
      to: user.email,
      userId: user.id,
      name: user.name,
      kind: 'expiring',
      dateLabel: 'Expires on',
      dateValue: user.premiumUntil.toUTCString(),
      periodKey,
      logger: options.logger,
    });
    if (result.queued) expiringQueued += 1;
    else expiringSkipped += 1;
  }

  return { expiringQueued, expiringSkipped, cancelledQueued: 0 };
}

/**
 * Queue a cancellation notice for accounts whose premium lapsed in the last day.
 *
 * Only users who actually held a paid payment are considered, so a comped or
 * manually-set plan does not receive a "your subscription was cancelled" email.
 */
export async function scheduleCancellationNotices(
  env: Env,
  options: { logger?: MailLogger } = {},
): Promise<number> {
  if (!env.MAIL_QUEUE_ENABLED) return 0;
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const lapsed = await db
    .selectDistinct({
      id: users.id,
      email: users.email,
      name: users.name,
      premiumUntil: users.premiumUntil,
    })
    .from(users)
    .innerJoin(payments, eq(payments.userId, users.id))
    .where(
      andFn(
        ne(users.plan, 'premium'),
        isNotNull(users.premiumUntil),
        gte(users.premiumUntil, since),
        sql`${payments.status} in ('succeeded','partially_refunded')`,
      ) as SQL,
    )
    .limit(500);

  let queued = 0;
  for (const user of lapsed) {
    const periodKey = (user.premiumUntil ?? new Date()).toISOString().slice(0, 10);
    const result = await notifySubscription(env, {
      to: user.email,
      userId: user.id,
      name: user.name,
      kind: 'cancelled',
      dateLabel: 'Ended on',
      dateValue: periodKey,
      periodKey,
      logger: options.logger,
    });
    if (result.queued) queued += 1;
  }
  return queued;
}

/* --------------------------- campaign dispatch --------------------------- */

/**
 * Turn scheduled campaigns whose time has come into queued messages.
 *
 * Idempotent: a campaign moves to `sending` before fan-out, and each recipient
 * row carries a dedupe key, so a crash mid-fan-out resumes without duplicates.
 */
export async function dispatchScheduledCampaigns(
  env: Env,
  logger?: MailLogger,
): Promise<{ dispatched: number }> {
  if (!env.MAIL_QUEUE_ENABLED) return { dispatched: 0 };
  const db = getDb();
  const due = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(
      andFn(eq(emailCampaigns.status, 'scheduled'), lte(emailCampaigns.scheduledFor, new Date())),
    )
    .limit(5);

  let dispatched = 0;
  for (const campaign of due) {
    try {
      await enqueueCampaign(env, campaign.id, logger);
      dispatched += 1;
    } catch (err) {
      logger?.error({ err, campaignId: campaign.id }, 'mail.campaign_dispatch_failed');
      await db
        .update(emailCampaigns)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(emailCampaigns.id, campaign.id));
    }
  }
  return { dispatched };
}

/** Startup recovery: release rows orphaned by a crash or deploy. */
export async function recoverQueue(env: Env, logger?: MailLogger): Promise<number> {
  const released = await recoverStaleLocks(env.MAIL_LOCK_LEASE_SECONDS * 1000);
  if (released > 0) logger?.info({ released }, 'mail.queue_recovered');
  return released;
}

/**
 * One scheduled tick: the jobs an external cron would otherwise run.
 * Exposed so the deployment can drive it from a single timer.
 */
export async function runScheduledJobs(env: Env, logger?: MailLogger) {
  const [reminders, cancellations, campaigns] = [
    await scheduleSubscriptionReminders(env, { logger }).catch((err) => {
      logger?.error({ err }, 'mail.reminders_failed');
      return null;
    }),
    await scheduleCancellationNotices(env, { logger }).catch((err) => {
      logger?.error({ err }, 'mail.cancellation_notices_failed');
      return 0;
    }),
    await dispatchScheduledCampaigns(env, logger).catch((err) => {
      logger?.error({ err }, 'mail.campaign_dispatch_failed');
      return { dispatched: 0 };
    }),
  ];
  return { reminders, cancellations, campaigns };
}
