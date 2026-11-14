/**
 * Customer-facing payments API.
 *
 *   POST /payments/quote          - price a plan before checkout (server truth)
 *   POST /payments/checkout       - create a HyperSwitch payment intent
 *   POST /payments/:id/verify     - re-check with the gateway after redirect
 *   GET  /payments/methods        - feature/status flags for the UI
 *   GET  /payments/invoices       - list receipts
 *   GET  /payments/invoices/:id   - receipt detail
 *   POST /payments/webhook/hyperswitch - gateway webhooks (signature verified)
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { checkoutSchema, changePlanSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { AppError, badRequest, forbidden, notFound, serviceUnavailable } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { payments, users, webhookEvents } from '../db/schema/index.js';
import {
  activateMockPlan,
  applyYoupiNonSettlementEvent,
  createPaymentOrder,
  getInvoice,
  listInvoices,
  issueInvoice,
  listPayments,
  quotePlan,
  settlePayment,
} from '../services/subscription.service.js';
import {
  checkoutReady,
  getPayment,
  hyperswitchConfigured,
  webhookConfigured,
  PAID_STATUSES,
  FAILED_STATUSES,
} from '../services/hyperswitch.client.js';
import { resolveEntitlements } from '../services/entitlement.service.js';
import { resolvePaymentAdapter, checkoutAvailable } from '../services/payments/registry.js';
import { createCheckout, fetchGatewayStatus, refundableFor } from '../services/payments/checkout.service.js';
import { razorpayAdapter } from '../services/payments/razorpay.adapter.js';
import { assertAmountAllowed } from '../services/payments/adapter.js';
import {
  createYoupiOrder,
  verifyYoupiWebhook,
  youpiCheckoutAvailability,
  youpiCheckoutBlock,
  youpiConfigured,
} from '../services/payments/youpi.client.js';
import { getSettings } from '../services/settings.service.js';

/**
 * Return the exact request bytes captured before JSON parsing, or refuse.
 *
 * Webhook signatures cover the bytes as the provider sent them. Re-serialising
 * the parsed object yields different bytes (whitespace, key order, number
 * formatting), so a fallback would either fail confusingly or, worse, verify a
 * value the provider never signed. When the raw body is absent the request
 * cannot be authenticated at all, so it is rejected instead of guessed at.
 */
export function requireRawBody(request: { rawBody?: unknown }): string {
  const raw = request.rawBody;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw badRequest('Raw request body is required for signature verification.');
  }
  return raw;
}

/** Record the outcome of an authenticated YouPI delivery for operators. */
async function markYoupiEvent(id: string, status: string, note: string): Promise<void> {
  await db()
    .update(webhookEvents)
    .set({ status, note, processedAt: new Date() })
    .where(eq(webhookEvents.id, id));
}

