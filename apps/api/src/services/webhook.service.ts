/**
 * Webhook intake + processing + gateway reconciliation.
 *
 * Every delivery is persisted first (raw payload + signature outcome), so the
 * platform can be audited and replayed. Processing is idempotent: `settlePayment`
 * locks the payment row and refuses to grant twice.
 */
import crypto from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { getDb } from '../db/client.js';
import { payments, reconciliationRuns, subscriptions, webhookEvents } from '../db/schema/index.js';
import {
  getPayment,
  listPayments,
  PAID_STATUSES,
  FAILED_STATUSES,
  verifyWebhookSignature,
} from './hyperswitch.client.js';
import { issueInvoice, recomputeUserPlan, settlePayment } from './subscription.service.js';
import { recordAudit } from './audit.service.js';

export interface RecordWebhookInput {
  provider: string;
  rawBody: string | Buffer;
  signature?: string;
  payload: Record<string, unknown>;
  ip?: string;
}

export interface RecordWebhookResult {
  id: string;
  eventId: string;
  signatureValid: boolean;
  duplicate: boolean;
}

export async function recordWebhookEvent(env: Env, input: RecordWebhookInput): Promise<RecordWebhookResult> {
  const db = getDb();
  const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
  const payloadHash = crypto.createHash('sha256').update(raw).digest('hex');

  const payload = input.payload as {
    event_id?: string;
    event_type?: string;
    content?: { object?: { payment_id?: string; refund_id?: string } };
  };
  const eventId =
    payload.event_id ??
    `${payload.event_type ?? 'unknown'}:${payload.content?.object?.payment_id ?? payloadHash.slice(0, 12)}`;
  const eventType = payload.event_type ?? 'unknown';

  const webhooksEnabled =
    env.PAYMENT_PROVIDER === 'hyperswitch' && Boolean(env.HYPERSWITCH_WEBHOOK_SECRET);
  const signatureValid =
    webhooksEnabled &&
    verifyWebhookSignature(raw, input.signature, env.HYPERSWITCH_WEBHOOK_SECRET as string);

  const [inserted] = await db
    .insert(webhookEvents)
    .values({
      provider: input.provider,
      eventId,
      eventType,
      signatureValid,
      payloadHash,
      payload: input.payload,
      status: signatureValid ? 'received' : 'rejected',
      note: signatureValid ? '' : 'invalid_or_missing_signature',
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    const [existing] = await db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.provider, input.provider), eq(webhookEvents.eventId, eventId)))
      .limit(1);
    return { id: existing?.id ?? '', eventId, signatureValid, duplicate: true };
  }

  await recordAudit({
    actorId: null,
    action: signatureValid ? 'payment.webhook_received' : 'payment.webhook_rejected',
    targetType: 'webhook_event',
    targetId: inserted.id,
    metadata: { eventType, ip: input.ip ?? null },
  });

  return { id: inserted.id, eventId, signatureValid, duplicate: false };
}

interface WebhookPayload {
  event_type?: string;
  content?: {
    type?: string;
    object?: {
      payment_id?: string;
      refund_id?: string;
      refund_status?: string;
      status?: string;
      merchant_order_reference_id?: string | null;
      error_message?: string | null;
      attempts?: Array<{ attempt_id?: string; status?: string }>;
      amount?: number;
      metadata?: Record<string, unknown> | null;
    };
  };
}

/** Process a stored webhook event. Safe to call repeatedly. */
export async function processWebhookEvent(
  env: Env,
  webhookRowId: string,
  rawPayload: Record<string, unknown>,
): Promise<{ status: string; paymentId?: string }> {
  const db = getDb();
  const payload = rawPayload as WebhookPayload;
  const eventType = (payload.event_type ?? '').toLowerCase();
  const object = payload.content?.object ?? {};
  const providerPaymentId = object.payment_id;
  const orderRef = object.merchant_order_reference_id ?? null;

  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookRowId)).limit(1);
  if (!row) return { status: 'unknown_event' };

  // Resolve our payment row from the gateway payment id, falling back to the
  // order reference we sent at creation time.
  let payment = providerPaymentId
    ? (
        await db.select().from(payments).where(eq(payments.providerPaymentId, providerPaymentId)).limit(1)
      )[0]
    : undefined;
  if (!payment && orderRef) {
    payment = (await db.select().from(payments).where(eq(payments.orderRef, orderRef)).limit(1))[0];
  }

  if (!payment) {
    await markEvent(webhookRowId, 'ignored', 'no_matching_payment');
    return { status: 'ignored' };
  }

  if (eventType.startsWith('refund')) {
    // Refunds are initiated by us; the gateway confirmation only updates bookkeeping.
    await markEvent(webhookRowId, 'processed', `refund:${object.refund_status ?? object.status ?? 'unknown'}`);
    return { status: 'refund_noted', paymentId: payment.id };
  }

  /**
   * Confirm the authoritative status server-to-server. Webhook bodies are
   * signed, but we still re-read the payment from HyperSwitch before granting
   * access - this defends against replayed/forged-but-signed stale events and
   * against event ordering problems.
   */
  let gatewayStatus = (object.status ?? '').toLowerCase();
  let attemptId = object.attempts?.[0]?.attempt_id ?? null;
  let failureReason = object.error_message ?? null;

  try {
    if (providerPaymentId) {
      const fresh = await getPayment(env, providerPaymentId);
      gatewayStatus = (fresh.status ?? gatewayStatus).toLowerCase();
      attemptId = fresh.attempts?.[0]?.attempt_id ?? attemptId;
      failureReason = fresh.error_message ?? failureReason;
    }
  } catch {
    // If the sync call fails we still honour the signed event status.
  }

  const settleStatus = PAID_STATUSES.has(gatewayStatus)
    ? 'succeeded'
    : FAILED_STATUSES.has(gatewayStatus)
      ? 'failed'
      : gatewayStatus;

  const result = await settlePayment(payment.id, {
    gatewayStatus: settleStatus,
    providerPaymentId: providerPaymentId ?? undefined,
    providerAttemptId: attemptId,
    failureReason,
    source: 'webhook',
  });

  if (result.status === 'succeeded') {
    await issueInvoice(payment.id);
  }

  await markEvent(webhookRowId, 'processed', result.status);
  return { status: result.status, paymentId: payment.id };
}

