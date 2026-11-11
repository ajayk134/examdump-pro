/**
 * Bridges a claimed queue row to the SMTP transport.
 *
 * Separated from the queue so the queue stays pure state management and this
 * file owns the decision "may this row actually be sent, and what happened".
 */
import type { Env } from '../../config/env.js';
import type { EmailQueueRow } from '../../db/schema/mail.js';
import { deliverRaw, type MailLogger } from './mail.service.js';
import { checkRecipientPolicy, type MailCategory } from './policy.service.js';
import { buildUnsubscribeHeaders } from './unsubscribe.js';

export interface SendOutcome {
  outcome: 'sent' | 'failed' | 'suppressed';
  messageId?: string;
  error?: string;
  retryable: boolean;
}

/**
 * Send one queued message.
 *
 * Policy is re-checked here rather than at enqueue time. That is intentional: a
 * user may unsubscribe (or a campaign may be cancelled) between the message
 * being queued and it being sent, and the send must respect the newer state.
 */
export async function sendRenderedMail(
  env: Env,
  row: EmailQueueRow,
  logger?: MailLogger,
): Promise<SendOutcome> {
  const category = row.category as MailCategory;

  const policy = await checkRecipientPolicy({
    email: row.recipient,
    category,
    userId: row.userId,
  });

  if (!policy.allowed) {
    logger?.info(
      { to: row.recipient, template: row.template, reason: policy.reason },
      'mail.skipped_policy',
    );
    return { outcome: 'suppressed', error: policy.reason ?? 'suppressed', retryable: false };
  }

  const headers =
    category === 'marketing' ? buildUnsubscribeHeaders(env, row.recipient, row.userId ?? undefined) : undefined;

  const result = await deliverRaw(env, {
    to: row.recipient,
    subject: row.subject,
    html: row.html,
    text: row.text,
    template: row.template,
    userId: row.userId,
    referenceId: row.referenceId,
    logger,
    headers,
  });

  if (result.delivered) {
    return { outcome: 'sent', messageId: result.messageId, retryable: false };
  }
  if (result.suppressed) {
    return { outcome: 'suppressed', error: result.error, retryable: false };
  }
  return { outcome: 'failed', error: result.error, retryable: result.retryable };
}
