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
});

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
    });

    if (quote.totalMinor <= 0) throw badRequest('This plan has no amount due.');

    // Reuse an open order of the same amount so a refresh does not mint a second QR.
    const existing = await getActiveOrder(user.id);
    if (existing && existing.amountPaise === quote.totalMinor) {
      return { order: presentOrder(existing, env) };
    }
    if (existing) await cancelOrder(existing.id, 'replaced_by_new_order');

    const order = await createUpiOrder(env, {
      userId: user.id,
      paymentId: payment.id,
      amountPaise: quote.totalMinor,
      planId: input.planId,
      description: quote.plan?.name ?? input.planId,
    });

    return { order: presentOrder(order, env) };
  });

  app.get('/orders/active', async (request) => {
    const { user } = await requireAuth(request, env);
    const order = await getActiveOrder(user.id);
    return { order: order ? presentOrder(order, env) : null };
  });

  app.get('/orders/:id', async (request) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const order = await getOrderById(id);
    // Another user's order is reported as absent, so ids are not enumerable.
    if (!order || order.userId !== user.id) throw notFound('Order not found');
    return { order: presentOrder(order, env) };
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
 */
function presentOrder(order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>, env: Env) {
  const expired = order.status === 'pending' && order.expiresAt.getTime() < Date.now();
  return {
    id: order.id,
    reference: order.reference,
    status: expired ? 'expired' : order.status,
    amountPaise: order.amountPaise,
    amountLabel: formatPaise(order.amountPaise),
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
    expiresAt: order.expiresAt.toISOString(),
    settledAt: order.settledAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}
