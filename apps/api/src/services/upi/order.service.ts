/**
 * UPI order and notification lifecycle.
 *
 * This is where the guarantees live:
 *
 *  - an order can be settled at most once, enforced by a partial unique index on
 *    `upi_matches` as well as by row locks;
 *  - a notification can settle at most one order, enforced by a unique index on
 *    `upi_matches.notification_id`;
 *  - the same bank alert cannot be ingested twice, enforced by a unique
 *    `dedupe_key` and, for UTR-bearing alerts, a unique `bank_reference`;
 *  - entitlement is granted by `settlePayment()` inside the same transaction that
 *    marks the match, so a crash cannot leave a paid order without a plan.
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import {
  payments,
  upiMatches,
  upiNotifications,
  upiObserverState,
  upiOrders,
  upiRefunds,
  upiRiskEvents,
  type UpiNotification,
  type UpiOrder,
} from '../../db/schema/index.js';
import type { Env } from '../../config/env.js';
import { settlePayment } from '../subscription.service.js';
import { buildUpiUri, sanitizeNote } from './uri.js';
import { parseBankNotification } from './parser.js';
import {
  DEFAULT_RISK_CONFIG,
  assessNotification,
  screenNotification,
  type RiskAssessment,
} from './risk.js';
import { MAX_AMOUNT_PAISE } from './money.js';

/* ------------------------------- helpers -------------------------------- */

/** Message digest used to suppress duplicate ingestion of the same alert. */
function dedupeKeyFor(source: string, parts: Array<string | null | undefined>): string {
  const material = [source, ...parts.map((p) => p ?? '')].join('\u0000');
  return createHash('sha256').update(material).digest('hex');
}

/** Order reference shown to the customer and echoed in the UPI note. */
export function generateReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1: ambiguous when read aloud
  const bytes = randomBytes(8);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `ED${out}`;
}

export interface CreateOrderInput {
  userId: string;
  paymentId: string;
  amountPaise: number;
  planId?: string | null;
  description?: string;
  /** Minutes the customer has to pay. */
  ttlMinutes?: number;
}

/**
 * Create a UPI order. The UPI payload is frozen at creation so what the customer
 * scanned is exactly what we later try to match.
 */
