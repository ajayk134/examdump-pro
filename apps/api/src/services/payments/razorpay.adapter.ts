/**
 * Razorpay adapter — UPI and cards for Indian customers.
 *
 * Uses the REST API directly (Basic auth with key id/secret) so we do not take
 * on the official SDK: the surface we need is four endpoints.
 *
 * Security notes:
 *  - `RAZORPAY_KEY_SECRET` is server-only. `RAZORPAY_KEY_ID` is public by design
 *    (it ships in the checkout page) but is still only returned when the
 *    adapter is fully configured.
 *  - Webhooks are verified with HMAC-SHA256 over the raw body using
 *    `RAZORPAY_WEBHOOK_SECRET`. An unset secret means no webhook is trusted.
 *  - Nothing here marks a payment successful. It only reports what the gateway
 *    said; settlement happens in subscription.service.
 */
import { createHmac } from 'node:crypto';
import type { Env } from '../../config/env.js';
import {
  PaymentAdapterError,
  parseMethods,
  safeEqual,
  type AdapterPayment,
  type AdapterPaymentStatus,
  type CreateOrderInput,
  type CreateOrderResult,
  type PaymentAdapter,
  type PaymentMethod,
  type RefundInput,
  type RefundResult,
  type VerifiedWebhook,
  type WebhookVerificationInput,
} from './adapter.js';

const API_BASE = 'https://api.razorpay.com/v1';

function configured(env: Env): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

async function request<T>(
  env: Env,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  if (!configured(env)) {
    throw new PaymentAdapterError('Razorpay is not configured.', 503, 'ADAPTER_NOT_CONFIGURED');
  }
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PAYMENT_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(init.body ? {} : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const described = (data as { error?: { description?: string; code?: string } } | null)?.error;
      const retryable = res.status === 429 || res.status >= 500;
      throw new PaymentAdapterError(
        described?.description ?? `Razorpay responded ${res.status}`,
        res.status === 429 ? 503 : res.status >= 500 ? 502 : 400,
        described?.code ?? 'RAZORPAY_ERROR',
        retryable,
      );
    }
    return data as T;
  } catch (err) {
    if (err instanceof PaymentAdapterError) throw err;
    const e = err as Error;
    if (e.name === 'AbortError') {
      throw new PaymentAdapterError('Razorpay request timed out.', 504, 'RAZORPAY_TIMEOUT', true);
    }
    throw new PaymentAdapterError(`Razorpay request failed: ${e.message}`, 502, 'RAZORPAY_NETWORK', true);
  } finally {
    clearTimeout(timer);
  }
}

/** Razorpay status -> our shared vocabulary. */
export function mapRazorpayStatus(status: string | undefined): AdapterPaymentStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'created':
      return 'created';
    case 'attempted':
      return 'pending';
    case 'authorized':
      return 'authorized';
    case 'captured':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    case 'refunded':
      return 'refunded';
    case 'partially_refunded':
      return 'partially_refunded';
    default:
      return 'unknown';
  }
}

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

interface RazorpayPayment {
  id: string;
  order_id?: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
}

interface RazorpayRefund {
  id: string;
  amount: number;
  status: string;
}

function mapMethod(method: string | undefined): PaymentMethod | null {
  switch ((method ?? '').toLowerCase()) {
    case 'upi':
      return 'upi';
    case 'card':
      return 'card';
    case 'netbanking':
      return 'netbanking';
    case 'wallet':
      return 'wallet';
    default:
      return null;
  }
}

export const razorpayAdapter: PaymentAdapter = {
  id: 'razorpay',
  label: 'Razorpay (UPI + Cards)',

  isConfigured: configured,

  supportedMethods(env: Env): PaymentMethod[] {
    // Razorpay handles all four; keep whatever the operator enabled.
    return parseMethods(env).filter((m) => m === 'upi' || m === 'card' || m === 'netbanking' || m === 'wallet');
  },

  async createOrder(env: Env, input: CreateOrderInput): Promise<CreateOrderResult> {
    // `receipt` is our idempotent reference. Razorpay rejects duplicates within
    // its window, which is exactly the behaviour we want for retries.
    const order = await request<RazorpayOrder>(env, '/orders', {
      method: 'POST',
      body: {
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.orderRef,
        notes: {
          description: input.description.slice(0, 200),
          userId: input.customer.id,
          methods: input.methods.join(','),
          ...(Object.fromEntries(
            Object.entries(input.metadata).map(([k, v]) => [k, String(v).slice(0, 200)]),
          ) as Record<string, string>),
        },
      },
    });

    return {
      paymentId: order.id,
      status: mapRazorpayStatus(order.status),
      // The frontend opens Razorpay Checkout with the key id + order id.
      // No secret ever leaves the server.
      clientSecret: undefined,
      raw: order,
    };
  },

  async fetchPayment(env: Env, paymentId: string): Promise<AdapterPayment> {
    const payment = await request<RazorpayPayment>(env, `/payments/${encodeURIComponent(paymentId)}`);
    return {
      paymentId: payment.id,
      status: mapRazorpayStatus(payment.status),
      amountMinor: typeof payment.amount === 'number' ? payment.amount : null,
      currency: payment.currency ?? null,
      gatewayStatus: payment.status,
      method: mapMethod(payment.method),
      raw: payment,
    };
  },

  async refund(env: Env, input: RefundInput): Promise<RefundResult> {
    const refund = await request<RazorpayRefund>(
      env,
      `/payments/${encodeURIComponent(input.paymentId)}/refund`,
      {
        method: 'POST',
        body: {
          amount: input.amountMinor,
          // Speed up UPI/card refunds where the network supports it.
          speed: 'optimum',
          notes: { reason: input.reason ?? '', refundRef: input.refundRef },
          receipt: input.refundRef,
        },
      },
    );
    return {
      refundId: refund.id,
      status: refund.status === 'processed' ? 'succeeded' : refund.status === 'failed' ? 'failed' : 'pending',
      amountMinor: refund.amount,
      raw: refund,
    };
  },

  async verifyWebhook(env: Env, input: WebhookVerificationInput): Promise<VerifiedWebhook> {
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    const signature = String(input.headers['x-razorpay-signature'] ?? '');
    if (!secret || !signature) {
      return { verified: false, raw: null };
    }
    const expected = createHmac('sha256', secret).update(input.rawBody, 'utf8').digest('hex');
    if (!safeEqual(expected, signature)) {
      return { verified: false, raw: null };
    }

    let payload: {
      event?: string;
      payload?: {
        payment?: { entity?: RazorpayPayment };
        order?: { entity?: RazorpayOrder };
        refund?: { entity?: RazorpayRefund };
      };
    };
    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      return { verified: false };
    }

    const payment = payload.payload?.payment?.entity;
    const refund = payload.payload?.refund?.entity;
    const eventType = payload.event ?? '';

    // Refund events carry the payment in a different field on some plans, so be
    // permissive about where the amount comes from.
    const status = eventType.startsWith('refund.')
      ? refund
        ? 'refunded'
        : undefined
      : mapRazorpayStatus(payment?.status);

    return {
      verified: true,
      paymentId: payment?.id,
      amountMinor: payment?.amount ?? refund?.amount ?? null,
      status,
      eventType,
      raw: payload,
    };
  },
};
