/**
 * Admin UPI operations API (mounted under /admin-ops).
 *
 *   GET  /upi/overview          - counters, observer health, unmapped credits
 *   GET  /upi/orders            - recent orders
 *   GET  /upi/notifications     - every ingested alert, including rejects
 *   POST /upi/notifications/:id/match  - resolve an unmatched credit by hand
 *   POST /upi/orders/:id/refund        - request a refund
 *   POST /upi/refunds/:id/complete     - record the payout UTR
 *   GET  /upi/observer          - observer status detail
 *   POST /upi/observer/poll     - force one poll now
 *
 * Every mutating route is audited. Read routes expose no credentials: the Gmail
 * refresh token and client secret never leave the server.
 *
 * Authorization is per route rather than a blanket admin check:
 *   payments.read    - overview, order/notification/refund listings, order detail
 *   payments.manage  - manual match, observer poll
 *   payments.refund  - refund request and completion
 * A role that may review payments therefore cannot move money.
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { requirePermission } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { upiMatches, upiNotifications, upiRefunds } from '../db/schema/index.js';
import { recordAudit } from '../services/audit.service.js';
import {
  completeRefund,
  getOrderById,
  listNotifications,
  listOrders,
  manuallyApprove,
  requestRefund,
  upiStats,
} from '../services/upi/order.service.js';
import { pollGmailOnce } from '../services/upi/gmail-observer.js';
import {
  isGmailObserverConfigured,
  resolveUpiConfig,
} from '../services/upi/config.service.js';


const matchSchema = z.object({
  orderId: z.string().uuid(),
  note: z.string().max(280).optional(),
});

const refundSchema = z.object({
  amountPaise: z.number().int().positive(),
  reason: z.string().max(280).default(''),
});

const completeRefundSchema = z.object({
  payoutReference: z.string().min(4).max(64),
});

export async function adminUpiRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/upi/overview', async (request) => {
    await requirePermission(request, env, 'payments.read');
    const config = await resolveUpiConfig(env);
    const stats = await upiStats();
    const db = getDb();
    const [observerRow] = await db
      .select()
      .from(upiNotifications)
      .where(eq(upiNotifications.status, 'unmatched'))
      .orderBy(desc(upiNotifications.receivedAt))
      .limit(1);

    return {
      ...stats,
      observerConfigured: isGmailObserverConfigured(config),
      autoApprove: config.autoApprove,
      payeeVpa: config.payeeVpa,
      paymentsEnabled: config.paymentsEnabled,
      gmailEnabled: config.gmailEnabled,
      gmailConnectedEmail: config.gmailConnectedEmail,
      gmailConnectedAt: config.gmailConnectedAt?.toISOString() ?? null,
      gmailLastVerifiedAt: config.gmailLastVerifiedAt?.toISOString() ?? null,
      /* When each setting comes from the dashboard versus the environment, so a
       * surprising value is explainable instead of mysterious. */
      configSource: config.source,
      /*
       * Surfaced in the dashboard so nobody has to remember it: approvals come
       * from bank alerts, not from the bank's settlement records.
       */
      verification: 'notification_based',
      verificationWarning:
        'Approvals are inferred from bank SMS/email alerts. A notification is evidence that a bank sent a message, not proof that funds settled. Reconcile against your bank statement.',
      lastUnmatchedAt: observerRow?.receivedAt?.toISOString() ?? null,
    };
  });

  app.get('/upi/orders', async (request) => {
    await requirePermission(request, env, 'payments.read');
    const { limit } = request.query as { limit?: string };
    const rows = await listOrders(Math.min(Number(limit ?? 50) || 50, 200));
    return { orders: rows };
  });

  app.get('/upi/notifications', async (request) => {
    await requirePermission(request, env, 'payments.read');
    const { limit } = request.query as { limit?: string };
    const rows = await listNotifications(Math.min(Number(limit ?? 50) || 50, 200));
    return {
      notifications: rows.map((n) => ({
        id: n.id,
        source: n.source,
        status: n.status,
        amountPaise: n.amountPaise,
        bankReference: n.bankReference,
        senderVpa: n.senderVpa,
        observedAt: n.observedAt?.toISOString() ?? null,
        receivedAt: n.receivedAt.toISOString(),
        decisionReason: n.decisionReason,
        confidence: n.confidence,
        // Truncated: enough to investigate, not a full mailbox dump.
        preview: n.rawText.slice(0, 240),
      })),
    };
  });

  app.post('/upi/notifications/:id/match', async (request) => {
    const auth = await requirePermission(request, env, 'payments.manage');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(matchSchema, request.body);

    const result = await manuallyApprove(env, id, input.orderId, auth.user.id, input.note ?? '');
    if (!result.ok) throw badRequest(`Unable to approve: ${result.reason ?? 'unknown'}`);

    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'upi.notification_manually_matched',
      targetType: 'upi_notification',
      targetId: id,
      metadata: { orderId: input.orderId, note: input.note ?? '' },
    });
    return { ok: true };
  });

  app.post('/upi/orders/:id/refund', async (request) => {
    const auth = await requirePermission(request, env, 'payments.refund');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(refundSchema, request.body);

    const order = await getOrderById(id);
    if (!order) throw notFound('Order not found');

    const refund = await requestRefund(id, input.amountPaise, auth.user.id, input.reason);
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'upi.refund_requested',
      targetType: 'upi_order',
      targetId: id,
      metadata: { refundId: refund.id, amountPaise: input.amountPaise, reason: input.reason },
    });
    return { refundId: refund.id };
  });

  app.post('/upi/refunds/:id/complete', async (request) => {
    const auth = await requirePermission(request, env, 'payments.refund');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(completeRefundSchema, request.body);

    await completeRefund(id, input.payoutReference);
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'upi.refund_completed',
      targetType: 'upi_refund',
      targetId: id,
      metadata: { payoutReference: input.payoutReference },
    });
    return { ok: true };
  });

  app.get('/upi/refunds', async (request) => {
    await requirePermission(request, env, 'payments.read');
    const db = getDb();
    const rows = await db.select().from(upiRefunds).orderBy(desc(upiRefunds.createdAt)).limit(100);
    return { refunds: rows };
  });

  /** Force an immediate poll. Useful after wiring credentials, or on suspicion. */
  app.post('/upi/observer/poll', async (request) => {
    const auth = await requirePermission(request, env, 'payments.manage');
    const result = await pollGmailOnce(env);
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'upi.observer_manual_poll',
      targetType: 'upi_observer',
      targetId: 'gmail',
      metadata: { scanned: result.scanned, matched: result.matched },
    });
    return result;
  });

  /** Resolve a single order, for the detail drawer. */
  app.get('/upi/orders/:id', async (request) => {
    await requirePermission(request, env, 'payments.read');
    const { id } = request.params as { id: string };
    const order = await getOrderById(id);
    if (!order) throw notFound('Order not found');
    const db = getDb();
    /*
     * Join through `upi_matches` so this returns the notifications that actually
     * settled *this* order. Filtering only on `status = 'matched'` returned the
     * five most recent matched notifications in the whole system, so opening one
     * order's detail pane displayed unrelated customers' bank references and
     * truncated message text.
     */
    const notifications = await db
      .select({
        id: upiNotifications.id,
        source: upiNotifications.source,
        status: upiNotifications.status,
        amountPaise: upiNotifications.amountPaise,
        bankReference: upiNotifications.bankReference,
        senderVpa: upiNotifications.senderVpa,
        observedAt: upiNotifications.observedAt,
        receivedAt: upiNotifications.receivedAt,
        confidence: upiNotifications.confidence,
        decision: upiMatches.decision,
      })
      .from(upiMatches)
      .innerJoin(upiNotifications, eq(upiNotifications.id, upiMatches.notificationId))
      .where(eq(upiMatches.orderId, id))
      .orderBy(desc(upiNotifications.receivedAt))
      .limit(10);
    return { order, recentMatches: notifications };
  });
}
