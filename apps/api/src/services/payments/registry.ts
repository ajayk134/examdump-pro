/**
 * ExamDump Pay — adapter registry.
 *
 * Resolves the single adapter that is allowed to take live payments.
 *
 * Deliberately conservative: a live checkout is offered only when
 *   PAYMENT_ADAPTER is set to a real provider,
 *   PAYMENTS_ENABLED=true,
 *   and that adapter reports itself configured (all credentials present).
 *
 * If any of those is missing the platform behaves as free-tier only. There is
 * no fallback to a sandbox or a simulated success - that is the one thing a
 * payment system must never do silently.
 */
import type { Env } from '../../config/env.js';
import type { PaymentAdapter, PaymentMethod } from './adapter.js';
import { parseMethods } from './adapter.js';
import { razorpayAdapter } from './razorpay.adapter.js';

const REGISTRY: Record<string, PaymentAdapter> = {
  razorpay: razorpayAdapter,
};

export interface PaymentAvailability {
  /** Adapter that will take money, or null when checkout is unavailable. */
  adapter: PaymentAdapter | null;
  adapterId: 'razorpay' | 'hyperswitch' | null;
  /** Methods actually offered right now. */
  methods: PaymentMethod[];
  /** Why checkout is unavailable, for logs and the UI. */
  reason:
    | 'ok'
    | 'payments_disabled'
    | 'no_adapter'
    | 'adapter_unconfigured'
    | 'adapter_coming_soon';
}

export function resolvePaymentAdapter(env: Env): PaymentAvailability {
  if (!env.PAYMENTS_ENABLED) {
    return { adapter: null, adapterId: null, methods: [], reason: 'payments_disabled' };
  }

  // HyperSwitch is intentionally not a candidate yet: it needs heavy
  // infrastructure this deployment does not run. Report it explicitly so the UI
  // does not claim card payments are available.
  if (env.PAYMENT_ADAPTER === 'hyperswitch' || env.PAYMENT_PROVIDER === 'hyperswitch') {
    return { adapter: null, adapterId: 'hyperswitch', methods: [], reason: 'adapter_coming_soon' };
  }

  if (env.PAYMENT_ADAPTER === 'none') {
    return { adapter: null, adapterId: null, methods: [], reason: 'no_adapter' };
  }

  const adapter = REGISTRY[env.PAYMENT_ADAPTER];
  if (!adapter) {
    return { adapter: null, adapterId: null, methods: [], reason: 'no_adapter' };
  }
  if (!adapter.isConfigured(env)) {
    return { adapter: null, adapterId: adapter.id, methods: [], reason: 'adapter_unconfigured' };
  }

  const methods = adapter.supportedMethods(env).filter((m) => parseMethods(env).includes(m));
  if (methods.length === 0) {
    return { adapter: null, adapterId: adapter.id, methods: [], reason: 'adapter_unconfigured' };
  }

  return { adapter, adapterId: adapter.id, methods, reason: 'ok' };
}

/** True when a customer can actually complete a payment right now. */
export function checkoutAvailable(env: Env): boolean {
  return resolvePaymentAdapter(env).adapter !== null;
}

export function getAdapterById(id: string): PaymentAdapter | null {
  return REGISTRY[id] ?? null;
}