export async function createUpiOrder(env: Env, input: CreateOrderInput): Promise<UpiOrder> {
  if (!env.UPI_PAYEE_VPA) throw new Error('upi_not_configured');
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error('invalid_amount');
  }
  if (input.amountPaise > MAX_AMOUNT_PAISE) throw new Error('amount_above_maximum');

  const db = getDb();
  const ttlMinutes = Math.min(Math.max(input.ttlMinutes ?? env.UPI_ORDER_TTL_MINUTES, 3), 120);

  // Retry reference collisions; they are astronomically unlikely but the unique
  // index means a collision would otherwise surface as a 500.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = generateReference();
    if (!/^[A-Z0-9]{4,20}$/.test(reference)) throw new Error('invalid_reference_format');
    const upiUri = buildUpiUri({
      payeeVpa: env.UPI_PAYEE_VPA,
      payeeName: env.UPI_PAYEE_NAME || 'ExamDump',
      amountPaise: input.amountPaise,
      transactionRef: sanitizeNote(reference, 20),
    });

    try {
      const [order] = await db
        .insert(upiOrders)
        .values({
          reference,
          userId: input.userId,
          paymentId: input.paymentId,
          amountPaise: input.amountPaise,
          payeeVpa: env.UPI_PAYEE_VPA,
          payeeName: env.UPI_PAYEE_NAME || 'ExamDump',
          upiUri,
          planId: input.planId ?? null,
          description: input.description ?? '',
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        })
        .returning();
      return order!;
    } catch (err) {
      // 23505 = unique_violation on reference; try another.
      if ((err as { code?: string }).code === '23505' && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error('reference_generation_failed');
}

/** The customer's currently payable order, if any. */
export async function getActiveOrder(userId: string): Promise<UpiOrder | null> {
  const db = getDb();
  const [order] = await db
    .select()
    .from(upiOrders)
    .where(
      and(
        eq(upiOrders.userId, userId),
        inArray(upiOrders.status, ['pending', 'under_review']),
        gte(upiOrders.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(upiOrders.createdAt))
    .limit(1);
  return order ?? null;
}

export async function getOrderById(orderId: string): Promise<UpiOrder | null> {
  const db = getDb();
  const [order] = await db.select().from(upiOrders).where(eq(upiOrders.id, orderId)).limit(1);
  return order ?? null;
}

/** Expire stale pending orders. Called on a timer; safe to run concurrently. */
export async function expireStaleOrders(now = new Date()): Promise<number> {
  const db = getDb();
  const expired = await db
    .update(upiOrders)
    .set({ status: 'expired', closedReason: 'ttl_elapsed', updatedAt: now })
    .where(and(inArray(upiOrders.status, ['pending', 'under_review']), lt(upiOrders.expiresAt, now)))
    .returning({ id: upiOrders.id });
  return expired.length;
}

export async function cancelOrder(orderId: string, reason = 'cancelled_by_user'): Promise<void> {
  const db = getDb();
  await db
    .update(upiOrders)
    .set({ status: 'cancelled', cancelledAt: new Date(), closedReason: reason, updatedAt: new Date() })
    .where(and(eq(upiOrders.id, orderId), eq(upiOrders.status, 'pending')));
}

/* ---------------------------- notification ingest ------------------------ */

export interface IngestResult {
  status: 'matched' | 'unmatched' | 'rejected' | 'ignored' | 'duplicate';
  notificationId?: string;
  orderId?: string;
  reason?: string;
  confidence?: number;
}

export interface IngestInput {
  source: 'gmail' | 'sms' | 'webhook' | 'manual';
  text: string;
  /** Epoch milliseconds, ISO string, or Date. */
  timestamp?: Date | string | number;
  /** Extra non-secret context: email From, message id, etc. */
  meta?: Record<string, unknown>;
}

/**
 * Ingest one bank notification, then try to settle an order with it.
 *
 * Everything runs in one transaction so a notification cannot be marked matched
 * without its match row and payment settlement, and vice versa.
 */
export async function ingestNotification(env: Env, input: IngestInput): Promise<IngestResult> {
  const db = getDb();
  const parsed = parseBankNotification({ text: input.text, timestamp: input.timestamp });

  const observedAt = parsed?.observedAt ?? null;
  const dedupeKey = dedupeKeyFor(input.source, [
    parsed?.bankReferenceNumber ?? null,
    parsed?.amountPaise?.toString() ?? null,
    observedAt ? observedAt.toISOString() : null,
    parsed?.rawText ?? input.text.slice(0, 200),
  ]);

  // Screen before touching orders. Cheap and keeps junk out of the match path.
  if (!parsed) {
    await db
      .insert(upiNotifications)
      .values({
        source: input.source,
        dedupeKey,
        status: 'ignored',
        decisionReason: 'not_a_credit_notification',
        rawText: input.text.slice(0, 4000),
        rawMeta: input.meta ?? {},
      })
      .onConflictDoNothing({ target: upiNotifications.dedupeKey });
    return { status: 'ignored', reason: 'not_a_credit_notification' };
  }

  const config = DEFAULT_RISK_CONFIG;
  const screen = screenNotification(parsed, {
    payeeVpa: env.UPI_PAYEE_VPA || '',
    maxAmountPaise: env.UPI_NOTIFICATION_MAX_PAISE,
  });
  if (!screen.ok) {
    const [row] = await db
      .insert(upiNotifications)
      .values({
        source: input.source,
        dedupeKey,
        bankReference: parsed.bankReferenceNumber ?? null,
        amountPaise: parsed.amountPaise,
        senderVpa: parsed.senderVpa ?? null,
        observedAt: parsed.observedAt,
        status: 'rejected',
        decisionReason: screen.reason ?? 'screened_out',
        rawText: parsed.rawText,
        rawMeta: input.meta ?? {},
      })
      .onConflictDoNothing({ target: upiNotifications.dedupeKey })
      .returning({ id: upiNotifications.id });
    return { status: row ? 'rejected' : 'duplicate', reason: screen.reason, notificationId: row?.id };
  }

  // Insert the notification. A duplicate alert short-circuits here.
  let notificationId: string;
  try {
    const [row] = await db
      .insert(upiNotifications)
      .values({
        source: input.source,
        dedupeKey,
        bankReference: parsed.bankReferenceNumber ?? null,
        amountPaise: parsed.amountPaise,
        senderVpa: parsed.senderVpa ?? null,
        observedAt: parsed.observedAt,
        status: 'received',
        rawText: parsed.rawText,
        rawMeta: input.meta ?? {},
      })
      .returning({ id: upiNotifications.id });
    notificationId = row!.id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return { status: 'duplicate', reason: 'already_ingested' };
    }
    throw err;
  }

  /*
   * Find candidate orders strictly by amount, then let the risk engine decide.
   * We deliberately do not pre-filter by user: attribution must come from the
   * evidence, and an accidental narrow-window match is exactly what the
   * uniqueness check exists to catch.
   */
  const candidates = await db
    .select()
    .from(upiOrders)
    .where(
      and(
        eq(upiOrders.amountPaise, parsed.amountPaise),
        inArray(upiOrders.status, ['pending', 'under_review']),
      ),
    )
    .orderBy(asc(upiOrders.createdAt));

  if (candidates.length === 0) {
    await db
      .update(upiNotifications)
      .set({ status: 'unmatched', decisionReason: 'no_open_order_for_amount', confidence: 0 })
      .where(eq(upiNotifications.id, notificationId));
    await db.insert(upiRiskEvents).values({
      notificationId,
      decision: 'unmatched',
      confidence: 0,
      reasons: ['no_candidate'],
      signals: { amountPaise: parsed.amountPaise, candidateCount: 0 },
    });
    return { status: 'unmatched', notificationId, reason: 'no_open_order_for_amount' };
  }

  // Score every candidate; only an unambiguous winner may auto-approve.
  const assessments: Array<{ order: UpiOrder; assessment: RiskAssessment }> = candidates.map((order) => ({
    order,
    assessment: assessNotification(
      {
        amountPaise: order.amountPaise,
        createdAt: order.createdAt,
        expiresAt: order.expiresAt,
        status: order.status,
        reference: order.reference,
      },
      {
        amountPaise: parsed.amountPaise,
        bankReference: parsed.bankReferenceNumber ?? null,
        senderVpa: parsed.senderVpa ?? null,
        observedAt: parsed.observedAt,
        rawText: parsed.rawText,
      },
      candidates.length,
      config,
    ),
  }));

  const approvable = assessments.filter((a) => a.assessment.decision === 'approve');

  /*
   * `UPI_AUTO_APPROVE` is the operator's kill-switch. When it is off, a credit
   * that scored well enough to approve is still held for a human: the order goes
   * to `under_review` and the notification stays `unmatched`, so it appears in
   * the dashboard's "needs a human decision" queue. Settlement only happens
   * through `manuallyApprove`.
   *
   * Without this branch the flag was read for display only and every qualifying
   * credit settled automatically, which silently defeated the documented first
   * -deployment rule of running with auto-approve off.
   */
  if (!env.UPI_AUTO_APPROVE && approvable.length >= 1) {
    const best = approvable.sort((a, b) => b.assessment.confidence - a.assessment.confidence)[0]!;
    await db
      .update(upiNotifications)
      .set({
        status: 'unmatched',
        decisionReason: 'auto_approve_disabled_held_for_review',
        confidence: best.assessment.confidence,
      })
      .where(eq(upiNotifications.id, notificationId));
    await db
      .update(upiOrders)
      .set({ status: 'under_review', updatedAt: new Date() })
      .where(and(eq(upiOrders.id, best.order.id), eq(upiOrders.status, 'pending')));
    await db.insert(upiRiskEvents).values({
      orderId: best.order.id,
      notificationId,
      decision: 'review',
      confidence: best.assessment.confidence,
      reasons: [...best.assessment.reasons, 'auto_approve_disabled'],
      signals: best.assessment.signals,
    });
    return {
      status: 'unmatched',
      notificationId,
      orderId: best.order.id,
      confidence: best.assessment.confidence,
      reason: 'auto_approve_disabled',
    };
  }

  if (approvable.length === 1) {
    const winner = approvable[0]!;
    const settled = await settleFromNotification(env, winner.order, notificationId, winner.assessment);
    if (settled) {
      return {
        status: 'matched',
        notificationId,
        orderId: winner.order.id,
        confidence: winner.assessment.confidence,
      };
    }
    // Someone else settled it between our read and the update.
    await db
      .update(upiNotifications)
      .set({ status: 'rejected', decisionReason: 'order_already_settled', confidence: winner.assessment.confidence })
      .where(eq(upiNotifications.id, notificationId));
    return { status: 'rejected', notificationId, reason: 'order_already_settled' };
  }

  if (approvable.length > 1) {
    await db
      .update(upiNotifications)
      .set({ status: 'unmatched', decisionReason: 'multiple_approvable_candidates', confidence: 0 })
      .where(eq(upiNotifications.id, notificationId));
    await db.insert(upiRiskEvents).values({
      notificationId,
      decision: 'review',
      confidence: 0,
      reasons: ['multiple_approvable_candidates'],
      signals: { orderIds: approvable.map((a) => a.order.id) },
    });
    return { status: 'unmatched', notificationId, reason: 'multiple_approvable_candidates' };
  }

  // Nothing scored high enough. Hold the best candidate for a human instead of
  // guessing, and record why so thresholds can be tuned from real data.
  const best = assessments.sort((a, b) => b.assessment.confidence - a.assessment.confidence)[0]!;
  const decision = best.assessment.decision;

  await db
    .update(upiNotifications)
    .set({
      status: decision === 'reject' ? 'rejected' : 'unmatched',
      decisionReason: best.assessment.reasons.join(';'),
      confidence: best.assessment.confidence,
    })
    .where(eq(upiNotifications.id, notificationId));

  await db.insert(upiRiskEvents).values({
    orderId: best.order.id,
    notificationId,
    decision,
    confidence: best.assessment.confidence,
    reasons: best.assessment.reasons,
    signals: best.assessment.signals,
  });

  return {
    status: decision === 'reject' ? 'rejected' : 'unmatched',
    notificationId,
    orderId: best.order.id,
    confidence: best.assessment.confidence,
    reason: best.assessment.reasons.join(';'),
  };
}

/**
 * Settle one order from one notification, atomically.
 *
 * The order row is locked before the status check so two notifications
 * referencing the same order cannot both proceed. `settlePayment` is then called
 * inside the same transaction, which is what makes the entitlement grant and the
 * UPI bookkeeping succeed or fail together.
 */
async function settleFromNotification(
  env: Env,
  order: UpiOrder,
  notificationId: string,
  assessment: RiskAssessment,
): Promise<boolean> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(upiOrders)
      .where(eq(upiOrders.id, order.id))
      .limit(1)
      .for('update');

    if (!locked || locked.status !== 'pending') return false;

    const [notification] = await tx
      .select()
      .from(upiNotifications)
      .where(eq(upiNotifications.id, notificationId))
      .limit(1);
    if (!notification) return false;

    // Mark the notification as claimed before doing anything else, so a
    // concurrent worker sees it as taken.
    const claimed = await tx
      .update(upiNotifications)
      .set({ status: 'matched', confidence: assessment.confidence, decisionReason: assessment.reasons.join(';') })
      .where(and(eq(upiNotifications.id, notificationId), eq(upiNotifications.status, 'received')))
      .returning({ id: upiNotifications.id });
    if (claimed.length === 0) return false;

    await tx.insert(upiMatches).values({
      orderId: order.id,
      notificationId,
      decision: 'auto_approved',
      reasons: assessment.reasons,
      confidence: assessment.confidence,
      amountPaise: order.amountPaise,
    });

    await tx
      .update(upiOrders)
      .set({ status: 'settled', settledAt: new Date(), updatedAt: new Date() })
      .where(eq(upiOrders.id, order.id));

    await tx.insert(upiRiskEvents).values({
      orderId: order.id,
      notificationId,
      decision: 'approve',
      confidence: assessment.confidence,
      reasons: assessment.reasons,
      signals: assessment.signals,
    });

    /*
     * Entitlement. `settlePayment` is idempotent and grants the plan exactly
     * once; calling it here keeps UPI settlement on the same code path as every
     * other provider instead of inventing a second way to grant a plan.
     */
    if (order.paymentId) {
      const result = await settlePayment(order.paymentId, {
        gatewayStatus: 'succeeded',
        source: 'upi',
        providerPaymentId: notification.bankReference ?? undefined,
      });
      if (result.status === 'ignored') {
        throw new Error(`upi_settlement_failed:${result.reason ?? 'unknown'}`);
      }
    }

    return true;
  });
}

