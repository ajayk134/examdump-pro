/**
 * Template dispatcher for ExamDump Mail.
 *
 * Keeps the typed mapping between a template name and its data in one place so
 * `sendTransactionalMail` stays generic and callers get compile-time checked
 * payloads.
 */
import type { Env } from '../../config/env.js';
import {
  accountNoticeEmail,
  announcementEmail,
  loginAlertEmail,
  passwordChangedEmail,
  paymentReceiptEmail,
  passwordResetEmail,
  refundProcessedEmail,
  supportReceivedEmail,
  subscriptionNoticeEmail,
  testEmail,
  verificationEmail,
  welcomeEmail,
  type BrandContext,
  type EmailContent,
  type ReceiptLine,
} from './templates.js';

export type MailTemplateName =
  | 'email_verify'
  | 'password_reset'
  | 'welcome'
  | 'payment_receipt'
  | 'subscription_activated'
  | 'subscription_renewed'
  | 'subscription_expiring'
  | 'subscription_cancelled'
  | 'refund_processed'
  | 'login_alert'
  | 'password_changed'
  | 'account_notice'
  | 'support_received'
  | 'announcement'
  | 'test';

export interface TemplateData {
  name?: string;

  /* verification / reset */
  verifyUrl?: string;
  resetUrl?: string;
  expiresInHours?: number;
  expiresInMinutes?: number;

  /* welcome */
  examsUrl?: string;
  freeQuestions?: number;

  /* receipt */
  invoiceNumber?: string;
  amount?: string;
  planName?: string;
  paidAt?: string;
  method?: string;
  invoiceUrl?: string;
  lines?: ReceiptLine[];
  reference?: string;

  /* subscription */
  kind?: 'activated' | 'renewed' | 'expiring' | 'cancelled';
  dateLabel?: string;
  dateValue?: string;
  manageUrl?: string;
  note?: string;

  /* refund */
  reason?: string;

  /* security alerts */
  when?: string;
  ip?: string;
  device?: string;
  location?: string;
  securityUrl?: string;

  /* account notice / announcement */
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  title?: string;
  message?: string;
  /* support enquiry subject */
  subject?: string;
  unsubscribeUrl?: string;

  /* test */
  sentAt?: string;
}

function require(value: string | undefined, field: string, template: string): string {
  if (!value) {
    throw new Error(`Mail template "${template}" is missing required field "${field}".`);
  }
  return value;
}

/**
 * Render a named template. Throws only on programming errors (a required field
 * was not supplied); the send path turns that into a failed log entry.
 */
export function renderMail(
  template: MailTemplateName,
  brand: BrandContext,
  data: TemplateData,
  env: Env,
): EmailContent {
  switch (template) {
    case 'email_verify':
      return verificationEmail(brand, {
        name: data.name,
        verifyUrl: require(data.verifyUrl, 'verifyUrl', template),
        expiresInHours: data.expiresInHours,
      });

    case 'password_reset':
      return passwordResetEmail(brand, {
        name: data.name,
        resetUrl: require(data.resetUrl, 'resetUrl', template),
        expiresInMinutes: data.expiresInMinutes,
      });

    case 'welcome':
      return welcomeEmail(brand, {
        name: data.name,
        examsUrl: data.examsUrl,
        freeQuestions: data.freeQuestions,
      });

    case 'payment_receipt':
      return paymentReceiptEmail(brand, {
        name: data.name,
        invoiceNumber: require(data.invoiceNumber, 'invoiceNumber', template),
        amount: require(data.amount, 'amount', template),
        planName: require(data.planName, 'planName', template),
        paidAt: require(data.paidAt, 'paidAt', template),
        method: data.method,
        invoiceUrl: data.invoiceUrl,
        lines: data.lines,
        reference: data.reference,
      });

    case 'subscription_activated':
    case 'subscription_renewed':
    case 'subscription_expiring':
    case 'subscription_cancelled':
      return subscriptionNoticeEmail(brand, {
        name: data.name,
        kind: template.replace('subscription_', '') as 'activated' | 'renewed' | 'expiring' | 'cancelled',
        planName: require(data.planName, 'planName', template),
        dateLabel: data.dateLabel ?? 'Date',
        dateValue: require(data.dateValue, 'dateValue', template),
        manageUrl: data.manageUrl ?? `${brand.webUrl}/profile`,
        note: data.note,
      });

    case 'refund_processed':
      return refundProcessedEmail(brand, {
        name: data.name,
        amount: require(data.amount, 'amount', template),
        reference: require(data.reference, 'reference', template),
        reason: data.reason,
      });

    case 'login_alert':
      return loginAlertEmail(brand, {
        name: data.name,
        when: require(data.when, 'when', template),
        ip: data.ip,
        device: data.device,
        location: data.location,
        securityUrl: require(data.securityUrl, 'securityUrl', template),
      });

    case 'password_changed':
      return passwordChangedEmail(brand, {
        name: data.name,
        when: require(data.when, 'when', template),
        resetUrl: require(data.resetUrl, 'resetUrl', template),
      });

    case 'account_notice':
      return accountNoticeEmail(brand, {
        name: data.name,
        heading: require(data.heading, 'heading', template),
        body: require(data.body, 'body', template),
        ctaLabel: data.ctaLabel,
        ctaUrl: data.ctaUrl,
      });

    case 'support_received':
      return supportReceivedEmail(brand, {
        name: data.name,
        reference: require(data.reference, 'reference', template),
        subject: require(data.subject, 'subject', template),
        message: require(data.message, 'message', template),
      });

    case 'announcement':
      return announcementEmail(brand, {
        name: data.name,
        title: require(data.title, 'title', template),
        body: require(data.body, 'body', template),
        ctaLabel: data.ctaLabel,
        ctaUrl: data.ctaUrl,
        unsubscribeUrl: require(data.unsubscribeUrl, 'unsubscribeUrl', template),
      });

    case 'test':
      return testEmail(brand, {
        sentAt: data.sentAt ?? new Date().toISOString(),
      });

    default: {
      // Exhaustiveness guard: adding a template without wiring it here (or
      // adding it to the DB enum without wiring the template) fails loudly.
      const never: never = template;
      throw new Error(`Unknown mail template: ${String(never)} (env ${env.NODE_ENV})`);
    }
  }
}
