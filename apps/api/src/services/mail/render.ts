/**
 * Template dispatcher for ExamDump Mail.
 *
 * Keeps the typed mapping between a template name and its data in one place so
 * `sendTransactionalMail` stays generic and callers get compile-time checked
 * payloads.
 */
import type { Env } from '../../config/env.js';
import {
  paymentReceiptEmail,
  passwordResetEmail,
  refundProcessedEmail,
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