/** Approve a held notification manually. Admin action, fully audited. */
export async function manuallyApprove(
  env: Env,
  notificationId: string,
  orderId: string,
  actorId: string,
  note = '',
): Promise<{ ok: boolean; reason?: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(upiOrders).where(eq(upiOrders.id, orderId)).limit(1).for('update');
    const [notification] = await tx
      .select()
      .from(upiNotifications)
      .where(eq(upiNotifications.id, notificationId))
      .limit(1)
      .for('update');
    if (!order || !notification) return { ok: false, reason: 'not_found' };
    if (order.status === 'settled') return { ok: false, reason: 'already_settled' };

    /*
     * The credit must actually pay for this order. Without this check an admin
     * (or a mistaken click on a ₹1 test transfer) could apply a tiny credit to a
     * large order and grant the plan. A human resolving an ambiguous match is
     * deciding *which* order a credit belongs to, not deciding that a short
     * payment counts as a full one.
     */
    if (notification.amountPaise === null || notification.amountPaise !== order.amountPaise) {
      return {
        ok: false,
        reason: `amount_mismatch:expected=${order.amountPaise},credit=${notification.amountPaise ?? 'unknown'}`,
      };
    }

    /*
     * Only a notification still awaiting a decision may be approved. A credit
     * already marked `matched`, `rejected`, `ignored` or `duplicate` has been
     * decided, and re-approving it would be a second settlement attempt driven
     * by a stale dashboard page.
     */
    if (!['unmatched', 'received'].includes(notification.status)) {
      return { ok: false, reason: `notification_not_pending:${notification.status}` };
    }

    await tx.insert(upiMatches).values({
      orderId,
      notificationId,
      decision: 'manual_approved',
      reasons: [`manual:${note || 'approved_by_admin'}`, `actor:${actorId}`],
      confidence: 100,
      amountPaise: order.amountPaise,
    });

    await tx
      .update(upiOrders)
      .set({ status: 'settled', settledAt: new Date(), updatedAt: new Date() })
      .where(eq(upiOrders.id, orderId));
    await tx
      .update(upiNotifications)
      .set({ status: 'matched', decisionReason: `manual:${note || 'approved_by_admin'}`, confidence: 100 })
      .where(eq(upiNotifications.id, notificationId));

    if (order.paymentId) {
      const result = await settlePayment(order.paymentId, {
        gatewayStatus: 'succeeded',
        source: 'upi_manual',
        providerPaymentId: notification.bankReference ?? undefined,
      });
      /*
       * `ignored` means the payment row was not found. Throwing rolls the whole
       * transaction back so an order is never left `settled` without the plan it
       * claims to have bought.
       */
      if (result.status === 'ignored') {
        throw new Error(`upi_manual_settlement_failed:${result.reason ?? 'unknown'}`);
      }
    }
    return { ok: true };
  });
}

