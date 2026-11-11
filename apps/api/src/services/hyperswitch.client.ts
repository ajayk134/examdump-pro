/**
 * HyperSwitch payment gateway client.
 *
 * HyperSwitch (https://github.com/juspay/hyperswitch) is the open-source
 * payments router used by this platform. This module is the only place that
 * talks to it.
 *
 * Flow implemented:
 *   1. POST /payments            -> created payment + client_secret
 *   2. confirm the payment from the browser with the client_secret through the
 *      HyperSwitch SDK (card / UPI / wallet collection happens inside the SDK,
 *      so card data never touches our servers)
 *   3. HyperSwitch posts signed webhooks to /api/payments/webhook/hyperswitch
 *      (HMAC-SHA512 over the raw body, hex encoded, header
 *      `X-Webhook-Signature-512`)
 *   4. GET /payments/{id} is used to reconcile the final status server-side
 *      before any entitlement is granted.
 *
 * Signatures are always verified; entitlements are only granted after a
 * server-to-server status fetch confirms `succeeded`/`charged`.
 */
import crypto from 'node:crypto';
import type { Env } from '../config/env.js';

export interface HyperswitchPayment {
  payment_id: string;
  merchant_id?: string;
  status: string;
  amount: number;
  currency?: string;
  customer_id?: string | null;
  description?: string | null;
  client_secret?: string | null;
  next_action?: Record<string, unknown> | null;
  attempts?: Array<{ attempt_id?: string; status?: string; connector?: string | null }> | null;
  metadata?: Record<string, unknown> | null;
  error_code?: string | null;
  error_message?: string | null;
  payment_method_type?: string | null;
  connector?: string | null;
  created?: string | null;
  amount_received?: number | null;
}

export interface HyperswitchWebhookPayload {
  merchant_id?: string;
  event_id?: string;
  event_type?: string;
  timestamp?: string;
  content?: {
    type?: string;
    object?: HyperswitchPayment & {
      refund_id?: string;
      payment_id?: string;
      refund_status?: string;
      amount?: number;
      currency?: string;
    };
  };
}

export class HyperswitchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HyperswitchError';
  }
}

export function hyperswitchConfigured(env: Env): boolean {
  return Boolean(env.HYPERSWITCH_BASE_URL && env.HYPERSWITCH_API_KEY);
}

export function webhookConfigured(env: Env): boolean {
  return Boolean(env.HYPERSWITCH_WEBHOOK_SECRET && env.HYPERSWITCH_WEBHOOK_SECRET.length >= 8);
}

/** True when the platform can take a real payment right now. */
export function checkoutReady(env: Env): boolean {
  return (
    env.PAYMENT_PROVIDER === 'hyperswitch' &&
    env.PAYMENTS_ENABLED &&
    hyperswitchConfigured(env) &&
    webhookConfigured(env) &&
    Boolean(env.HYPERSWITCH_MERCHANT_ID)
  );
}

function baseUrl(env: Env): string {
  if (!env.HYPERSWITCH_BASE_URL) {
    throw new HyperswitchError('Payment gateway is not configured.', 503, 'GATEWAY_NOT_CONFIGURED');
  }
  return env.HYPERSWITCH_BASE_URL.replace(/\/+$/, '');
}

async function request<T>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PAYMENT_HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl(env)}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.HYPERSWITCH_API_KEY ?? '',
        'X-API-KEY': env.HYPERSWITCH_API_KEY ?? '',
        'X-Merchant-Id': env.HYPERSWITCH_MERCHANT_ID ?? '',
        'X-ApiVersion': env.HYPERSWITCH_API_VERSION,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok) {
      const body = parsed as { error?: { message?: string; code?: string }; message?: string } | null;
      throw new HyperswitchError(
        body?.error?.message ?? body?.message ?? `HyperSwitch request failed (${response.status})`,
        response.status,
        body?.error?.code ?? 'GATEWAY_ERROR',
        parsed,
      );
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof HyperswitchError) throw err;
    const e = err as Error;
    if (e.name === 'AbortError') {
      throw new HyperswitchError('The payment gateway timed out.', 504, 'GATEWAY_TIMEOUT');
    }
    throw new HyperswitchError('The payment gateway is unreachable.', 502, 'GATEWAY_UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export interface CreatePaymentInput {
  amountMinor: number;
  currency: string;
  orderRef: string;
  description: string;
  customer: { id?: string; email: string; name: string };
  returnUrl: string;
  metadata: Record<string, unknown>;
}

