/**
 * UPI checkout API (customer-facing).
 *
 *   GET  /upi/status        - is UPI collection available, and how
 *   POST /upi/orders        - start a checkout for a plan
 *   GET  /upi/orders/active - the order currently awaiting payment
 *   GET  /upi/orders/:id    - poll one order (the checkout page does this)
 *   POST /upi/orders/:id/cancel - abandon it
 *
 * The QR image and intent links are generated here, server-side, from the frozen
 * `upiUri` on the order. The browser never composes a payment URI itself, so a
 * tampered client cannot change the payee or the amount.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, notFound } from '../lib/errors.js';
import { createUpiPaymentOrder } from '../services/subscription.service.js';
import {
  cancelOrder,
  createUpiOrder,
  findPendingCredit,
  getActiveOrder,
  getOrderById,
} from '../services/upi/order.service.js';
import { renderQrSvg } from '../services/upi/qr.js';
import { UPI_APPS, buildUpiIntentUri, isValidVpa } from '../services/upi/uri.js';
import { formatPaise } from '../services/upi/money.js';

const createOrderSchema = z.object({
  planId: z.string().min(1),
  billingPeriod: z.enum(['monthly', 'yearly']).default('monthly'),
  couponCode: z.string().trim().max(64).optional(),
  /*
   * Exam-scoped plans need the exams they unlock. Without this the field was
   * stripped by the schema and every single-exam purchase failed validation
   * *after* a payment row had already been created.
   */
  examKeys: z.array(z.string().min(1)).max(10).optional(),
});

/**
 * How much of a held match the customer is told.
 *
 * A customer whose credit is waiting for a human reviewer needs to know it was
 * *seen* — otherwise the page looks identical to "nothing happened", they assume
 * the payment was lost, and pay again. That is the single worst outcome of the
 * review queue. So the order reports `processing`, and this summary explains it
 * without disclosing the bank reference, the reviewer's notes, or any risk
 * score: enough to stop a second payment, nothing that identifies the alert.
 */
export interface OrderReviewSummary {
  /** When we first observed a credit that appears to be for this order. */
  observedAt: string;
  /** The amount that credit was for, which equals the order amount. */
  amountPaise: number;
}

/**
 * The customer-visible state of an order.
 *
 * Deliberately a separate vocabulary from the database enum. The API contract is
 * what the checkout renders and what the browser polls, so it is named for what a
 * payer experiences:
 *
 *   pending     - QR is live, nothing has arrived
 *   processing  - a matching credit was seen and is being verified
 *   paid        - settled; access already granted
 *   expired     - window closed with nothing arrived
 *   cancelled   - the payer abandoned it
 *
 * `processing` folds the database's `under_review` together with any inbound
 * notification we have received for this order, which is what lets the checkout
 * say "we have your payment, it is being verified" instead of showing a spinner
 * that looks broken.
 */
export type OrderViewStatus = 'pending' | 'processing' | 'paid' | 'expired' | 'cancelled';

const BASE_STATUS_VIEW: Record<string, OrderViewStatus> = {
  pending: 'pending',
  under_review: 'processing',
  settled: 'paid',
  expired: 'expired',
  cancelled: 'cancelled',
  refunded: 'paid',
  partially_refunded: 'paid',
};

/** Map a stored order status to the customer-visible status. */
export function orderViewStatus(status: string): OrderViewStatus {
  return BASE_STATUS_VIEW[status] ?? 'pending';
}

/** Is UPI collection configured well enough to offer it? */
export function upiAvailable(env: Env): boolean {
  return Boolean(env.PAYMENTS_ENABLED && env.UPI_PAYEE_VPA && isValidVpa(env.UPI_PAYEE_VPA));
}