/* ------------------------------- refunds -------------------------------- */

export async function requestRefund(
  orderId: string,
  amountPaise: number,
  requestedBy: string,
  reason: string,
): Promise<{ id: string }> {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error('invalid_refund_amount');

  const db = getDb();
  /*
   * The total-check and the insert must share one transaction with a lock on the
   * order row. Reading the sum first and inserting afterwards let two concurrent
   * requests both observe "room left" and both insert, so N parallel calls could
   * refund a multiple of the order (measured: 20 x 10% approved against a single
   * 100% order). The lock serialises them, so the second call sees the first
   * refund already committed.
   */
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(upiOrders)
      .where(eq(upiOrders.id, orderId))
      .limit(1)
      .for('update');
    if (!order) throw new Error('order_not_found');
    if (!['settled', 'partially_refunded'].includes(order.status)) throw new Error('order_not_refundable');

    const existing = await tx
      .select({ total: sql<number>`coalesce(sum(${upiRefunds.amountPaise}), 0)::int` })
      .from(upiRefunds)
      .where(and(eq(upiRefunds.orderId, orderId), ne(upiRefunds.status, 'failed')));

    const refunded = existing[0]?.total ?? 0;
    if (refunded + amountPaise > order.amountPaise) throw new Error('refund_exceeds_order');

    const [refund] = await tx
      .insert(upiRefunds)
      .values({ orderId, amountPaise, requestedBy, reason })
      .returning({ id: upiRefunds.id });
    return { id: refund!.id };
  });
}

