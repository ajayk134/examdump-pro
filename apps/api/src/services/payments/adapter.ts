/**
 * ExamDump Pay — provider adapter contract.
 *
 * Why an interface instead of calling a gateway directly:
 *
 *  - Razorpay (UPI + cards) and HyperSwitch are both plausible targets, and the
 *    business code must not care which one is live.
 *  - An adapter that is not configured must be *inert*: it can describe what it
 *    supports, but it can never fabricate a successful payment.
 *
 * Hard rules every implementation must follow:
 *  1. Never settle a payment from the browser redirect. Only a server-verified
 *     gateway status (API fetch or verified webhook) may mark money as received.
 *  2. The amount is always taken from our own database/quote, never from the
 *     request body.
 *  3. Creation calls carry an idempotency key so a retried request cannot
 *     produce a second charge.
 */
import type { Env } from '../../config/env.js';

/** Payment methods the checkout UI may offer. */
export type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet';

export const ALL_PAYMENT_METHODS: PaymentMethod[] = ['upi', 'card', 'netbanking', 'wallet'];

/** Normalised status vocabulary shared across adapters. */
export type AdapterPaymentStatus =
  | 'created'
  | 'pending'
  | 'authorized'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded'
  | 'unknown';

export interface CreateOrderInput {
  amountMinor: number;
  currency: string;
  /** Our idempotent order reference. */
  orderRef: string;
  description: string;
  customer: { id: string; email: string; name?: string };
  returnUrl: string;
  /** Methods the checkout should offer. */
  methods: PaymentMethod[];
  metadata: Record<string, unknown>;
}

export interface CreateOrderResult {
  /** Gateway payment/order id. */
  paymentId: string;
  /** Token the frontend SDK needs; never a secret key. */
  clientSecret?: string;
  /** Hosted checkout URL, when the adapter provides one. */
  checkoutUrl?: string;
  status: AdapterPaymentStatus;
  raw?: unknown;
}

export interface AdapterPayment {
  paymentId: string;
  status: AdapterPaymentStatus;
  amountMinor: number | null;
  currency: string | null;
  /** Gateway-side status string, kept verbatim for support. */
  gatewayStatus: string;
  method?: PaymentMethod | null;
  raw?: unknown;
}

export interface RefundInput {
  paymentId: string;
  amountMinor: number;
  /** Idempotency key for the refund itself. */
  refundRef: string;
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  status: 'pending' | 'succeeded' | 'failed';
  amountMinor: number;
  raw?: unknown;
}

export interface WebhookVerificationInput {
  /** Raw request body exactly as received (needed for HMAC). */
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  /** Full URL, some providers sign it. */
  url: string;
}

export interface VerifiedWebhook {
  /** True only when the signature was validated against a configured secret. */
  verified: boolean;
  /** Gateway payment id the event refers to, when the event is about a payment. */
  paymentId?: string;
  /** Gateway order id, when present. */
  orderRef?: string;
  /** Normalised status derived from the event. */
  status?: AdapterPaymentStatus;
  amountMinor?: number | null;
  /** Adapter-specific event name. */
  eventType?: string;
  /** Raw parsed payload. */
  raw?: unknown;
}

export interface PaymentAdapter {
  /** Stable id written to `payments.provider`. */
  readonly id: 'razorpay' | 'hyperswitch';
  /** Human label for admin UI. */
  readonly label: string;
  /** True only when every credential needed to take real money is present. */
  isConfigured(env: Env): boolean;
  /** Methods this adapter can actually process. */
  supportedMethods(env: Env): PaymentMethod[];
  createOrder(env: Env, input: CreateOrderInput): Promise<CreateOrderResult>;
  fetchPayment(env: Env, paymentId: string): Promise<AdapterPayment>;
  refund(env: Env, input: RefundInput): Promise<RefundResult>;
  verifyWebhook(env: Env, input: WebhookVerificationInput): Promise<VerifiedWebhook>;
}

export class PaymentAdapterError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
    readonly code = 'PAYMENT_ADAPTER_ERROR',
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'PaymentAdapterError';
  }
}

/* -------------------------- shared utilities -------------------------- */

/**
 * Server-side amount guard.
 *
 * Called with the amount computed on our side (never the client's). It is a
 * defence-in-depth check against a bad quote (e.g. a coupon bug producing a
 * negative total) rather than a substitute for authorisation.
 */
export function assertAmountAllowed(
  env: Env,
  amountMinor: number,
  currency: string,
): void {
  if (!Number.isInteger(amountMinor)) {
    throw new PaymentAdapterError('Order amount must be an integer in minor units.', 400, 'INVALID_AMOUNT');
  }
  if (amountMinor < env.PAYMENT_MIN_AMOUNT_MINOR) {
    throw new PaymentAdapterError(
      `Order amount is below the minimum (${env.PAYMENT_MIN_AMOUNT_MINOR} ${currency} minor units).`,
      400,
      'AMOUNT_TOO_SMALL',
    );
  }
  if (amountMinor > env.PAYMENT_MAX_AMOUNT_MINOR) {
    throw new PaymentAdapterError(
      `Order amount exceeds the maximum (${env.PAYMENT_MAX_AMOUNT_MINOR} ${currency} minor units).`,
      400,
      'AMOUNT_TOO_LARGE',
    );
  }
}

/** Parse the configured method list, always intersected with adapter support. */
export function parseMethods(env: Env): PaymentMethod[] {
  const wanted = env.PAYMENT_METHODS.split(',')
    .map((m) => m.trim().toLowerCase())
    .filter((m): m is PaymentMethod => (ALL_PAYMENT_METHODS as string[]).includes(m));
  return wanted.length > 0 ? wanted : ['upi', 'card'];
}

/** Constant-time-ish comparison for HMAC hex digests. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
