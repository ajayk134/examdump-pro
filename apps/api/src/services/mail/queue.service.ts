/**
 * ExamDump Mail — durable outbound queue.
 *
 * Why a table-backed queue instead of an in-process buffer:
 *
 *  - A message accepted at signup must survive a deploy or crash. An in-memory
 *    queue silently loses it; this one resumes from the database.
 *  - Claiming uses `FOR UPDATE SKIP LOCKED`, so two workers (or a restart while
 *    a batch is in flight) can never pick up the same row.
 *  - Retries, backoff, dead-lettering and dedupe are all expressed in SQL, which
 *    means they hold under concurrency instead of relying on an application lock.
 *
 * Everything a send needs is stored on the row (rendered subject/html/text), so
 * editing a template later cannot change a message that is already queued.
 */
import { and, eq, sql, inArray, lt, desc, count } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { emailQueue, emailCampaigns } from '../../db/schema/index.js';
import type { EmailQueueRow } from '../../db/schema/mail.js';
import { sendRenderedMail } from './transport.js';

export type QueueStatus = EmailQueueRow['status'];

export interface EnqueueInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  category?: 'transactional' | 'marketing';
  userId?: string | null;
  campaignId?: string | null;
  referenceId?: string | null;
  /** ISO date/delay: when the message becomes eligible. Default now. */
  scheduledFor?: Date;
  maxAttempts?: number;
  /**
   * Idempotency key. Re-enqueuing with the same key is a no-op. Use for
   * lifecycle mail (expiry reminders) so a repeated cron tick cannot double-send.
   */
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EnqueueResult {
  queued: boolean;
  id?: string;
  /** True when an existing row already covered this dedupe key. */
  duplicate?: boolean;
}

/** Default backoff between attempts: 1m, 5m, 15m, 1h, ... capped. */
export function backoffMs(attempt: number): number {
  const ladder = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];
  const index = Math.min(attempt - 1, ladder.length - 1);
  return ladder[Math.max(0, index)] ?? ladder[ladder.length - 1]!;
}

/** Queue one message. Never throws on a duplicate. */
export async function enqueueEmail(input: EnqueueInput): Promise<EnqueueResult> {
  const db = getDb();
  try {
    const [row] = await db
      .insert(emailQueue)
      .values({
        userId: input.userId ?? null,
        campaignId: input.campaignId ?? null,
        template: input.template,
        category: input.category ?? 'transactional',
        recipient: input.to.trim().toLowerCase(),
        subject: input.subject,
        html: input.html,
        text: input.text,
        status: 'queued',
        maxAttempts: input.maxAttempts ?? 3,
        scheduledFor: input.scheduledFor ?? new Date(),
        dedupeKey: input.dedupeKey ?? null,
        referenceId: input.referenceId ?? null,
        metadata: input.metadata ?? {},
      })
      .returning({ id: emailQueue.id });
    return { queued: true, id: row?.id };
  } catch (err) {
    // 23505 = unique_violation on the dedupe index: already queued, which is
    // the desired outcome, not an error.
    if ((err as { code?: string }).code === '23505') {
      return { queued: false, duplicate: true };
    }
    throw err;
  }
}

export interface ClaimOptions {
  limit?: number;
  /** Identifies this worker in `locked_by` for crash diagnosis. */
  workerId: string;
  /**
   * Rows locked longer ago than this are considered abandoned by a crashed
   * worker and become claimable again.
   */
  staleAfterMs?: number;
}

/**
 * Atomically claim a batch of due messages.
 *
 * A row locked by a worker that died (deploy, OOM) is recovered once its lock
 * is older than `staleAfterMs`, so mail is never permanently stuck.
 */
