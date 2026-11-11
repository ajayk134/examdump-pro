/**
 * Money helpers for UPI.
 *
 * All amounts are integer paise held in a Postgres `integer`/`bigint` column. Rupees
 * only ever exist as a formatted string for display or for the `am=` field of a UPI
 * URI. Nothing here does floating-point arithmetic on money, because a fraction of
 * a paisa lost to rounding would make an amount fail to match a bank credit.
 */

/** Largest amount we will ever ask a customer to pay, in paise (₹5,00,000). */
export const MAX_AMOUNT_PAISE = 50_000_000;

/** ₹1 minimum — UPI rails reject zero-value transfers. */
export const MIN_AMOUNT_PAISE = 100;

/**
 * Parse a user- or plan-supplied rupee amount into integer paise.
 *
 * Accepts "499", "499.5", "499.50" and rejects anything with more than two
 * decimals rather than silently rounding it, since a rounded amount would not
 * equal what the payer actually transfers.
 */
export function rupeesToPaise(input: string | number): number {
  const raw = typeof input === 'number' ? input.toString() : String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`invalid_rupee_amount:${input}`);
  }
  const [whole, fraction = ''] = raw.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) throw new Error(`amount_out_of_range:${input}`);
  return paise;
}

/** Format integer paise as a two-decimal rupee string, e.g. 49900 -> "499.00". */
export function paiseToRupees(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error(`invalid_paise:${paise}`);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Format paise for display, e.g. 49900 -> "₹499". Keeps paise only when non-zero. */
export function formatPaise(paise: number): string {
  const rupees = paiseToRupees(paise);
  return paise % 100 === 0 ? `₹${rupees.slice(0, -3)}` : `₹${rupees}`;
}
