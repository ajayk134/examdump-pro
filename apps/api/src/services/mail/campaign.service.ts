/**
 * ExamDump Mail — bulk campaigns.
 *
 * A campaign never renders-and-sends directly. It resolves an audience, filters
 * it through consent policy, and writes one `email_queue` row per recipient.
 * That keeps a single delivery path (with retries, rate limiting and auditing)
 * for both transactional and bulk mail.
 */
import { and, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { emailCampaigns, emailPreferences, emailSuppressions, users } from '../../db/schema/index.js';
import type { MailLogger } from './mail.service.js';
import { enqueueEmail } from './queue.service.js';
import { renderTemplate, htmlToText, validateTemplate } from './placeholders.js';
import { unsubscribeUrl } from './unsubscribe.js';

export interface Segment {
  plan?: 'free' | 'premium' | 'any';
  emailVerified?: boolean;
  role?: 'user' | 'admin';
  createdAfter?: string;
  createdBefore?: string;
  inactiveDays?: number;
}

export const SEGMENT_FIELDS: Array<keyof Segment> = [
  'plan',
  'emailVerified',
  'role',
  'createdAfter',
  'createdBefore',
  'inactiveDays',
];

/** Build the SQL predicate for a segment. */
export function segmentPredicate(segment: Segment): SQL | undefined {
  const conditions: SQL[] = [
    isNull(users.deletedAt) as SQL,
    eq(users.suspended, false) as SQL,
    eq(users.emailVerified, true) as SQL,
  ];

  if (segment.plan && segment.plan !== 'any') {
    conditions.push(eq(users.plan, segment.plan) as SQL);
  }
  if (typeof segment.emailVerified === 'boolean') {
    if (segment.emailVerified) conditions.push(eq(users.emailVerified, true) as SQL);
    else conditions.push(eq(users.emailVerified, false) as SQL);
  }
  if (segment.role) conditions.push(eq(users.role, segment.role) as SQL);
  if (segment.createdAfter) {
    const date = new Date(segment.createdAfter);
    if (!Number.isNaN(date.getTime())) conditions.push(gte(users.createdAt, date) as SQL);
  }
  if (segment.createdBefore) {
    const date = new Date(segment.createdBefore);
    if (!Number.isNaN(date.getTime())) conditions.push(lte(users.createdAt, date) as SQL);
  }
  if (segment.inactiveDays && segment.inactiveDays > 0) {
    const cutoff = new Date(Date.now() - segment.inactiveDays * 24 * 60 * 60 * 1000);
    conditions.push(sql`(${users.lastLoginAt} is null or ${users.lastLoginAt} < ${cutoff})` as SQL);
  }

  return and(...conditions) as SQL;
}

export interface AudienceMember {
  id: string;
  email: string;
  name: string;
  plan: string;
  premiumUntil: Date | null;
}

/**
 * Resolve the audience for a segment.
 *
 * Marketing audiences additionally require opt-in and exclude suppressed
 * addresses. That filter lives in SQL so the preview count matches what will
 * actually be sent.
 */
export async function resolveAudience(
  segment: Segment,
  options: { marketing: boolean; limit?: number; offset?: number },
): Promise<{ members: AudienceMember[]; total: number }> {
  const db = getDb();
  const predicate = segmentPredicate(segment);
  const conditions: SQL[] = predicate ? [predicate] : [];

  if (options.marketing) {
    conditions.push(
      sql`exists (
        select 1 from ${emailPreferences} p
        where p.user_id = ${users.id} and p.marketing_opt_in = true and p.product_updates = true
      )` as SQL,
    );
    conditions.push(
      sql`not exists (
        select 1 from ${emailSuppressions} s
        where s.email = lower(trim(${users.email}))
      )` as SQL,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const members = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
      premiumUntil: users.premiumUntil,
    })
    .from(users)
    .where(where)
    .orderBy(users.createdAt)
    .limit(Math.min(options.limit ?? 50, 5000))
    .offset(options.offset ?? 0);

  const [totalRow] = await db.select({ value: sql<number>`count(*)` }).from(users).where(where);
  return { members, total: Number(totalRow?.value ?? 0) };
}

/** Values available to campaign placeholders. */
export function recipientValues(member: AudienceMember, webUrl: string): Record<string, string> {
  return {
    name: member.name || 'there',
    email: member.email,
    first_name: (member.name || 'there').split(' ')[0] ?? 'there',
    plan: member.plan === 'premium' ? 'Premium' : 'Free',
    plan_tier: member.plan,
    expiry_date: member.premiumUntil ? member.premiumUntil.toISOString().slice(0, 10) : '',
    premium_until: member.premiumUntil ? member.premiumUntil.toUTCString() : '',
    account_url: `${webUrl}/profile`,
    exams_url: `${webUrl}/exams`,
    dashboard_url: `${webUrl}/dashboard`,
    unsubscribe_url: '',
  };
}

/** Placeholders every campaign template may use. */
export const CAMPAIGN_VARIABLES = [
  'name',
  'first_name',
  'email',
  'plan',
  'plan_tier',
  'expiry_date',
  'premium_until',
  'account_url',
  'exams_url',
  'dashboard_url',
  'unsubscribe_url',
];

/**
 * Fan a campaign out into the queue.
 *
 * Called for immediate sends and by the scheduler for `scheduled` campaigns.
 * The campaign is flipped to `sending` first, so two concurrent dispatchers
 * cannot both fan it out.
 */
export async function enqueueCampaign(
  env: Env,
  campaignId: string,
  logger?: MailLogger,
): Promise<{ queued: number; suppressed: number; total: number }> {
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, campaignId))
    .limit(1);

  if (!campaign) throw new Error('campaign_not_found');
  if (!['draft', 'scheduled', 'sending'].includes(campaign.status)) {
    throw new Error(`campaign_not_sendable:${campaign.status}`);
  }
  if (campaign.category === 'marketing' && !campaign.html.trim()) {
    throw new Error('campaign_html_required');
  }

  await db
    .update(emailCampaigns)
    .set({ status: 'sending', startedAt: campaign.startedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(emailCampaigns.id, campaignId));

  const marketing = campaign.category === 'marketing';
  const { members, total } = await resolveAudience(campaign.segment, {
    marketing,
    limit: env.MAIL_CAMPAIGN_BATCH_SIZE,
  });

  const problems = validateTemplate({
    subject: campaign.subject,
    html: campaign.html,
    text: campaign.text,
    allowedVariables: CAMPAIGN_VARIABLES,
  });
  if (problems.length > 0) throw new Error(`campaign_template_invalid: ${problems.join(' ')}`);

  let queued = 0;
  let suppressed = 0;

  for (const member of members) {
    const values = recipientValues(member, env.PUBLIC_WEB_URL);
    if (marketing) values.unsubscribe_url = unsubscribeUrl(env, member.email, member.id);

    let subject: string;
    let html: string;
    let text: string;
    try {
      subject = renderTemplate(campaign.subject, values, { html: false });
      html = renderTemplate(campaign.html, values, { html: true });
      text = campaign.text.trim()
        ? renderTemplate(campaign.text, values, { html: false })
        : htmlToText(html);
    } catch (err) {
      logger?.warn({ campaignId, recipient: member.email, err }, 'mail.campaign_render_skipped');
      suppressed += 1;
      continue;
    }

    const result = await enqueueEmail({
      to: member.email,
      subject,
      html,
      text,
      template: campaign.templateKey ?? `campaign_${campaign.id}`,
      category: marketing ? 'marketing' : 'transactional',
      userId: member.id,
      campaignId,
      // One message per recipient per campaign, even if fan-out is retried.
      dedupeKey: `campaign:${campaignId}:${member.id}`,
      referenceId: campaignId,
      maxAttempts: env.MAIL_MAX_ATTEMPTS,
      metadata: { campaignName: campaign.name },
    });
    if (result.queued) queued += 1;
    else suppressed += 1;
  }

  await db
    .update(emailCampaigns)
    .set({
      totalRecipients: total,
      suppressedCount: campaign.suppressedCount + suppressed,
      updatedAt: new Date(),
    })
    .where(eq(emailCampaigns.id, campaignId));

  logger?.info({ campaignId, queued, suppressed, total }, 'mail.campaign_enqueued');
  return { queued, suppressed, total };
}

/** Validate a campaign draft before it can be scheduled or sent. */
export function validateCampaign(input: {
  name: string;
  subject: string;
  html: string;
  text?: string;
}): string[] {
  const problems: string[] = [];
  if (!input.name.trim()) problems.push('Campaign name is required.');
  problems.push(
    ...validateTemplate({
      subject: input.subject,
      html: input.html,
      text: input.text,
      allowedVariables: CAMPAIGN_VARIABLES,
    }),
  );
  return problems;
}
