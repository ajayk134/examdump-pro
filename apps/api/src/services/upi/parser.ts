/**
 * Parsers for Indian bank/UPI credit notifications (SMS and email).
 *
 * Ported from YouPI-PG's `bank-sms-parser.js` / `bank-email-parser.js`, which in
 * turn are careful reimplementations of the common formats from SBI, HDFC,
 * ICICI, Axis, Kotak, PNB, BoB, Paytm and the UPI apps.
 *
 * IMPORTANT: a parsed notification is *evidence that a bank told us something*,
 * never proof of settlement. See `docs/infrastructure/upi-payments.md`.
 *
 * Hardening applied over the original:
 *  - text is length-capped before any regex runs, because these patterns scan
 *    from every offset and a multi-KB message could block the event loop;
 *  - whitespace is collapsed first for the same reason;
 *  - debit-before-credit ordering decides direction, so "Rs 500 credited. Rs 10
 *    debited for SMS charges" counts as a credit while "debited... credited" in
 *    a refund-pending message does not.
 */

import { rupeesToPaise } from './money.js';

/** Notifications longer than this are almost certainly not bank alerts. */
const MAX_SCAN_CHARS = 4096;

export interface ParsedNotification {
  amountPaise: number;
  /** Raw matched amount text, for audit only. */
  amountText: string;
  bankReferenceNumber?: string;
  senderVpa?: string;
  observedAt: Date;
  rawText: string;
}

/** Collapse whitespace and cap length so every later regex is linear. */
function prepare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SCAN_CHARS);
}

const CREDIT_KEYWORDS = new RegExp(
  '\\b(?:credited|credit|received|deposit(?:ed)?|payment\\s+received|money\\s+received|upi\\/cr' +
    '|transferred\\s+to\\s+(?:your\\s+)?(?:a\\/c|account|wallet)' +
    '|payment\\s+of\\s+(?:(?:rs\\b\\.?|inr\\b)\\s*)?[\\d,.]+\\s+(?:has\\s+been\\s+)?made\\s+to\\s+(?:your\\s+)?(?:a\\/c|account|wallet)' +
    '|added\\s+to\\s+(?:your\\s+)?(?:account|wallet))\\b',
  'i',
);

const DEBIT_WORDS = /\b(?:debited|withdrawn|deducted|spent|paid rs|sent rs)\b/i;
const CREDIT_WORDS = /\b(?:credited|credit|received|deposit|deposited)\b/i;

/**
 * Remove balance clauses so "Avl Bal Rs 10,000" is not read as the payment
 * amount. Without this, a ₹499 credit reported alongside a ₹10,000 balance
 * would parse as ₹10,000.
 */
const BALANCE_PATTERN =
  /(?:(?:avl|avail|available|tot|total|ledger|clear|curr|current)(?:\s+(?:bal|balance|limit))?|bal|balance)\b[\s:=-]*(?:(?:rs\.?|inr|₹)\s*)?\b\d[\d,]{0,15}(?:\.\d{1,2})?/gi;

/** True when the message describes money arriving in the account. */
export function isCreditNotification(text: string): boolean {
  const clean = prepare(text);
  if (!clean || !CREDIT_KEYWORDS.test(clean)) return false;
  const debitIdx = clean.search(DEBIT_WORDS);
  const creditIdx = clean.search(CREDIT_WORDS);
  // A debit mentioned before any credit means the money left the account.
  if (debitIdx !== -1 && (creditIdx === -1 || debitIdx < creditIdx)) return false;
  return true;
}

/**
 * Extract the credited amount.
 *
 * Patterns are tried in descending order of confidence: an explicit
 * "credited with X" beats a bare "Rs X", which beats a stray decimal number.
 */