export async function claimBatch(env: Env, options: ClaimOptions): Promise<EmailQueueRow[]> {
  const db = getDb();
  const limit = Math.max(1, Math.min(options.limit ?? env.MAIL_BATCH_SIZE, 100));
  const staleSeconds = Math.ceil((options.staleAfterMs ?? 5 * 60_000) / 1000);

  // A single statement: select due rows, skipping locked ones, and mark them
  // as ours. The inner CTE guarantees the row set matches the update set.
  const rows = await db.execute(sql`
    with due as (
      select id from ${emailQueue}
      where (
        (${emailQueue.status} = 'queued' and ${emailQueue.scheduledFor} <= now())
        or (${emailQueue.status} = 'sending'
            and ${emailQueue.lockedAt} is not null
            and ${emailQueue.lockedAt} < now() - (${staleSeconds} || ' seconds')::interval)
      )
      order by ${emailQueue.scheduledFor} asc
      limit ${limit}
      for update skip locked
    )
    update ${emailQueue} q
    set status = 'sending',
        locked_at = now(),
        locked_by = ${options.workerId},
        attempts = q.attempts + 1,
        updated_at = now()
    from due
    where q.id = due.id
    returning q.*
  `);

  /**
   * `db.execute` yields raw driver rows with snake_case keys, not the
   * camelCase shape the rest of the code expects. Normalise explicitly rather
   * than casting, so a missing column fails here instead of becoming
   * `undefined` deep inside the sender.
   */
  return (rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    userId: (row.user_id ?? null) as string | null,
    campaignId: (row.campaign_id ?? null) as string | null,
    template: row.template as string,
    category: row.category as EmailQueueRow['category'],
    recipient: row.recipient as string,
    subject: row.subject as string,
    html: row.html as string,
    text: row.text as string,
    status: row.status as EmailQueueRow['status'],
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    scheduledFor: new Date(row.scheduled_for as string),
    lockedAt: row.locked_at ? new Date(row.locked_at as string) : null,
    lockedBy: (row.locked_by ?? null) as string | null,
    sentAt: row.sent_at ? new Date(row.sent_at as string) : null,
    lastError: (row.last_error ?? null) as string | null,
    messageId: (row.message_id ?? null) as string | null,
    dedupeKey: (row.dedupe_key ?? null) as string | null,
    referenceId: (row.reference_id ?? null) as string | null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }));
}