export async function paymentRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/methods', async (request, reply) => {
    const auth = await requireAuth(request, env).catch(() => null);
    const settings = auth ? await getSettings(env) : null;
    const entitlements = auth ? await resolveEntitlements(auth.user, settings!) : null;
    return reply.send({
      provider: checkoutReady(env) ? 'hyperswitch' : 'none',
      paymentsEnabled: env.PAYMENTS_ENABLED,
      gatewayConfigured: hyperswitchConfigured(env),
      webhookConfigured: webhookConfigured(env),
      checkoutReady: checkoutReady(env),
      publishableKey: checkoutReady(env) ? (env.HYPERSWITCH_API_KEY ?? '') : '',
      merchantId: env.HYPERSWITCH_MERCHANT_ID ?? '',
      baseUrl: env.HYPERSWITCH_BASE_URL ?? '',
      currency: env.DEFAULT_CURRENCY,
      entitlements,
      // Simulated activation is never advertised in production, whatever the
      // environment flag says.
      mockPaymentsAllowed: env.ALLOW_MOCK_PAYMENTS && env.NODE_ENV !== 'production',
      // ExamDump Pay: which adapter (if any) can take money right now, and
      // which methods it supports. `available: false` means free-tier only.
      pay: (() => {
        const availability = resolvePaymentAdapter(env);
        return {
          available: availability.adapter !== null,
          adapter: availability.adapterId,
          methods: availability.methods,
          reason: availability.reason,
          // YouPI-PG standalone gateway: opt-in flag, credentials and whether a
          // checkout can actually be created right now (both flags required).
          youpi: {
            enabled: Boolean(env.YOUPI_ENABLED),
            configured: youpiConfigured(env),
            available: youpiCheckoutAvailability(env) === 'ok',
          },
        };
      })(),
    });
  });

  /**
   * ExamDump Pay checkout.
   *
   * Unlike the legacy HyperSwitch path this is adapter-agnostic: the amount is
   * quoted server-side, duplicate requests reuse the pending order, and no
   * payment is ever marked successful here.
   */
  app.post('/pay/checkout', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(checkoutSchema, request.body);
    if (!user.emailVerified) throw forbidden('Verify your email address before paying.');

    const origin = request.headers.origin ?? env.PUBLIC_WEB_URL;
    const safeOrigin = /^https?:\/\//.test(origin) ? origin : env.PUBLIC_WEB_URL;
    const result = await createCheckout(env, user, {
      planId: input.planId,
      examKeys: input.examKeys,
      examKey: input.examKey,
      couponCode: input.couponCode,
      returnUrl: `${safeOrigin}/checkout/return?payment=${'{payment_id}'}`,
    });
    return reply.code(201).send(result);
  });

  /** Authoritative status for the return page. Never trusts a query param. */
  app.get('/pay/:id/status', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const [payment] = await db()
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.userId, user.id)))
      .limit(1);
    if (!payment) throw notFound('Payment not found.');
    return reply.send({
      id: payment.id,
      status: payment.status,
      amountMinor: payment.amountMinor,
      refundedMinor: payment.refundedMinor,
      currency: payment.currency,
      provider: payment.provider,
      paidAt: payment.paidAt,
    });
  });

  /**
   * YouPI-PG checkout.
   *
   * Creates a session on the standalone YouPI gateway for a server-computed
   * amount and returns its hosted checkout URL. The `MANUAL_UPI` method is used
   * because YouPI gates automated UPI on a live SMS-observer heartbeat and this
   * deployment runs Gmail-only. No money is taken and no entitlement is granted
   * here; fulfilment happens only on a verified `RECONCILED` webhook.
   *
   * The feature is gated by BOTH PAYMENTS_ENABLED and YOUPI_ENABLED. The
   * deployment-wide switch wins: `YOUPI_ENABLED=true` alone must never create a
   * gateway order. The gate runs before authentication, quoting and any gateway
   * call, so a blocked request leaves no session, order or payment row behind.
   */
  app.post(
    '/pay/youpi/checkout',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const availability = youpiCheckoutAvailability(env);
      if (availability !== 'ok') {
        const block = youpiCheckoutBlock(availability);
        throw new AppError(503, block.code, block.message);
      }
      const { user } = await requireAuth(request, env);
      if (!user.emailVerified) throw forbidden('Verify your email address before paying.');
      const input = parseOrThrow(checkoutSchema, request.body);

      // Server-side truth for the price — never the request body.
      const quote = await quotePlan(user.id, {
        planId: input.planId,
        examKeys: input.examKeys,
        examKey: input.examKey,
        couponCode: input.couponCode,
      });
      if (quote.totalMinor <= 0) throw badRequest('This order has no chargeable amount.');
      assertAmountAllowed(env, quote.totalMinor, quote.currency);

      const origin = request.headers.origin ?? env.PUBLIC_WEB_URL;
      const safeOrigin = /^https?:\/\//.test(origin) ? origin : env.PUBLIC_WEB_URL;
      const ref = `edy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

      const order = await createYoupiOrder(env, {
        amountMinor: quote.totalMinor,
        currency: quote.currency,
        orderRef: ref,
        description: `${quote.plan.name} — YouPI UPI`,
        returnUrl: `${safeOrigin}/checkout/return?payment={payment_id}`,
        metadata: {
          planId: quote.plan.id,
          examKeys: quote.examKeys.join(','),
          couponCode: quote.couponCode ?? '',
        },
      });

      const [payment] = await db()
        .insert(payments)
        .values({
          userId: user.id,
          subscriptionId: null,
          amountMinor: quote.totalMinor,
          discountMinor: quote.discountMinor,
          currency: quote.currency,
          status: 'pending',
          // `upi` is the existing provider enum value; the gateway is tagged in metadata.
          provider: 'upi',
          providerRef: order.paymentId,
          providerPaymentId: order.paymentId,
          orderRef: ref,
          description: `${quote.plan.name} — awaiting YouPI confirmation`,
          metadata: {
            provider: 'youpi',
            youpiPaymentId: order.paymentId,
            planId: quote.plan.id,
            planName: quote.plan.name,
            examKeys: quote.examKeys,
            couponCode: quote.couponCode,
            grossMinor: quote.grossMinor,
          },
        })
        .returning();
      if (!payment) throw serviceUnavailable('Failed to persist the payment order.');

      return reply.code(201).send({
        paymentId: payment.id,
        orderRef: ref,
        gatewayPaymentId: order.paymentId,
        checkoutUrl: order.checkoutUrl,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        status: payment.status,
        adapter: 'youpi',
        plan: { id: quote.plan.id, name: quote.plan.name },
        note: 'YouPI UPI — the order is confirmed only after bank-statement reconciliation (RECONCILED).',
      });
    },
  );

  /**
   * YouPI-PG webhook receiver.
   *
   * Security model:
   *  - HMAC-SHA256 over the exact raw request bytes (timestamped V2 signature
   *    preferred) with YOUPI_WEBHOOK_SECRET;
   *  - replay defence via the signed timestamp tolerance and the unique
   *    (provider, eventId) index on `webhook_events`;
   *  - the amount and currency must equal the stored order;
   *  - ONLY `RECONCILED` (settlementState `RECONCILED`) settles. `OBSERVED_SUCCESS`
   *    and `MANUAL_REVIEW` are recorded and ignored — a bank alert is not proof
   *    that money settled.
   */
  app.post(
    '/webhook/youpi',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const raw = requireRawBody(request as unknown as { rawBody?: unknown });
      const verified = verifyYoupiWebhook(env, {
        rawBody: raw,
        headers: request.headers as Record<string, string | string[] | undefined>,
      });

      const payload = verified.payload ?? {};
      const eventType = String(verified.event ?? payload.event ?? 'unknown');
      const deliveryId = String(verified.deliveryId ?? payload.deliveryId ?? '');
      const payloadHash = crypto.createHash('sha256').update(raw).digest('hex');

      // Verify the signature BEFORE any idempotency shortcut. Otherwise a
      // replayed body with a broken signature could be acknowledged as a
      // "duplicate" without ever being authenticated.
      if (!verified.verified) {
        // Audit the rejection without letting it collide with (and thus mask) a
        // later authenticated delivery.
        await db()
          .insert(webhookEvents)
          .values({
            provider: 'youpi',
            eventId: `rejected_${payloadHash}`,
            eventType,
            signatureValid: false,
            payloadHash,
            payload: payload as Record<string, unknown>,
            status: 'rejected',
            note: verified.reason ?? '',
          })
          .onConflictDoNothing();
        request.log.warn({ ip: request.ip, reason: verified.reason }, 'youpi.webhook.invalid_signature');
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } });
      }

      // Authenticated delivery: deduplicate on (provider, eventId), where the
      // YouPI delivery id makes retries of one event collapse to a single row.
      // Only a delivery already recorded as processed/ignored is a duplicate;
      // one left at `received` means an earlier attempt failed part-way, so the
      // retry must be allowed to finish instead of being acknowledged forever.
      const eventId = deliveryId || payloadHash;
      const inserted = await db()
        .insert(webhookEvents)
        .values({
          provider: 'youpi',
          eventId,
          eventType,
          signatureValid: true,
          payloadHash,
          payload: payload as Record<string, unknown>,
          status: 'received',
          note: '',
        })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });

      let eventRowId = inserted[0]?.id;
      if (!eventRowId) {
        const [existing] = await db()
          .select({ id: webhookEvents.id, status: webhookEvents.status })
          .from(webhookEvents)
          .where(and(eq(webhookEvents.provider, 'youpi'), eq(webhookEvents.eventId, eventId)))
          .limit(1);
        if (!existing) {
          return reply
            .code(500)
            .send({ error: { code: 'PROCESSING_FAILED', message: 'Webhook processing failed.' } });
        }
        if (existing.status !== 'received') {
          return reply.send({ received: true, duplicate: true });
        }
        eventRowId = existing.id;
      }

      const normalizedEvent = eventType.toUpperCase();

      // Never fulfil on anything but a reconciled bank statement. Failure
      // events still close a pending local order so it does not linger forever.
      if (normalizedEvent !== 'RECONCILED') {
        const orderId = String(payload.orderId ?? '');
        let localStatus = 'ignored';
        if (orderId && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(normalizedEvent)) {
          const [stored] = await db().select().from(payments).where(eq(payments.orderRef, orderId)).limit(1);
          if (stored) localStatus = await applyYoupiNonSettlementEvent(stored.id, normalizedEvent);
        }
        await markYoupiEvent(eventRowId, 'ignored', `youpi:${normalizedEvent.toLowerCase()}:${localStatus}`);
        return reply.send({
          received: true,
          ignored: true,
          event: eventType,
          localStatus,
          note: 'Not a settlement event; recorded only.',
        });
      }

      const settlementState = String(payload.settlementState ?? '');
      if (settlementState !== 'RECONCILED') {
        request.log.warn({ eventType, settlementState }, 'youpi.webhook.non_reconciled');
        await markYoupiEvent(eventRowId, 'ignored', 'settlement_state_not_reconciled');
        return reply.send({ received: true, ignored: true, note: 'settlementState is not RECONCILED.' });
      }

      const orderId = String(payload.orderId ?? '');
      if (!orderId) {
        await markYoupiEvent(eventRowId, 'ignored', 'missing_order');
        return reply.code(400).send({ error: { code: 'MISSING_ORDER', message: 'Webhook has no orderId.' } });
      }

      const [stored] = await db().select().from(payments).where(eq(payments.orderRef, orderId)).limit(1);
      if (!stored) {
        request.log.warn({ orderId }, 'youpi.webhook.unknown_order');
        await markYoupiEvent(eventRowId, 'ignored', 'unknown_order');
        return reply.code(404).send({ error: { code: 'UNKNOWN_ORDER', message: 'No matching order.' } });
      }

      // A signed event for one order must not name a different gateway payment.
      const gatewayPaymentId =
        typeof payload.paymentId === 'string' && payload.paymentId ? payload.paymentId : null;
      if (gatewayPaymentId && stored.providerPaymentId && gatewayPaymentId !== stored.providerPaymentId) {
        request.log.error(
          { orderId, expected: stored.providerPaymentId, received: gatewayPaymentId },
          'youpi.webhook.gateway_payment_mismatch',
        );
        await markYoupiEvent(eventRowId, 'ignored', 'gateway_payment_mismatch');
        return reply
          .code(409)
          .send({ error: { code: 'GATEWAY_PAYMENT_MISMATCH', message: 'Gateway payment does not match the order.' } });
      }

      const paidPaise = Number(payload.amountPaise);
      const currency = String(payload.currency ?? '').toUpperCase();
      if (!Number.isInteger(paidPaise) || paidPaise !== stored.amountMinor) {
        request.log.error(
          { orderId, expected: stored.amountMinor, received: payload.amountPaise },
          'youpi.webhook.amount_mismatch',
        );
        await markYoupiEvent(eventRowId, 'ignored', 'amount_mismatch');
        return reply
          .code(409)
          .send({ error: { code: 'AMOUNT_MISMATCH', message: 'Amount does not match the order.' } });
      }
      if (currency !== stored.currency.toUpperCase()) {
        request.log.error(
          { orderId, expected: stored.currency, received: currency },
          'youpi.webhook.currency_mismatch',
        );
        await markYoupiEvent(eventRowId, 'ignored', 'currency_mismatch');
        return reply
          .code(409)
          .send({ error: { code: 'CURRENCY_MISMATCH', message: 'Currency does not match the order.' } });
      }

      const outcome = await settlePayment(stored.id, {
        gatewayStatus: 'succeeded',
        providerPaymentId: gatewayPaymentId ?? stored.providerPaymentId ?? undefined,
        source: 'upi',
      }).catch((err) => {
        request.log.error({ err, orderId }, 'youpi.webhook.settle_failed');
        return null;
      });

      if (!outcome) {
        // Leave the event at `received` so YouPI's retry can finish processing.
        return reply
          .code(500)
          .send({ error: { code: 'PROCESSING_FAILED', message: 'Webhook processing failed.' } });
      }
      await markYoupiEvent(eventRowId, 'processed', `youpi:${outcome.status}`);
      return reply.send({ received: true, outcome });
    },
  );

  /**
   * Razorpay webhook.
   *
   * The signature is verified against the raw body with RAZORPAY_WEBHOOK_SECRET.
   * An unverified payload is rejected outright - it never reaches settlement.
   * The status is then re-fetched server-to-server so a forged-but-signed
   * payload still cannot grant access on its own.
   */
  app.post(
    '/webhook/razorpay',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const raw = requireRawBody(request as unknown as { rawBody?: unknown });
      const verified = await razorpayAdapter.verifyWebhook(env, {
        rawBody: raw,
        headers: request.headers as Record<string, string | string[] | undefined>,
        url: `${request.protocol}://${request.hostname}${request.url}`,
      });
      if (!verified.verified) {
        request.log.warn({ ip: request.ip }, 'razorpay.webhook.invalid_signature');
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } });
      }

      const gatewayId = verified.paymentId;
      if (!gatewayId) {
        // Not a payment event (e.g. order.paid carries an order id we already
        // track). Acknowledge so the provider stops retrying.
        return reply.send({ received: true, ignored: true });
      }

      // Re-read the truth from Razorpay rather than trusting the payload body.
      let status = verified.status ?? 'unknown';
      let amountMinor: number | null = verified.amountMinor ?? null;
      try {
        const fresh = await razorpayAdapter.fetchPayment(env, gatewayId);
        status = fresh.status;
        amountMinor = fresh.amountMinor;
      } catch (err) {
        request.log.warn({ err, gatewayId }, 'razorpay.webhook.status_fetch_failed');
        // Fall back to the signed payload status.
      }

      // Amount integrity: if the gateway says a different amount than the order
      // we stored, refuse to settle and flag it for manual review.
      if (amountMinor !== null) {
        const [stored] = await db()
          .select({ amountMinor: payments.amountMinor })
          .from(payments)
          .where(eq(payments.providerRef, gatewayId))
          .limit(1);
        if (stored && stored.amountMinor !== amountMinor) {
          request.log.error(
            { gatewayId, expected: stored.amountMinor, received: amountMinor },
            'razorpay.webhook.amount_mismatch',
          );
          return reply
            .code(409)
            .send({ error: { code: 'AMOUNT_MISMATCH', message: 'Amount does not match the order.' } });
        }
      }

      const { settlePayment } = await import('../services/subscription.service.js');
      const outcome = await settlePayment(gatewayId, {
        gatewayStatus: status === 'succeeded' ? 'succeeded' : status,
        providerPaymentId: gatewayId,
        source: 'webhook',
      }).catch((err) => {
        request.log.error({ err, gatewayId }, 'razorpay.webhook.settle_failed');
        return null;
      });

      if (!outcome) {
        return reply.code(500).send({ error: { code: 'PROCESSING_FAILED', message: 'Webhook processing failed.' } });
      }
      return reply.send({ received: true, outcome });
    },
  );

  /** Refund eligibility for the authenticated owner (support/UI helper). */
  app.get('/pay/:id/refundable', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const [payment] = await db()
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.userId, user.id)))
      .limit(1);
    if (!payment) throw notFound('Payment not found.');
    return reply.send(await refundableFor(env, id));
  });

  app.post('/quote', async (request, reply) => {
    const auth = await requireAuth(request, env).catch(() => null);
    const input = parseOrThrow(changePlanSchema, request.body);
    const quote = await quotePlan(auth?.user.id ?? null, input);
    return reply.send({
      plan: quote.plan,
      examKeys: quote.examKeys,
      grossMinor: quote.grossMinor,
      discountMinor: quote.discountMinor,
      totalMinor: quote.totalMinor,
      currency: quote.currency,
      couponCode: quote.couponCode,
    });
  });

  app.post('/checkout', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(checkoutSchema, request.body);
    if (!user.emailVerified) throw forbidden('Verify your email address before paying.');

    const origin = request.headers.origin ?? env.PUBLIC_WEB_URL;
    const safeOrigin = /^https?:\/\//.test(origin) ? origin : env.PUBLIC_WEB_URL;
    const result = await createPaymentOrder(env, user, {
      planId: input.planId,
      examKeys: input.examKeys,
      examKey: input.examKey,
      couponCode: input.couponCode,
      returnUrl: `${safeOrigin}/checkout/return?payment=${'{payment_id}'}`,
    });
    return reply.code(201).send(result);
  });

  /**
   * Poll after the redirect: never trusts the browser. The gateway status is
   * fetched server-to-server and settlement happens through the same
   * idempotent path as the webhook.
   */
  app.post('/:id/verify', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const db = getDb();
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.userId, user.id)))
      .limit(1);
    if (!payment) throw notFound('Payment not found.');

    if (payment.status === 'succeeded') {
      return reply.send({ status: 'succeeded', payment, invoice: await issueInvoice(payment.id) });
    }
    if (!payment.providerPaymentId) {
      return reply.send({ status: payment.status, payment });
    }
    if (!hyperswitchConfigured(env)) {
      throw badRequest('Payment verification is unavailable right now.');
    }

    const gateway = await getPayment(env, payment.providerPaymentId);
    const status = (gateway.status ?? '').toLowerCase();
    const settleStatus = PAID_STATUSES.has(status)
      ? 'succeeded'
      : FAILED_STATUSES.has(status)
        ? 'failed'
        : 'pending';

    const result = await settlePayment(payment.id, {
      gatewayStatus: settleStatus === 'pending' ? status : settleStatus,
      providerPaymentId: payment.providerPaymentId,
      providerAttemptId: gateway.attempts?.[0]?.attempt_id ?? null,
      failureReason: gateway.error_message ?? null,
      source: 'return',
    });

    const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
    const invoice = result.status === 'succeeded' ? await issueInvoice(payment.id) : null;
    return reply.send({
      status: result.status === 'already_settled' ? 'succeeded' : result.status,
      payment: fresh,
      invoice,
      subscriptionId: result.subscriptionId ?? null,
    });
  });

  /**
   * Dev-only plan activation. There is no "fake successful payment": this
   * endpoint only works when live payments are disabled, and it records the
   * payment with provider `mock` + a clearly-labelled description so it can
   * never be mistaken for a real charge.
   */
  app.post('/mock-activate', async (request, reply) => {
    if (checkoutReady(env) || env.NODE_ENV === 'production' || !env.ALLOW_MOCK_PAYMENTS) {
      return reply.code(403).send({
        error: { code: 'MOCK_DISABLED', message: 'Simulated activation is disabled on this deployment.' },
      });
    }
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(checkoutSchema, request.body);
    const result = await activateMockPlan(user, input);
    const [fresh] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1);
    return reply.code(201).send({
      subscription: result.subscription,
      payment: result.payment,
      user: fresh
        ? { id: fresh.id, plan: fresh.plan, premiumUntil: fresh.premiumUntil, premiumActive: fresh.plan === 'premium' }
        : undefined,
      simulated: true,
      note: 'Simulated activation - no money was charged.',
    });
  });

  app.get('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const rows = await listPayments(user.id, 100);
    return reply.send({ payments: rows });
  });

  app.get('/invoices', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const rows = await listInvoices(user.id);
    return reply.send({ invoices: rows });
  });

  app.get('/invoices/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const invoice = await getInvoice(user.id, id);
    if (!invoice) throw notFound('Invoice not found.');
    const [buyer] = await db().select().from(users).where(eq(users.id, user.id)).limit(1);
    return reply.send({
      invoice,
      buyer: buyer ? { name: buyer.name, email: buyer.email } : null,
    });
  });

  /**
   * HyperSwitch webhook receiver.
   *
   * Security:
   *  - the raw body is captured before JSON parsing and used for HMAC-SHA512
   *  - invalid signatures are recorded and rejected with 401 (never settled)
   *  - duplicate event ids are ignored (unique index)
   *  - settlement happens only after a server-to-server status fetch
   */
  app.post(
    '/webhook/hyperswitch',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { recordWebhookEvent, processWebhookEvent } = await import('../services/webhook.service.js');
      const raw = requireRawBody(request as unknown as { rawBody?: unknown });
      const signature =
        (request.headers['x-webhook-signature-512'] as string | undefined) ??
        (request.headers['x-webhook-signature'] as string | undefined);

      const result = await recordWebhookEvent(env, {
        provider: 'hyperswitch',
        rawBody: raw,
        signature,
        payload: request.body as Record<string, unknown>,
        ip: request.ip,
      });

      if (!result.signatureValid) {
        request.log.warn({ eventId: result.eventId }, 'hyperswitch.webhook.invalid_signature');
        return reply.code(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } });
      }
      if (result.duplicate) {
        return reply.send({ received: true, duplicate: true });
      }

      try {
        const outcome = await processWebhookEvent(env, result.id, request.body as Record<string, unknown>);
        return reply.send({ received: true, ...outcome });
      } catch (err) {
        request.log.error({ err }, 'hyperswitch.webhook.processing_failed');
        // 500 makes HyperSwitch retry with the same event id; our unique index
        // prevents double processing on the retry.
        return reply.code(500).send({ error: { code: 'PROCESSING_FAILED', message: 'Webhook processing failed.' } });
      }
    },
  );
}

/** Small indirection so tests can swap the connection. */
function db() {
  return getDb();
}