export async function upiRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/status', async () => ({
    available: upiAvailable(env),
    autoApprove: env.UPI_AUTO_APPROVE,
    payeeName: env.UPI_PAYEE_NAME,
    orderTtlMinutes: env.UPI_ORDER_TTL_MINUTES,
    /*
     * Stated explicitly so the UI can say it in plain words: a notification is
     * how we learn about the transfer, not proof from the bank that it settled.
     */
    verification: 'notification_based',
  }));

  app.post('/orders', async (request) => {
    // Authenticate before revealing whether the feature is configured, so an
    // anonymous caller cannot probe the deployment's payment state.
    const { user } = await requireAuth(request, env);
    if (!upiAvailable(env)) throw badRequest('UPI payment is not available right now.');
    const input = parseOrThrow(createOrderSchema, request.body);

    // Price is recomputed here from plan + coupon; the browser's number is never used.
    const { payment, quote } = await createUpiPaymentOrder(env, user, {
      planId: input.planId,
      billingPeriod: input.billingPeriod,
      couponCode: input.couponCode,
      examKeys: input.examKeys,
    });

    if (quote.totalMinor <= 0) throw badRequest('This plan has no amount due.');

    // Reuse an open order for the same *base* price so a refresh does not mint a
    // second QR. Comparing the payable amount would never match: it carries the
    // uniqueness suffix. The existing order's amount (suffix included) is what the
    // customer is already looking at, so it is returned unchanged.
    const existing = await getActiveOrder(user.id);
    if (existing && existing.baseAmountPaise === quote.totalMinor) {
      return { order: await presentOrder(existing, env) };
    }
    if (existing) await cancelOrder(existing.id, 'replaced_by_new_order');

    const order = await createUpiOrder(env, {
      userId: user.id,
      paymentId: payment.id,
      amountPaise: quote.totalMinor,
      planId: input.planId,
      description: quote.plan?.name ?? input.planId,
    });

    return { order: await presentOrder(order, env) };
  });

  app.get('/orders/active', async (request) => {
    const { user } = await requireAuth(request, env);
    const order = await getActiveOrder(user.id);
    return { order: order ? await presentOrder(order, env) : null };
  });

  app.get('/orders/:id', async (request) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const order = await getOrderById(id);
    // Another user's order is reported as absent, so ids are not enumerable.
    if (!order || order.userId !== user.id) throw notFound('Order not found');
    return { order: await presentOrder(order, env) };
  });

  app.post('/orders/:id/cancel', async (request) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const order = await getOrderById(id);
    if (!order || order.userId !== user.id) throw notFound('Order not found');
    await cancelOrder(order.id, 'cancelled_by_user');
    return { ok: true };
  });
}

/**
 * Shape an order for the client.
 *
 * The QR is rendered per response rather than stored, so a design change does
 * not require a migration, and all payment parameters come from the stored URI.
 *
 * `status` is the customer-visible status (see `OrderViewStatus`), not the raw
 * database enum, and it can report `processing` in two situations:
 *
 *  - the order is `under_review`, i.e. a credit was matched and is waiting for a
 *    human when `UPI_AUTO_APPROVE` is off; or
 *  - a notification for this order's exact amount has been ingested and has not
 *    yet been decided, which is the gap between "bank alert arrived" and "match
 *    written" during settlement.
 *
 * Reporting it matters for automation: without a `processing` state the page
 * looks untouched while a real payment is being verified, and the payer sends the
 * money a second time.
 */
async function presentOrder(
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>,
  env: Env,
) {
  const expired = order.status === 'pending' && order.expiresAt.getTime() < Date.now();
  const viewStatus: OrderViewStatus = expired ? 'expired' : orderViewStatus(order.status);

  /*
   * Only looked up while the order is still open. Once it is settled or closed
   * the review summary is noise, and this keeps the settled path to one query.
   */
  const review =
    viewStatus === 'pending' || viewStatus === 'processing' ? await findPendingCredit(order) : null;

  return {
    id: order.id,
    reference: order.reference,
    status: review && viewStatus === 'pending' ? ('processing' as OrderViewStatus) : viewStatus,
    amountPaise: order.amountPaise,
    amountLabel: formatPaise(order.amountPaise),
    /*
     * The price the customer was quoted, and the paise added to it so concurrent
     * checkouts do not share one payable amount. Shown separately so the total on
     * screen never looks like a pricing error.
     */
    baseAmountPaise: order.baseAmountPaise,
    baseAmountLabel: formatPaise(order.baseAmountPaise),
    suffixPaise: order.amountPaise - order.baseAmountPaise,
    payeeVpa: order.payeeVpa,
    payeeName: order.payeeName,
    description: order.description,
    upiUri: order.upiUri,
    qrSvg: renderQrSvg(order.upiUri, { size: 288, margin: 4 }),
    intents: UPI_APPS.flatMap((appDef) => {
      try {
        return [
          {
            id: appDef.id,
            label: appDef.label,
            href: buildUpiIntentUri({
              payeeVpa: order.payeeVpa,
              payeeName: order.payeeName,
              amountPaise: order.amountPaise,
              transactionRef: order.reference,
              packageName: appDef.packageName,
            }),
          },
        ];
      } catch {
        // A malformed intent simply is not offered; the QR still works.
        return [];
      }
    }),
    /*
     * Present only when a credit for this order is being verified, so the UI can
     * say "we have your payment" instead of showing an unchanged QR.
     */
    review,
    /*
     * How to describe confirmation honestly. The checkout renders different copy
     * for a human-reviewed match and an automatic one, because they are not the
     * same guarantee and the payer is entitled to know which they got.
     */
    verification: env.UPI_AUTO_APPROVE ? 'automatic_match' : 'reviewed_match',
    expiresAt: order.expiresAt.toISOString(),
    settledAt: order.settledAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}