async function markEvent(id: string, status: string, note: string): Promise<void> {
  await getDb()
    .update(webhookEvents)
    .set({ status, note, processedAt: new Date() })
    .where(eq(webhookEvents.id, id));
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

export interface ReconcileResult {
  runId: string;
  checked: number;
  repaired: number;
  mismatches: number;
  details: Array<{ paymentId: string; local: string; gateway: string; action: string }>;
}

/**
 * Compare locally pending payments against the gateway and repair drift:
 *  - gateway says paid            -> settle (grants access + invoice)
 *  - gateway says failed/expired  -> mark failed
 *  - expired or capturable-but-not-captured -> capture
 */
export async function reconcilePayments(env: Env, trigger: string): Promise<ReconcileResult> {
  const db = getDb();
  const [run] = await db
    .insert(reconciliationRuns)
    .values({ provider: 'hyperswitch', triggeredBy: trigger })
    .returning();
  const runId = run?.id ?? '';

  const stale = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, 'hyperswitch'), inArray(payments.status, ['pending'])))
    .orderBy(desc(payments.createdAt))
    .limit(200);

  const details: ReconcileResult['details'] = [];
  let repaired = 0;
  let mismatches = 0;

  for (const payment of stale) {
    if (!payment.providerPaymentId) continue;
    try {
      const gateway = await getPayment(env, payment.providerPaymentId);
      const gatewayStatus = (gateway.status ?? '').toLowerCase();
      const localStatus = payment.status;

      if (PAID_STATUSES.has(gatewayStatus)) {
        const result = await settlePayment(payment.id, {
          gatewayStatus: 'succeeded',
          providerPaymentId: payment.providerPaymentId,
          providerAttemptId: gateway.attempts?.[0]?.attempt_id ?? null,
          source: 'reconcile',
        });
        if (result.status === 'succeeded') {
          await issueInvoice(payment.id);
          repaired += 1;
        }
        details.push({ paymentId: payment.id, local: localStatus, gateway: gatewayStatus, action: 'settled' });
      } else if (FAILED_STATUSES.has(gatewayStatus)) {
        await settlePayment(payment.id, {
          gatewayStatus: 'failed',
          providerPaymentId: payment.providerPaymentId,
          failureReason: gateway.error_message ?? gatewayStatus,
          source: 'reconcile',
        });
        repaired += 1;
        details.push({ paymentId: payment.id, local: localStatus, gateway: gatewayStatus, action: 'marked_failed' });
      } else {
        mismatches += 1;
        details.push({ paymentId: payment.id, local: localStatus, gateway: gatewayStatus, action: 'pending' });
      }
    } catch (err) {
      mismatches += 1;
      details.push({
        paymentId: payment.id,
        local: payment.status,
        gateway: 'error',
        action: (err as Error).message.slice(0, 120),
      });
    }
  }

  // Also repair gateway-side payments we never recorded (e.g. crash between
  // gateway creation and DB insert).
  try {
    const remote = await listPayments(env, { limit: 50 });
    for (const rp of remote.data) {
      const known = await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.providerPaymentId, rp.payment_id))
        .limit(1);
      if (known.length === 0 && PAID_STATUSES.has(String(rp.status).toLowerCase())) {
        details.push({
          paymentId: rp.payment_id,
          local: 'missing',
          gateway: String(rp.status),
          action: 'unknown_payment_needs_manual_review',
        });
        mismatches += 1;
      }
    }
  } catch {
    /* listing may be unsupported on some deployments; pending sweep still ran */
  }

  await db
    .update(reconciliationRuns)
    .set({
      finishedAt: new Date(),
      checked: stale.length,
      repaired,
      mismatches,
      details: { items: details },
    })
    .where(eq(reconciliationRuns.id, runId));

  await recordAudit({
    actorId: null,
    action: 'reconciliation.run',
    targetType: 'reconciliation',
    targetId: runId,
    metadata: { checked: stale.length, repaired, mismatches, trigger },
  });

  return { runId, checked: stale.length, repaired, mismatches, details };
}

/** Expire subscriptions and downgrade users; also heals the denormalised plan. */
export async function healSubscriptionState(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
        isNull(subscriptions.canceledAt),
        sql`${subscriptions.currentPeriodEnd} < now()`,
      ),
    );
  for (const row of [...new Set(rows.map((r) => r.userId))]) {
    await recomputeUserPlan(row);
  }
  return rows.length;
}
