/**
 * Risk / confidence engine.
 *
 * Turns a parsed notification plus candidate orders into a decision:
 * `approve`, `review` or `reject`. It is deliberately a scoring function with an
 * explicit, auditable list of reasons rather than a black box, because every
 * auto-approval is money being granted without a human looking at it.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * No score can establish that money actually settled. A notification is a claim
 * made by a mail server that a bank sent something. A high score means "this
 * looks exactly like our order and nothing suspicious is present". Bank
 * settlement is only provable from the bank's own statement, which this system
 * cannot read. Operators must reconcile periodically; the dashboard says so.
 *
 * The thresholds are configurable so they can be tightened without a deploy.
 */

export interface RiskOrderFacts {
  /** Amount the customer was asked to pay. */
  amountPaise: number;
  /** When the order was created. */
  createdAt: Date;
  /** Hard expiry; a payment after this is ambiguous by construction. */
  expiresAt: Date;
  /** Candidate must be pending for us to settle it. */
  status: string;
  /** Our reference, echoed in the UPI note field. Some banks pass it back. */
  reference: string;
}

export interface RiskNotificationFacts {
  amountPaise: number | null;
  /** UTR/RRN as reported by the bank, when available. */
  bankReferenceNumber?: string | null;
  /** Alias accepted for callers that already use this name. */
  bankReference?: string | null;
  senderVpa?: string | null;
  /** When the bank said the credit happened. */
  observedAt: Date | null;
  rawText: string;
}

export interface RiskConfig {
  /** Confidence at or above this auto-approves. */
  approveThreshold: number;
  /** Between review and approve we hold for a human. */
  reviewThreshold: number;
  /**
   * How far *before* order creation a bank timestamp may sit. Zero is safest;
   * a little slack covers bank clocks that round down and email delivery that
   * stamps the message a moment earlier than the order row.
   */
  clockSkewSeconds: number;
  /** A credit older than this relative to the order is treated as stale. */
  maxNotificationAgeSeconds: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  approveThreshold: 80,
  reviewThreshold: 50,
  clockSkewSeconds: 90,
  maxNotificationAgeSeconds: 30 * 60,
};

export type RiskDecision = 'approve' | 'review' | 'reject';

export interface RiskAssessment {
  decision: RiskDecision;
  confidence: number;
  reasons: string[];
  /** Structured signals, persisted so thresholds can be tuned from real data. */
  signals: Record<string, unknown>;
}

/** Amount must match exactly. A single paisa off is not our payment. */
function scoreAmount(order: RiskOrderFacts, note: RiskNotificationFacts, reasons: string[]): number {
  if (note.amountPaise === null) {
    reasons.push('amount_missing');
    return 0;
  }
  if (note.amountPaise !== order.amountPaise) {
    reasons.push(`amount_mismatch:expected=${order.amountPaise},seen=${note.amountPaise}`);
    return 0;
  }
  reasons.push('amount_exact');
  return 40;
}

/**
 * Amounts are shared across customers (everyone buying the same plan pays the
 * same price), so amount alone can never identify an order. Uniqueness of the
 * *candidate set* is worth real confidence, but only when reinforced by timing.
 */
function scoreUniqueness(candidateCount: number, reasons: string[]): number {
  if (candidateCount === 1) {
    reasons.push('single_candidate');
    return 25;
  }
  if (candidateCount > 1) {
    reasons.push(`ambiguous:${candidateCount}_candidates`);
    return 0;
  }
  reasons.push('no_candidate');
  return 0;
}

/** Reference echoed back is strong evidence; its absence is merely neutral. */
function scoreReference(order: RiskOrderFacts, note: RiskNotificationFacts, reasons: string[]): number {
  const haystack = `${note.rawText} ${note.bankReferenceNumber ?? note.bankReference ?? ''}`.toUpperCase();
  if (haystack.includes(order.reference.toUpperCase())) {
    reasons.push('reference_echoed');
    return 20;
  }
  reasons.push('reference_absent');
  return 0;
}

/**
 * Timing window. A credit observed before the order existed, or long after it
 * expired, is a different payment that happens to share an amount.
 */
