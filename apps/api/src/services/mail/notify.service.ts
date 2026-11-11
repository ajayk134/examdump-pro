/**
 * ExamDump Mail — application-level notifications.
 *
 * One entry point per business event, so call sites never assemble HTML or
 * decide policy. Each helper:
 *
 *   1. renders the template from typed data (escaping handled downstream),
 *   2. applies consent/suppression policy,
 *   3. writes a durable `email_queue` row (never sends inline).
 *
 * A `dedupeKey` marks messages that must be sent at most once per user/period,
 * which is what stops the reminder cron double-sending.
 */
import type { Env } from '../../config/env.js';
import { brandContext, type MailLogger } from './mail.service.js';
import { renderMail, type MailTemplateName, type TemplateData } from './render.js';
import { enqueueEmail, type EnqueueResult } from './queue.service.js';
import { checkRecipientPolicy, type MailCategory, type PreferenceKey } from './policy.service.js';
import { unsubscribeUrl } from './unsubscribe.js';

export interface NotifyInput {
  env: Env;
  template: MailTemplateName;
  data: TemplateData;
  to: string;
  userId?: string | null;
  category?: MailCategory;
  preference?: PreferenceKey;
  /** Scheduled delivery time; defaults to now. */
  scheduledFor?: Date;
  /** At-most-once guard. */
  dedupeKey?: string | null;
  referenceId?: string | null;
  metadata?: Record<string, unknown>;
  logger?: MailLogger;
  /** Skip policy checks (admin test send only). */
  isTest?: boolean;
}

export interface NotifyResult extends EnqueueResult {
  /** Why nothing was queued, when applicable. */
  skippedReason?: string;
}

/**
 * Render, check policy and enqueue a message.
 *
 * Returns `queued: false` with a reason rather than throwing when policy
 * blocks the send: being unable to email someone is a normal outcome, not an
 * error, and the caller must not fail its own operation because of it.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const category: MailCategory = input.category ?? 'transactional';

  const policy = await checkRecipientPolicy({
    email: input.to,
    category,
    userId: input.userId,
    preference: input.preference,
    isTest: input.isTest,
  });
  if (!policy.allowed) {
    input.logger?.info(
      { to: input.to, template: input.template, reason: policy.reason },
      'mail.not_queued_policy',
    );
    return { queued: false, skippedReason: policy.reason };
  }

  const brand = brandContext(input.env);
  let content;
  try {
    content = renderMail(input.template, brand, input.data, input.env);
  } catch (err) {
    input.logger?.error({ err, template: input.template }, 'mail.render_failed');
    return { queued: false, skippedReason: 'render_failed' };
  }

  return enqueueEmail({
    to: input.to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    template: input.template,
    category,
    userId: input.userId,
    scheduledFor: input.scheduledFor,
    dedupeKey: input.dedupeKey,
    referenceId: input.referenceId,
    metadata: { ...input.metadata, preference: input.preference },
    maxAttempts: input.env.MAIL_MAX_ATTEMPTS,
  });
}

/* ------------------------------ helpers ------------------------------- */

export function notifyVerification(
  env: Env,
  args: { to: string; userId?: string; name?: string; verifyUrl: string; logger?: MailLogger },
) {
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: 'email_verify',
    data: { name: args.name, verifyUrl: args.verifyUrl, expiresInHours: 24 },
    referenceId: args.userId,
    metadata: { kind: 'verification' },
    logger: args.logger,
  });
}

export function notifyPasswordReset(
  env: Env,
  args: { to: string; userId?: string; name?: string; resetUrl: string; logger?: MailLogger },
) {
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: 'password_reset',
    data: { name: args.name, resetUrl: args.resetUrl, expiresInMinutes: 60 },
    referenceId: args.userId,
    metadata: { kind: 'password_reset' },
    logger: args.logger,
  });
}

export function notifyWelcome(
  env: Env,
  args: { to: string; userId?: string; name?: string; examsUrl?: string; logger?: MailLogger },
) {
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: 'welcome',
    data: { name: args.name, examsUrl: args.examsUrl ?? `${env.PUBLIC_WEB_URL}/exams`, freeQuestions: 15 },
    dedupeKey: args.userId ? `welcome:${args.userId}` : null,
    referenceId: args.userId,
    metadata: { kind: 'welcome' },
    logger: args.logger,
  });
}

/**
 * New sign-in alert.
 *
 * Deduped per hour so a user opening several tabs, or an automated re-login,
 * does not generate a flood that trains them to ignore security mail.
 */
