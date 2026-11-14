/**
 * YouPI-PG client — merchant API + signed webhook verification.
 *
 * YouPI-PG is an independent, self-hosted UPI gateway running as its own systemd
 * services against its own SQLite database. It is *not* an acquirer and it has no
 * bank API: the only event that proves money moved is `RECONCILED`, which YouPI
 * emits after an operator imports a bank-statement line whose receiving account,
 * amount (paise) and reference match the payment. `OBSERVED_SUCCESS` (a bank
 * alert was attributed) and `MANUAL_REVIEW` are explicitly NOT settlements and
 * must never fulfil an order.
 *
 * Contract used here (see YouPI docs/MERCHANT_INTEGRATION.md):
 *   POST {YOUPI_API_URL}/api/v1/payments   -> { paymentId, checkoutUrl, ... }
 *   Headers: X-Merchant-Id, X-Merchant-Key, Idempotency-Key
 *   Webhook headers: X-Gateway-Event, X-Gateway-Signature (sha256=HMAC(body)),
 *     X-Gateway-Signature-V2 (sha256=HMAC(timestamp.body)),
 *     X-Gateway-Delivery-Id, X-Gateway-Timestamp.
 *
 * The amount always comes from our own quote; we send it as a rupees string but
 * store and compare integer paise.
 */
import crypto from 'node:crypto';
import type { Env } from '../../config/env.js';
import { PaymentAdapterError } from './adapter.js';

export interface YoupiOrderInput {
  amountMinor: number;
  currency: string;
  /** Our idempotent order reference, sent to YouPI as `orderId`. */
  orderRef: string;
  description: string;
  returnUrl: string;
  metadata?: Record<string, unknown>;
}

export interface YoupiOrder {
  paymentId: string;
  orderId: string;
  status: string;
  checkoutUrl: string;
}

export interface YoupiVerifyInput {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface YoupiWebhook {
  verified: boolean;
  reason?: string;
  event?: string;
  deliveryId?: string;
  timestamp?: number;
  payload?: YoupiPayload;
}

/** The subset of the YouPI webhook payload this integration relies on. */
export interface YoupiPayload {
  event?: string;
  deliveryId?: string;
  timestamp?: number;
  paymentId?: string;
  orderId?: string;
  amount?: string;
  amountPaise?: number;
  currency?: string;
  method?: string;
  utr?: string;
  settlementState?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export function youpiConfigured(env: Env): boolean {
  return Boolean(
    env.YOUPI_API_URL && env.YOUPI_MERCHANT_ID && env.YOUPI_MERCHANT_KEY && env.YOUPI_WEBHOOK_SECRET,
  );
}

/** Integer paise -> rupees string ("49900" -> "499.00"). Never a float. */
export function toRupees(amountMinor: number): string {
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Constant-time comparison of two hex digests. */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Create a YouPI checkout session for a server-computed amount.
 *
 * Uses `MANUAL_UPI` because YouPI gates automated `UPI` sessions on a live SMS
 * observer heartbeat, and this deployment runs Gmail-only (no paired SMS
 * observer). `MANUAL_UPI` settles the same way: only an operator-reconciled
 * bank statement unlocks fulfilment.
 */
export async function createYoupiOrder(env: Env, input: YoupiOrderInput): Promise<YoupiOrder> {
  if (!youpiConfigured(env)) {
    throw new PaymentAdapterError('YouPI-PG is not configured.', 503, 'YOUPI_UNCONFIGURED');
  }
  const url = new URL('/api/v1/payments', env.YOUPI_API_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PAYMENT_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-merchant-id': env.YOUPI_MERCHANT_ID!,
        'x-merchant-key': env.YOUPI_MERCHANT_KEY!,
        'idempotency-key': input.orderRef,
      },
      body: JSON.stringify({
        orderId: input.orderRef,
        amount: toRupees(input.amountMinor),
        currency: input.currency,
        method: 'MANUAL_UPI',
        returnUrl: input.returnUrl,
        metadata: input.metadata ?? {},
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      // 409 from YouPI means the order already exists with a matching amount and
      // currency (a retry); that is not a failure, but without a checkout URL we
      // cannot proceed, so surface it plainly rather than guessing.
      throw new PaymentAdapterError(
        `YouPI order creation failed (${res.status}).`,
        502,
        'YOUPI_CREATE_FAILED',
      );
    }
    if (typeof data.paymentId !== 'string' || typeof data.checkoutUrl !== 'string') {
      throw new PaymentAdapterError('YouPI returned no checkout URL.', 502, 'YOUPI_BAD_RESPONSE');
    }

    return {
      paymentId: data.paymentId,
      orderId: typeof data.orderId === 'string' ? data.orderId : input.orderRef,
      status: typeof data.status === 'string' ? data.status : 'created',
      checkoutUrl: data.checkoutUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify a YouPI webhook signature against the raw request bytes.
 *
 * Prefers the timestamped V2 signature (HMAC over `${timestamp}.${body}`) so a
 * captured delivery cannot be replayed indefinitely; falls back to the plain V1
 * signature only when V2 is absent. Replay of the same delivery is additionally
 * blocked by the unique `(provider, event_id)` index on `webhook_events`.
 */
export function verifyYoupiWebhook(env: Env, input: YoupiVerifyInput): YoupiWebhook {
  if (!env.YOUPI_WEBHOOK_SECRET) return { verified: false, reason: 'unconfigured' };

  const header = (name: string): string => {
    const value = input.headers[name];
    return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  };

  const stripPrefix = (v: string): string => v.replace(/^sha256=/i, '').trim();
  const sigV2 = stripPrefix(header('x-gateway-signature-v2'));
  const sigV1 = stripPrefix(header('x-gateway-signature'));
  const timestampRaw = header('x-gateway-timestamp');
  const event = header('x-gateway-event');
  const deliveryId = header('x-gateway-delivery-id');

  if (!sigV1 && !sigV2) return { verified: false, reason: 'missing_signature' };

  const bodySig = crypto
    .createHmac('sha256', env.YOUPI_WEBHOOK_SECRET)
    .update(input.rawBody)
    .digest('hex');
  const timestampedSig = crypto
    .createHmac('sha256', env.YOUPI_WEBHOOK_SECRET)
    .update(`${timestampRaw}.${input.rawBody}`)
    .digest('hex');

  let signatureOk = false;
  if (sigV2) {
    signatureOk = constantTimeEqualHex(sigV2, timestampedSig);
  } else {
    signatureOk = constantTimeEqualHex(sigV1, bodySig);
  }
  if (!signatureOk) return { verified: false, reason: 'bad_signature' };

  const ts = Number(timestampRaw);
  if (sigV2) {
    if (!Number.isFinite(ts) || ts <= 0) return { verified: false, reason: 'missing_timestamp' };
    const ageSeconds = Math.abs(Date.now() - ts) / 1000;
    if (ageSeconds > env.YOUPI_WEBHOOK_TOLERANCE_SECONDS) {
      return { verified: false, reason: 'stale_timestamp' };
    }
  }

  let payload: YoupiPayload;
  try {
    payload = JSON.parse(input.rawBody) as YoupiPayload;
  } catch {
    return { verified: false, reason: 'bad_json' };
  }

  return {
    verified: true,
    event: event || payload.event,
    deliveryId: deliveryId || payload.deliveryId,
    timestamp: Number.isFinite(ts) ? ts : undefined,
    payload,
  };
}
