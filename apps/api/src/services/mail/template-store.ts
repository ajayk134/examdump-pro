/**
 * Template storage.
 *
 * Two sources of truth, one lookup:
 *   - built-in transactional templates rendered in code (`templates.ts`),
 *   - database rows in `email_templates` that override them by key.
 *
 * An admin edit therefore never breaks a flow the codebase depends on: if a row
 * exists and is enabled it wins, otherwise the shipped template is used.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { emailTemplates } from '../../db/schema/index.js';
import type { EmailTemplate } from '../../db/schema/platform.js';
import { brandContext } from './mail.service.js';
import type { Env } from '../../config/env.js';
import { renderTemplate, htmlToText } from './placeholders.js';
import type { MailTemplateName } from './render.js';

/** Placeholders available to every transactional template. */
export const TRANSACTIONAL_VARIABLES = [
  'name',
  'email',
  'plan',
  'expiry_date',
  'account_url',
  'dashboard_url',
  'exams_url',
  'verify_url',
  'reset_url',
  'unsubscribe_url',
  'support_email',
  'product_name',
  'web_url',
];

export interface TemplateOverride {
  subject: string;
  html: string;
  text: string;
}

/**
 * Load an enabled override row for a template key.
 *
 * Returns null when there is no override, which means "use the built-in".
 */
export async function loadTemplateOverride(key: string): Promise<TemplateOverride | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.key, key))
    .limit(1);
  if (!row || !row.enabled || !row.body.trim()) return null;
  return { subject: row.subject, html: row.body, text: row.textBody };
}

/**
 * Render an override into final content.
 *
 * `values` supplies the placeholder data; anything the caller does not provide
 * falls back to a sensible default so a partial override still renders.
 */
export function renderOverride(
  env: Env,
  override: TemplateOverride,
  values: Record<string, string | number | null | undefined>,
): { subject: string; html: string; text: string } {
  const brand = brandContext(env);
  const base: Record<string, string | number | null | undefined> = {
    support_email: brand.supportEmail,
    product_name: brand.productName ?? 'ExamDump',
    web_url: brand.webUrl,
    dashboard_url: `${brand.webUrl}/dashboard`,
    exams_url: `${brand.webUrl}/exams`,
    account_url: `${brand.webUrl}/profile`,
    unsubscribe_url: '',
    ...values,
  };

  const subject = renderTemplate(override.subject, base, { html: false, strict: false });
  const html = renderTemplate(override.html, base, { html: true, strict: false });
  const text = override.text.trim()
    ? renderTemplate(override.text, base, { html: false, strict: false })
    : htmlToText(html);
  return { subject, html, text };
}

/** Upsert a template row (used by admin edits and by seeding). */
export async function saveTemplate(input: {
  key: string;
  subject: string;
  body: string;
  textBody?: string;
  description?: string;
  category?: 'transactional' | 'marketing';
  variables?: string[];
  isSystem?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}): Promise<EmailTemplate> {
  const db = getDb();
  const [row] = await db
    .insert(emailTemplates)
    .values({
      key: input.key,
      subject: input.subject,
      body: input.body,
      textBody: input.textBody ?? '',
      description: input.description ?? '',
      category: input.category ?? 'transactional',
      variables: input.variables ?? [],
      isSystem: input.isSystem ?? false,
      enabled: input.enabled ?? true,
    })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: {
        subject: input.subject,
        body: input.body,
        textBody: input.textBody ?? '',
        description: input.description ?? '',
        category: input.category ?? 'transactional',
        variables: input.variables ?? [],
        enabled: input.enabled ?? true,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row as EmailTemplate;
}

export async function deleteTemplate(key: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ isSystem: emailTemplates.isSystem })
    .from(emailTemplates)
    .where(eq(emailTemplates.key, key))
    .limit(1);
  // A row backing a built-in flow must not be deleted; disable it instead.
  if (!existing || existing.isSystem) return false;
  await db.delete(emailTemplates).where(eq(emailTemplates.key, key));
  return true;
}

/**
 * Seed rows for the built-in templates so admins can see and edit them.
 *
 * Idempotent: existing rows are left completely untouched, so an operator's
 * edits are never overwritten by a deploy.
 */
export async function seedSystemTemplates(): Promise<number> {
  const db = getDb();
  const existing = await db.select({ key: emailTemplates.key }).from(emailTemplates);
  const have = new Set(existing.map((row) => row.key));
  const want: Array<{ key: MailTemplateName; name: string; description: string; variables: string[] }> = [
    { key: 'email_verify', name: 'Email verification', description: 'Sent on signup and resend.', variables: ['name', 'verify_url'] },
    { key: 'password_reset', name: 'Password reset', description: 'Sent from the forgot-password flow.', variables: ['name', 'reset_url'] },
    { key: 'welcome', name: 'Welcome', description: 'Sent once the address is verified.', variables: ['name', 'exams_url'] },
    { key: 'login_alert', name: 'New sign-in alert', description: 'Security notice on a new login.', variables: ['name', 'account_url'] },
    { key: 'password_changed', name: 'Password changed', description: 'Security notice after a password change.', variables: ['name', 'reset_url'] },
    { key: 'account_notice', name: 'Account notice', description: 'Generic account notification.', variables: ['name', 'account_url'] },
    { key: 'subscription_activated', name: 'Subscription activated', description: 'Plan upgrades.', variables: ['name', 'plan', 'expiry_date'] },
    { key: 'subscription_expiring', name: 'Subscription expiring', description: 'Renewal reminder.', variables: ['name', 'plan', 'expiry_date'] },
    { key: 'subscription_cancelled', name: 'Subscription cancelled', description: 'Plan ended.', variables: ['name', 'plan', 'expiry_date'] },
    { key: 'support_received', name: 'Support acknowledgement', description: 'Reply to a support enquiry.', variables: ['name', 'email'] },
  ];

  let created = 0;
  for (const item of want) {
    if (have.has(item.key)) continue;
    await db
      .insert(emailTemplates)
      .values({
        key: item.key,
        subject: '',
        // Empty body means "use the built-in renderer" until an admin edits it.
        body: '',
        description: item.description,
        category: 'transactional',
        variables: item.variables,
        isSystem: true,
        enabled: false,
      })
      .onConflictDoNothing();
    created += 1;
  }
  return created;
}