export function notifyLoginAlert(
  env: Env,
  args: {
    to: string;
    userId?: string;
    name?: string;
    when: Date;
    ip?: string;
    device?: string;
    logger?: MailLogger;
  },
) {
  const hour = args.when.toISOString().slice(0, 13);
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: 'login_alert',
    preference: 'securityAlerts',
    data: {
      name: args.name,
      when: args.when.toUTCString(),
      ip: args.ip,
      device: args.device,
      securityUrl: `${env.PUBLIC_WEB_URL}/profile`,
    },
    dedupeKey: args.userId ? `login_alert:${args.userId}:${hour}` : null,
    referenceId: args.userId,
    metadata: { kind: 'login_alert' },
    logger: args.logger,
  });
}

export function notifyPasswordChanged(
  env: Env,
  args: { to: string; userId?: string; name?: string; when: Date; logger?: MailLogger },
) {
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: 'password_changed',
    preference: 'securityAlerts',
    data: {
      name: args.name,
      when: args.when.toUTCString(),
      resetUrl: `${env.PUBLIC_WEB_URL}/forgot-password`,
    },
    referenceId: args.userId,
    metadata: { kind: 'password_changed' },
    logger: args.logger,
  });
}

export function notifyAccountNotice(
  env: Env,
  args: {
    to: string;
    userId?: string;
    name?: string;
    heading: string;
    body: string;
    ctaLabel?: string;
    ctaUrl?: string;
    dedupeKey?: string | null;
    logger?: MailLogger;
  },
) {
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: 'account_notice',
    data: {
      name: args.name,
      heading: args.heading,
      body: args.body,
      ctaLabel: args.ctaLabel,
      ctaUrl: args.ctaUrl,
    },
    dedupeKey: args.dedupeKey ?? null,
    referenceId: args.userId,
    metadata: { kind: 'account_notice' },
    logger: args.logger,
  });
}

export function notifySupportReceived(
  env: Env,
  args: {
    to: string;
    userId?: string;
    name?: string;
    reference: string;
    subject: string;
    message: string;
    logger?: MailLogger;
  },
) {
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: 'support_received',
    data: {
      name: args.name,
      reference: args.reference,
      subject: args.subject,
      message: args.message,
    },
    dedupeKey: `support_received:${args.reference}`,
    referenceId: args.reference,
    metadata: { kind: 'support_received' },
    logger: args.logger,
  });
}

/** Subscription lifecycle notices (activated / renewed / expiring / cancelled). */
export function notifySubscription(
  env: Env,
  args: {
    to: string;
    userId?: string;
    name?: string;
    kind: 'activated' | 'renewed' | 'expiring' | 'cancelled';
    dateLabel?: string;
    dateValue?: string;
    /** Period key for dedupe, e.g. `2025-11` or the expiry date. */
    periodKey: string;
    logger?: MailLogger;
  },
) {
  const preference: PreferenceKey | undefined =
    args.kind === 'expiring' || args.kind === 'cancelled' ? 'subscriptionReminders' : undefined;
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: `subscription_${args.kind}` as MailTemplateName,
    preference,
    data: {
      name: args.name,
      kind: args.kind,
      dateLabel: args.dateLabel,
      dateValue: args.dateValue,
      manageUrl: `${env.PUBLIC_WEB_URL}/pricing`,
    },
    // A reminder must never be sent twice for the same period.
    dedupeKey: args.userId ? `sub_${args.kind}:${args.userId}:${args.periodKey}` : null,
    referenceId: args.userId,
    metadata: { kind: `subscription_${args.kind}` },
    logger: args.logger,
  });
}

/** Marketing announcement, respecting opt-in and supplying an unsubscribe link. */
export function notifyAnnouncement(
  env: Env,
  args: {
    to: string;
    userId: string;
    name?: string;
    title: string;
    body: string;
    ctaLabel?: string;
    ctaUrl?: string;
    dedupeKey?: string | null;
    logger?: MailLogger;
  },
) {
  return notify({
    env,
    to: args.to,
    userId: args.userId,
    template: 'announcement',
    category: 'marketing',
    preference: 'productUpdates',
    data: {
      name: args.name,
      title: args.title,
      body: args.body,
      ctaLabel: args.ctaLabel,
      ctaUrl: args.ctaUrl,
      unsubscribeUrl: unsubscribeUrl(env, args.to, args.userId),
    },
    dedupeKey: args.dedupeKey ?? null,
    referenceId: args.userId,
    metadata: { kind: 'announcement' },
    logger: args.logger,
  });
}