/**
 * Record that a refund was actually paid out.
 *
 * We cannot reverse a P2P UPI transfer, so an operator sends the money back and
 * records the UTR here. Until that happens the refund is only a request.
 */
export async function completeRefund(refundId: string, payoutReference: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [refund] = await tx.select().from(upiRefunds).where(eq(upiRefunds.id, refundId)).limit(1).for('update');
    if (!refund || refund.status === 'completed') return;

    await tx
      .update(upiRefunds)
      .set({ status: 'completed', payoutReference, processedAt: new Date(), updatedAt: new Date() })
      .where(eq(upiRefunds.id, refundId));

    const totals = await tx
      .select({ total: sql<number>`coalesce(sum(${upiRefunds.amountPaise}), 0)::int` })
      .from(upiRefunds)
      .where(and(eq(upiRefunds.orderId, refund.orderId), eq(upiRefunds.status, 'completed')));
    const refundedTotal = totals[0]?.total ?? 0;

    const [order] = await tx.select().from(upiOrders).where(eq(upiOrders.id, refund.orderId)).limit(1);
    if (!order) return;

    const fullyRefunded = refundedTotal >= order.amountPaise;
    await tx
      .update(upiOrders)
      .set({
        status: fullyRefunded ? 'refunded' : 'partially_refunded',
        updatedAt: new Date(),
      })
      .where(eq(upiOrders.id, order.id));
  });
}