function scoreTiming(
  order: RiskOrderFacts,
  note: RiskNotificationFacts,
  config: RiskConfig,
  reasons: string[],
): { score: number; fatal: boolean } {
  if (!note.observedAt) {
    reasons.push('timestamp_missing');
    // Without a timestamp we cannot rule out a stale alert being replayed.
    return { score: 0, fatal: false };
  }
  const observed = note.observedAt.getTime();
  const created = order.createdAt.getTime() - config.clockSkewSeconds * 1000;
  const expiry = order.expiresAt.getTime() + config.clockSkewSeconds * 1000;

  if (observed < created) {
    reasons.push('observed_before_order_created');
    return { score: 0, fatal: true };
  }
  if (observed > expiry) {
    reasons.push('observed_after_order_expiry');
    return { score: 0, fatal: true };
  }
  if (observed - created > config.maxNotificationAgeSeconds * 1000 + (order.expiresAt.getTime() - order.createdAt.getTime())) {
    reasons.push('notification_too_stale');
    return { score: 0, fatal: true };
  }
  reasons.push('observed_within_window');
  return { score: 15, fatal: false };
}

/**
 * Evaluate one candidate order against one notification.
 *
 * `candidateCount` is how many pending orders of this exact amount existed when
 * the notification arrived. Passing it in (rather than computing it here) keeps
 * this function pure and testable.
 */
export function assessNotification(
  order: RiskOrderFacts,
  note: RiskNotificationFacts,
  candidateCount: number,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskAssessment {
  const reasons: string[] = [];
  const signals: Record<string, unknown> = {};

  const amountScore = scoreAmount(order, note, reasons);
  if (amountScore === 0) {
    return {
      decision: 'reject',
      confidence: 0,
      reasons,
      signals: { ...signals, candidateCount },
    };
  }

  const timing = scoreTiming(order, note, config, reasons);
  if (timing.fatal) {
    return {
      decision: 'reject',
      confidence: 0,
      reasons,
      signals: { ...signals, candidateCount },
    };
  }

  const confidence =
    amountScore +
    scoreUniqueness(candidateCount, reasons) +
    scoreReference(order, note, reasons) +
    timing.score;

  signals.candidateCount = candidateCount;
  signals.amountPaise = note.amountPaise;
  signals.expectedPaise = order.amountPaise;
  signals.hasReference = Boolean(note.bankReferenceNumber ?? note.bankReference);
  signals.hasSender = Boolean(note.senderVpa);

  /*
   * Ambiguity is never auto-approved, whatever else scored well. Two customers
   * paying the same amount in the same window cannot be told apart without a
   * reference, and guessing would grant a subscription to the wrong person.
   */
  if (candidateCount > 1) {
    return { decision: 'review', confidence: Math.min(confidence, config.reviewThreshold - 1), reasons, signals };
  }

  if (confidence >= config.approveThreshold) return { decision: 'approve', confidence, reasons, signals };
  if (confidence >= config.reviewThreshold) return { decision: 'review', confidence, reasons, signals };
  return { decision: 'reject', confidence, reasons, signals };
}

/**
 * Screen an inbound message that has no order context yet.
 *
 * Rejects the obvious abuse cases before they reach the matching engine: a
 * notification that claims to be from ourselves, or one that is implausibly
 * large. These are logged rather than silently dropped.
 */
export function screenNotification(
  note: RiskNotificationFacts,
  options: { payeeVpa: string; maxAmountPaise: number },
): { ok: boolean; reason?: string } {
  if (note.amountPaise === null) return { ok: false, reason: 'amount_unparseable' };
  if (note.amountPaise <= 0) return { ok: false, reason: 'amount_non_positive' };
  if (note.amountPaise > options.maxAmountPaise) return { ok: false, reason: 'amount_above_limit' };

  // A "credit" whose sender is our own collection VPA is not a customer payment.
  if (note.senderVpa && note.senderVpa.toLowerCase() === options.payeeVpa.toLowerCase()) {
    return { ok: false, reason: 'sender_is_payee' };
  }
  return { ok: true };
}