/** Mark a delivered message. */
export async function markSent(id: string, messageId: string | undefined): Promise<void> {
  const db = getDb();
  await db
    .update(emailQueue)
    .set({
      status: 'sent',
      sentAt: new Date(),
      messageId: messageId ?? null,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(emailQueue.id, id));
}

export type FailureDisposition = 'requeued' | 'dead';

/**
 * Record a failed attempt.
 *
 * Retryable failures go back to `queued` with exponential backoff. Permanent
 * failures (bad address, auth rejected) and exhausted attempts go to `dead`,
 * where an operator can inspect and re-queue them.
 */
export async function markFailed(
  id: string,
  error: string,
  options: { retryable: boolean; maxAttempts: number; attempts: number },
): Promise<FailureDisposition> {
  const db = getDb();
  const exhausted = options.attempts >= options.maxAttempts;
  const dead = !options.retryable || exhausted;

  if (dead) {
    await db
      .update(emailQueue)
      .set({
        status: 'dead',
        lastError: error.slice(0, 1000),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(emailQueue.id, id));
    return 'dead';
  }

  const delay = backoffMs(options.attempts);
  await db
    .update(emailQueue)
    .set({
      status: 'queued',
      lastError: error.slice(0, 1000),
      scheduledFor: new Date(Date.now() + delay),
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(emailQueue.id, id));
  return 'requeued';
}

/** Mark a row suppressed (consent, suppression list, missing preference). */
export async function markSuppressed(id: string, reason: string): Promise<void> {
  const db = getDb();
  await db
    .update(emailQueue)
    .set({
      status: 'suppressed',
      lastError: reason.slice(0, 1000),
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(emailQueue.id, id));
}

export interface ProcessResult {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  suppressed: number;
}

/**
 * Process one batch: claim, send, record outcome.
 *
 * Safe to call concurrently; safe to interrupt at any point thanks to the
 * lease on `locked_at`.
 */
export async function processQueueBatch(
  env: Env,
  options: { workerId: string; limit?: number; logger?: MailLogger },
): Promise<ProcessResult> {
  const rows = await claimBatch(env, options);
  const result: ProcessResult = { claimed: rows.length, sent: 0, retried: 0, dead: 0, suppressed: 0 };
  if (rows.length === 0) return result;

  for (const row of rows) {
    const outcome = await sendRenderedMail(env, row, options.logger);
    if (outcome.outcome === 'sent') {
      await markSent(row.id, outcome.messageId);
      result.sent += 1;
    } else if (outcome.outcome === 'suppressed') {
      await markSuppressed(row.id, outcome.error ?? 'suppressed');
      result.suppressed += 1;
    } else {
      const disposition = await markFailed(row.id, outcome.error ?? 'unknown_error', {
        retryable: outcome.retryable,
        maxAttempts: row.maxAttempts,
        attempts: row.attempts,
      });
      if (disposition === 'dead') result.dead += 1;
      else result.retried += 1;
    }
    if (row.campaignId) await updateCampaignCounters(row.campaignId).catch(() => undefined);
  }
  return result;
}

/** Refresh the denormalised campaign counters after a batch touches them. */
export async function updateCampaignCounters(campaignId: string): Promise<void> {
  const db = getDb();
  const [stats] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${emailQueue.status} = 'sent')`,
      failed: sql<number>`count(*) filter (where ${emailQueue.status} = 'dead')`,
      suppressed: sql<number>`count(*) filter (where ${emailQueue.status} = 'suppressed')`,
      pending: sql<number>`count(*) filter (where ${emailQueue.status} in ('queued','sending','failed'))`,
    })
    .from(emailQueue)
    .where(eq(emailQueue.campaignId, campaignId));

  const pending = Number(stats?.pending ?? 0);
  await db
    .update(emailCampaigns)
    .set({
      sentCount: Number(stats?.sent ?? 0),
      failedCount: Number(stats?.failed ?? 0),
      suppressedCount: Number(stats?.suppressed ?? 0),
      // A campaign is complete only once nothing is left to process.
      ...(pending === 0
        ? { status: 'sent' as const, completedAt: new Date() }
        : { status: 'sending' as const }),
      updatedAt: new Date(),
    })
    .where(eq(emailCampaigns.id, campaignId));
}

/** Move dead rows back to queued so they get another chance. */
export async function requeueFailed(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const rows = await db
    .update(emailQueue)
    .set({
      status: 'queued',
      attempts: 0,
      scheduledFor: new Date(),
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(and(inArray(emailQueue.id, ids), inArray(emailQueue.status, ['dead', 'failed', 'cancelled'])))
    .returning({ id: emailQueue.id });
  return rows.length;
}

/** Cancel everything still pending for a campaign. */
export async function cancelCampaignQueue(campaignId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(emailQueue)
    .set({ status: 'cancelled', lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(
      and(eq(emailQueue.campaignId, campaignId), inArray(emailQueue.status, ['queued', 'sending', 'failed'])),
    )
    .returning({ id: emailQueue.id });
  return rows.length;
}

export interface QueueStats {
  queued: number;
  sending: number;
  sent: number;
  dead: number;
  suppressed: number;
  cancelled: number;
}

export async function queueStats(): Promise<QueueStats> {
  const db = getDb();
  const rows = await db
    .select({ status: emailQueue.status, value: count() })
    .from(emailQueue)
    .groupBy(emailQueue.status);
  const out: QueueStats = { queued: 0, sending: 0, sent: 0, dead: 0, suppressed: 0, cancelled: 0 };
  for (const row of rows) {
    if (row.status in out) out[row.status as keyof QueueStats] = Number(row.value);
  }
  return out;
}

/**
 * Queue health for /health/ready.
 *
 * A growing dead-letter count is a real operational problem, so it is surfaced
 * rather than hidden. It never fails readiness: mail is not on the request path.
 */
export async function queueHealth(): Promise<{
  ok: boolean;
  backlog: number;
  stuck: number;
  dead: number;
}> {
  const db = getDb();
  const [row] = await db
    .select({
      backlog: sql<number>`count(*) filter (where ${emailQueue.status} = 'queued')`,
      stuck: sql<number>`count(*) filter (where ${emailQueue.status} = 'sending' and ${emailQueue.lockedAt} < now() - interval '15 minutes')`,
      dead: sql<number>`count(*) filter (where ${emailQueue.status} = 'dead')`,
    })
    .from(emailQueue);
  const backlog = Number(row?.backlog ?? 0);
  const stuck = Number(row?.stuck ?? 0);
  const dead = Number(row?.dead ?? 0);
  return { ok: stuck === 0, backlog, stuck, dead };
}

/** Recent queue rows for the admin console. */
export async function listQueue(options: {
  status?: QueueStatus;
  search?: string;
  limit?: number;
  offset?: number;
  campaignId?: string;
}): Promise<{ rows: EmailQueueRow[]; total: number }> {
  const db = getDb();
  const conditions = [];
  if (options.status) conditions.push(eq(emailQueue.status, options.status));
  if (options.campaignId) conditions.push(eq(emailQueue.campaignId, options.campaignId));
  if (options.search) {
    const like = `%${options.search.toLowerCase()}%`;
    conditions.push(sql`(lower(${emailQueue.recipient}) like ${like} or lower(${emailQueue.subject}) like ${like})`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(emailQueue)
    .where(where)
    .orderBy(desc(emailQueue.createdAt))
    .limit(Math.min(options.limit ?? 25, 100))
    .offset(options.offset ?? 0);

  const [totalRow] = await db.select({ value: count() }).from(emailQueue).where(where);
  return { rows, total: Number(totalRow?.value ?? 0) };
}

export interface MailLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/** Reset rows stuck in `sending` beyond the lease. Called at startup. */
export async function recoverStaleLocks(staleAfterMs = 5 * 60_000): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - staleAfterMs);
  const rows = await db
    .update(emailQueue)
    .set({ status: 'queued', lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(and(eq(emailQueue.status, 'sending'), lt(emailQueue.lockedAt, cutoff)))
    .returning({ id: emailQueue.id });
  return rows.length;
}