/* ------------------------------ dashboards ------------------------------ */

export async function upiStats(): Promise<{
  pending: number;
  settled: number;
  expired: number;
  unmatched: number;
  review: number;
  settledPaise: number;
}> {
  const db = getDb();
  const orderRows = await db
    .select({ status: upiOrders.status, n: count(), total: sql<number>`coalesce(sum(${upiOrders.amountPaise}), 0)::int` })
    .from(upiOrders)
    .groupBy(upiOrders.status);

  const byStatus = new Map(orderRows.map((r) => [r.status, r]));
  const unmatched = await db
    .select({ n: count() })
    .from(upiNotifications)
    .where(eq(upiNotifications.status, 'unmatched'));

  return {
    pending: Number(byStatus.get('pending')?.n ?? 0),
    settled: Number(byStatus.get('settled')?.n ?? 0) + Number(byStatus.get('partially_refunded')?.n ?? 0),
    expired: Number(byStatus.get('expired')?.n ?? 0),
    unmatched: Number(unmatched[0]?.n ?? 0),
    review: Number(byStatus.get('under_review')?.n ?? 0),
    settledPaise: Number(byStatus.get('settled')?.total ?? 0),
  };
}

export async function listOrders(limit = 50, offset = 0) {
  const db = getDb();
  return db.select().from(upiOrders).orderBy(desc(upiOrders.createdAt)).limit(limit).offset(offset);
}

export async function listNotifications(limit = 50, offset = 0): Promise<UpiNotification[]> {
  const db = getDb();
  return db
    .select()
    .from(upiNotifications)
    .orderBy(desc(upiNotifications.receivedAt))
    .limit(limit)
    .offset(offset);
}

export async function getObserverState(id: string) {
  const db = getDb();
  const [row] = await db.select().from(upiObserverState).where(eq(upiObserverState.id, id)).limit(1);
  return row ?? null;
}

export async function recordObserverPoll(
  id: string,
  outcome: { ok: boolean; error?: string; cursor?: string | null },
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(upiObserverState)
    .values({
      id,
      lastPollAt: now,
      lastSuccessAt: outcome.ok ? now : null,
      lastError: outcome.error ?? null,
      consecutiveFailures: outcome.ok ? 0 : 1,
      cursor: outcome.cursor ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: upiObserverState.id,
      set: {
        lastPollAt: now,
        ...(outcome.ok ? { lastSuccessAt: now, consecutiveFailures: 0, lastError: null } : {}),
        ...(outcome.ok
          ? {}
          : {
              consecutiveFailures: sql`${upiObserverState.consecutiveFailures} + 1`,
              lastError: outcome.error ?? 'unknown_error',
            }),
        ...(outcome.cursor !== undefined ? { cursor: outcome.cursor } : {}),
        updatedAt: now,
      },
    });
}