export function extractAmount(text: string): { amountPaise: number; amountText: string } | null {
  const clean = prepare(text).replace(BALANCE_PATTERN, ' ').trim();
  if (!clean) return null;

  const candidates: Array<RegExp> = [
    // "credited with Rs. 500", "received ₹200.00"
    /(?:credited\s*(?:with|by|for)?|received|deposit(?:ed)?)\s*[:=-]?\s*(?:(?:rs\b\.?|inr\b)|₹)?[\s:=-]*([\d,]+(?:\.\d{1,2})?)/i,
    // "Rs 499.00 credited"
    /(?:(?:rs\b\.?|inr\b)|₹)[\s:=-]*([\d,]+(?:\.\d{1,2})?)\s*(?:(?:has\s+been|is)\s+)?(?:credited|received|deposited)/i,
    // any currency-prefixed amount
    /(?:(?:rs\b\.?|inr\b)|₹)[\s:=-]*([\d,]+(?:\.\d{1,2})?)/i,
    // currency-suffixed amount: "499.00 INR"
    /(?:^|[^\w.])([\d,]+(?:\.\d{1,2})?)[\s:=-]*(?:(?:rs\b\.?|inr\b)|₹)/i,
    // standalone decimal with exactly two places
    /\b(\d{1,6}\.\d{2})\b/,
  ];

  for (const pattern of candidates) {
    const match = clean.match(pattern);
    const raw = match?.[1] ?? match?.[2];
    if (!raw) continue;
    const asText = raw.replace(/,/g, '');
    try {
      return { amountPaise: rupeesToPaise(asText), amountText: asText };
    } catch {
      // Not a valid monetary value (e.g. a date); try the next pattern.
    }
  }
  return null;
}

/** UTR / RRN / UPI reference. Narrow character class keeps it token-like. */
export function extractReference(text: string): string | undefined {
  const clean = prepare(text);
  const patterns: RegExp[] = [
    /(?:upi\s*ref(?:erence)?\s*(?:no\.?|num)?|utr(?:\s*no\.?)?|rrn(?:\s*no\.?)?|txn\s*(?:id|ref|#)?|transaction\s*id|ref\s*no\.?)[\s:=-]+([a-zA-Z0-9\-_]{6,35})/i,
    /UPI\/CR\/([a-zA-Z0-9\-_]{6,35})/i,
    /\b(?:ref(?:\s*(?:no\.?|id|#))?)[:\s#=-]+([a-zA-Z0-9\-_]{6,35})/i,
    /\b([0-9]{12})\b/,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

/** Payer VPA, when the bank includes it. Useful for risk scoring, never decisive. */
export function extractSenderVpa(text: string): string | undefined {
  const clean = prepare(text);
  /*
   * The optional name group only applies when a bracket follows it, e.g.
   * "from Rahul (ajay@okhdfcbank)" or "from Rahul [ajay@okhdfcbank]". Without
   * the bracket requirement the name group greedily consumes the first
   * characters of a bare address ("from ajay@ok" -> "ay@ok").
   */
  const match =
    clean.match(/(?:from|by|vpa|upi\s*id)[\s:]+[a-zA-Z \t]*[([\]]\s*([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z0-9.\-_]{2,32})/i) ??
    clean.match(/(?:from|by|vpa|upi\s*id)[\s:]+([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z0-9.\-_]{2,32})/i);
  if (!match?.[1]) return undefined;
  return match[1].trim().replace(/[.,;]+$/, '');
}

export interface NotificationInput {
  text: string;
  /** When the bank sent it. Epoch milliseconds, an ISO string, or a Date. */
  timestamp?: Date | string | number;
}

/** Parse an SMS/notification body. Returns null when it is not a credit alert. */
export function parseBankNotification(input: NotificationInput): ParsedNotification | null {
  const raw = prepare(input.text ?? '');
  if (!raw) return null;
  if (!isCreditNotification(raw)) return null;

  const amount = extractAmount(raw);
  if (!amount) return null;

  let observedAt = new Date();
  if (input.timestamp !== undefined) {
    const parsed = new Date(input.timestamp);
    if (!Number.isNaN(parsed.getTime())) observedAt = parsed;
  }

  return {
    amountPaise: amount.amountPaise,
    amountText: amount.amountText,
    bankReferenceNumber: extractReference(raw),
    senderVpa: extractSenderVpa(raw),
    observedAt,
    rawText: raw,
  };
}

/** Parse a bank alert email by combining subject and body. */
export function parseBankEmail(input: {
  subject?: string;
  body?: string;
  date?: Date | string;
}): ParsedNotification | null {
  const combined = `${input.subject ?? ''} ${input.body ?? ''}`;
  return parseBankNotification({ text: combined, timestamp: input.date });
}