/** Create a payment intent and return its client secret. */
export async function createPayment(
  env: Env,
  input: CreatePaymentInput,
): Promise<HyperswitchPayment> {
  const sanitizedMeta: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.metadata)) {
    if (v === undefined || v === null) continue;
    sanitizedMeta[k] = String(v).slice(0, 200);
  }

  const body: Record<string, unknown> = {
    amount: input.amountMinor,
    currency: input.currency.toUpperCase(),
    confirm: false,
    capture_method: 'automatic',
    authentication_type: 'no_three_ds',
    merchant_order_reference_id: input.orderRef,
    description: input.description.slice(0, 200),
    return_url: input.returnUrl,
    metadata: sanitizedMeta,
    customer: {
      id: input.customer.id?.replace(/[^A-Za-z0-9_]/g, '_') || undefined,
      email: input.customer.email,
      name: input.customer.name.slice(0, 120),
    },
    billing: {
      email: input.customer.email,
      address: { line1: 'NA', city: 'NA', state: 'KA', zip: '560001', country: 'IN', first_name: input.customer.name.slice(0, 60) },
    },
  };
  if (env.HYPERSWITCH_PROFILE_ID) body.profile_id = env.HYPERSWITCH_PROFILE_ID;

  return request<HyperswitchPayment>(env, '/payments', { method: 'POST', body });
}

export async function getPayment(env: Env, paymentId: string): Promise<HyperswitchPayment> {
  return request<HyperswitchPayment>(env, `/payments/${encodeURIComponent(paymentId)}`);
}

export async function listPayments(
  env: Env,
  query: { limit?: number; offset?: number; from?: string; to?: string } = {},
): Promise<{ size: number; data: HyperswitchPayment[] }> {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit ?? 50));
  if (query.offset) params.set('offset', String(query.offset));
  if (query.from) params.set('start_time', query.from);
  if (query.to) params.set('end_time', query.to);
  return request<{ size: number; data: HyperswitchPayment[] }>(env, `/payments/list?${params.toString()}`);
}

export interface RefundResult {
  refund_id: string;
  payment_id: string;
  status: string;
  amount?: number;
  currency?: string;
}

export async function createRefund(
  env: Env,
  paymentId: string,
  input: { amountMinor: number; reason?: string; refundId: string },
): Promise<RefundResult> {
  return request<RefundResult>(env, '/refunds', {
    method: 'POST',
    body: {
      payment_id: paymentId,
      amount: input.amountMinor,
      reason: input.reason ?? 'requested_by_customer',
      refund_id: input.refundId,
      metadata: { source: 'examdump-pro' },
    },
  });
}

export async function getRefund(env: Env, refundId: string): Promise<RefundResult> {
  return request<RefundResult>(env, `/refunds/${encodeURIComponent(refundId)}`);
}

/* ------------------------------------------------------------------ */
/* Webhook signature verification                                      */
/* ------------------------------------------------------------------ */

/**
 * Verify the `X-Webhook-Signature-512` header: hexadecimal HMAC-SHA512 of the
 * exact raw request body keyed with the merchant webhook secret.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = crypto
    .createHmac('sha512', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');
  const provided = signatureHeader.trim().toLowerCase().replace(/^sha512=/, '');
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function signPayload(rawBody: string | Buffer, secret: string): string {
  return crypto
    .createHmac('sha512', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');
}

/** Statuses HyperSwitch uses for a captured/successful payment. */
export const PAID_STATUSES = new Set(['succeeded', 'charged', 'partially_captured', 'captured']);
export const FAILED_STATUSES = new Set(['failed', 'cancelled', 'cancelled_post_capture', 'expired', 'router_declined', 'voided']);
export const PENDING_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_customer_action',
  'requires_capture',
  'processing',
  'confirming',
  'pending',
]);
