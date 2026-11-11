/**
 * UPI URI construction.
 *
 * A UPI payment string is `upi://pay?pa=...&pn=...&am=...&tn=...`. We always
 * supply an explicit amount so the payer cannot choose it: an amount the payer
 * controls could not be matched to a specific order.
 *
 * Ported from YouPI-PG's `packages/common/src/upi.js`, reduced to the dynamic
 * checkout case and with the amount derived only from integer paise.
 */

import { MAX_AMOUNT_PAISE, MIN_AMOUNT_PAISE, paiseToRupees } from './money.js';

/** VPA is `handle@provider`. Deliberately strict: it goes into a payment URI. */
export function isValidVpa(vpa: string): boolean {
  if (typeof vpa !== 'string') return false;
  const clean = vpa.trim();
  if (clean.length > 320) return false;
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9.\-_]{2,64}$/.test(clean);
}

/**
 * Strip characters that would break out of a UPI URI parameter.
 *
 * `tn` (transaction note) is shown in the payer's app and echoed back by some
 * banks, so it carries our order reference. It must not contain `&`, `?`, `#`
 * or control characters, which would let it inject extra URI parameters.
 */
export function sanitizeNote(note: string, maxLength = 50): string {
  return note
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[&#?=%+<>"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export interface UpiPaymentParams {
  payeeVpa: string;
  payeeName: string;
  amountPaise: number;
  /** Order reference; travels in `tn` and is what the observer looks for. */
  transactionRef: string;
}

function assertAmount(amountPaise: number): void {
  if (!Number.isSafeInteger(amountPaise)) throw new Error('amount_must_be_integer_paise');
  if (amountPaise < MIN_AMOUNT_PAISE) throw new Error('amount_below_minimum');
  if (amountPaise > MAX_AMOUNT_PAISE) throw new Error('amount_above_maximum');
}

function buildQuery(params: UpiPaymentParams): URLSearchParams {
  if (!isValidVpa(params.payeeVpa)) throw new Error(`invalid_payee_vpa:${params.payeeVpa}`);
  assertAmount(params.amountPaise);

  const payeeName = sanitizeNote(params.payeeName, 60);
  if (!payeeName) throw new Error('invalid_payee_name');

  const query = new URLSearchParams();
  query.set('pa', params.payeeVpa.trim());
  query.set('pn', payeeName);
  query.set('am', paiseToRupees(params.amountPaise));
  query.set('cu', 'INR');
  const note = sanitizeNote(params.transactionRef);
  if (note) query.set('tn', note);
  return query;
}

/** Generic `upi://pay` URI, offered to every installed UPI app. */
export function buildUpiUri(params: UpiPaymentParams): string {
  return `upi://pay?${buildQuery(params).toString()}`;
}

/**
 * Android intent URI that opens one specific UPI app.
 *
 * Used for the "pay with GPay / PhonePe / Paytm" buttons. On platforms that do
 * not understand `intent://` the generic URI is used instead, so this is always
 * safe to emit.
 */
export function buildUpiIntentUri(params: UpiPaymentParams & { packageName: string }): string {
  if (!params.packageName?.trim()) throw new Error('package_name_required');
  const query = buildQuery(params).toString();
  const pkg = params.packageName.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkg)) {
    throw new Error(`invalid_package_name:${pkg}`);
  }
  return `intent://pay?${query}#Intent;scheme=upi;package=${pkg};end`;
}

/** Common UPI app packages, surfaced as one-tap buttons in the checkout UI. */
export const UPI_APPS: ReadonlyArray<{ id: string; label: string; packageName: string }> = [
  { id: 'gpay', label: 'Google Pay', packageName: 'com.google.android.apps.nbu.paisa.user' },
  { id: 'phonepe', label: 'PhonePe', packageName: 'com.phonepe.app' },
  { id: 'paytm', label: 'Paytm', packageName: 'net.one97.paytm' },
  { id: 'bhim', label: 'BHIM', packageName: 'in.org.npci.upiapp' },
];
