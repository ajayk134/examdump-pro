/**
 * Outbound message headers.
 *
 * Receiving providers weight a set of standard headers heavily when deciding
 * whether a message is automated transactional mail or bulk marketing. Getting
 * them right is one of the few deliverability levers fully in our control.
 *
 * What each one does:
 *
 *  - `Auto-Submitted: auto-generated` (RFC 3834) marks the message as machine
 *    generated, which suppresses vacation/auto-reply loops and is a recognised
 *    transactional signal.
 *  - `X-Auto-Response-Suppress: OOF, AutoReply` stops Exchange/Outlook auto
 *    replies to a no-reply address.
 *  - `Precedence: bulk` is used only for *marketing*: it tells filters the mail
 *    is list traffic, which is honest and expected. Transactional mail must NOT
 *    carry it, because filters deprioritise `Precedence: bulk` messages.
 *  - `Feedback-ID` lets a provider attribute complaints to us through Gmail's
 *    feedback loop. Only useful when the sending domain is ours, but harmless
 *    and informative otherwise.
 *  - `List-Id` / `List-Unsubscribe` are required by many providers for bulk and
 *    make the native unsubscribe button appear.
 *  - A stable `Message-ID` on a domain we control reads better than relying on
 *    the relay to invent one, and keeps threading consistent.
 */

export type HeaderCategory = 'transactional' | 'marketing';

export interface HeaderInput {
  category: HeaderCategory;
  /** Public web origin, used to form a stable Message-ID and List-Id. */
  webUrl: string;
  /** Product name for List-Id, e.g. "ExamDump". */
  productName: string;
  /** Our own address, used as the List-Id contact. */
  supportEmail: string;
  /** Queue row id; makes the Message-ID stable across retries. */
  messageKey: string;
  /** Only for marketing. */
  unsubscribeUrl?: string;
  /** Optional correlation id surfaced to support tooling. */
  referenceId?: string;
}

/**
 * Build the header block for one message.
 *
 * Deterministic: the same `messageKey` always produces the same Message-ID, so a
 * retried message is recognisable as the same message rather than a new one.
 */
export function buildMailHeaders(input: HeaderInput): Record<string, string> {
  let host = 'examdump.invalid';
  try {
    host = new URL(input.webUrl).hostname || host;
  } catch {
    // Keep the fallback: a malformed PUBLIC_WEB_URL must not break sending.
  }

  const headers: Record<string, string> = {
    /**
     * Mark machine-generated mail so other systems do not auto-reply. This is a
     * standard transactional signal and costs nothing.
     */
    'Auto-Submitted': 'auto-generated',
    'X-Auto-Response-Suppress': 'OOF, AutoReply',
    /**
     * Identifies us to Gmail's feedback loop / bulk-sender tooling. Format is
     * `<campaign>:<customer>:<mailtype>:<sender-id>`.
     */
    'Feedback-ID': `${input.category}:${input.productName.toLowerCase()}:${input.messageKey}@${host}`,
  };

  if (input.referenceId) headers['X-Entity-Ref-ID'] = input.referenceId;

  if (input.category === 'marketing') {
    // Honest classification for list traffic. Deliberately absent on
    // transactional mail, which filters treat with more urgency.
    headers['Precedence'] = 'bulk';
    headers['List-Id'] = `${input.productName} <updates.${host}>`;
    if (input.unsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
  }

  return headers;
}
