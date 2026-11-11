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
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { checkoutSchema, changePlanSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { payments, users } from '../db/schema/index.js';
import {
  activateMockPlan,
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
import { getSettings } from '../services/settings.service.js';

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
    });
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
      const raw = (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body ?? {});
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
