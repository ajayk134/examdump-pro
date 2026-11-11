/**
 * Admin Email Center.
 *
 * Everything here requires the `admin` role. Mutating endpoints also write an
 * audit record, because "who sent that campaign to 4,000 people" must be
 * answerable afterwards.
 *
 * Delivery is always queued — no endpoint sends inline — so the same rate
 * limiting, retry and suppression rules apply to admin mail as to automatic mail.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, count, desc, eq, gte, ilike, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { getDb } from '../db/client.js';
import { emailCampaigns, emailQueue, emailSuppressions, emailTemplates, mailLogs, users } from '../db/schema/index.js';
import { requireAuth } from '../lib/guards.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parseOrThrow } from '../lib/validation.js';
import { recordAudit } from '../services/audit.service.js';
import { enqueueEmail } from '../services/mail/queue.service.js';
import { checkRecipientPolicy } from '../services/mail/policy.service.js';
import {
  cancelCampaignQueue,
  listQueue,
  queueHealth,
  queueStats,
  requeueFailed,
  updateCampaignCounters,
} from '../services/mail/queue.service.js';
import {
  CAMPAIGN_VARIABLES,
  enqueueCampaign,
  resolveAudience,
  validateCampaign,
  type Segment,
} from '../services/mail/campaign.service.js';
import {
  TRANSACTIONAL_VARIABLES,
  deleteTemplate,
  saveTemplate,
  seedSystemTemplates,
} from '../services/mail/template-store.js';
import { htmlToText, renderTemplate, validateTemplate } from '../services/mail/placeholders.js';
import { suppressAddress } from '../services/mail/policy.service.js';
import { workerState } from '../services/mail/worker.js';
import { renderMail, type MailTemplateName } from '../services/mail/render.js';
import { brandContext, mailConfigured } from '../services/mail/mail.service.js';

const segmentSchema = z.object({
  plan: z.enum(['free', 'premium', 'any']).optional(),
  emailVerified: z.boolean().optional(),
  role: z.enum(['user', 'admin']).optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
});

const templateSchema = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores.'),
  subject: z.string().max(200),
  body: z.string().max(200_000),
  textBody: z.string().max(200_000).optional(),
  description: z.string().max(500).optional(),
  category: z.enum(['transactional', 'marketing']).optional(),
  variables: z.array(z.string()).max(50).optional(),
  enabled: z.boolean().optional(),
});

const campaignSchema = z.object({
  name: z.string().min(2).max(120),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(200_000),
  text: z.string().max(200_000).optional(),
  templateKey: z.string().max(80).optional(),
  category: z.enum(['transactional', 'marketing']).optional(),
  segment: segmentSchema.optional(),
  scheduledFor: z.string().datetime().optional(),
});

/** Pagination helper shared by every list endpoint. */
function paging(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export async function adminEmailRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /**
   * Guard every route in this plugin.
   *
   * Applied once here rather than per-handler so a new endpoint cannot be
   * forgotten and silently exposed.
   */
  app.addHook('preHandler', async (request) => {
    const auth = await requireAuth(request, env);
    if (auth.user.role !== 'admin') throw notFound('Not found');
    (request as typeof request & { auth: typeof auth }).auth = auth;
  });

  /* ------------------------------ overview ------------------------------ */

  app.get('/email/overview', async () => {
    const db = getDb();
    const [stats, health] = await Promise.all([queueStats(), queueHealth()]);

    // 30-day delivery trend for the analytics panel.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const trend = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${emailQueue.createdAt}), 'YYYY-MM-DD')`,
        status: emailQueue.status,
        value: count(),
      })
      .from(emailQueue)
      .where(gte(emailQueue.createdAt, since))
      .groupBy(sql`date_trunc('day', ${emailQueue.createdAt})`, emailQueue.status)
      .orderBy(sql`date_trunc('day', ${emailQueue.createdAt})`);

    const campaigns = await db
      .select({
        total: count(),
        scheduled: sql<number>`count(*) filter (where ${emailCampaigns.status} = 'scheduled')`,
        sent: sql<number>`count(*) filter (where ${emailCampaigns.status} = 'sent')`,
        draft: sql<number>`count(*) filter (where ${emailCampaigns.status} = 'draft')`,
      })
      .from(emailCampaigns);

    const [deliveryRates] = await db
      .select({
        sent: sql<number>`count(*) filter (where ${mailLogs.status} = 'sent')`,
        failed: sql<number>`count(*) filter (where ${mailLogs.status} = 'failed')`,
        suppressed: sql<number>`count(*) filter (where ${mailLogs.status} = 'suppressed')`,
      })
      .from(mailLogs);

    const [suppressionCount] = await db.select({ value: count() }).from(emailSuppressions);

    return {
      queue: stats,
      health,
      worker: {
        enabled: env.MAIL_QUEUE_ENABLED,
        running: workerState.running,
        lastRunAt: workerState.lastRunAt,
        lastResult: workerState.lastResult,
        lastError: workerState.lastError,
        totalSent: workerState.totalSent,
        batchSize: env.MAIL_BATCH_SIZE,
        intervalSeconds: env.MAIL_WORKER_INTERVAL_SECONDS,
        hourlyLimit: env.MAIL_HOURLY_SEND_LIMIT,
      },
      configured: mailConfigured(env),
      campaigns: campaigns[0] ?? { total: 0, scheduled: 0, sent: 0, draft: 0 },
      delivery: deliveryRates ?? { sent: 0, failed: 0, suppressed: 0 },
      suppressions: Number(suppressionCount?.value ?? 0),
      trend,
    };
  });

  /* ------------------------------ templates ----------------------------- */

  app.get('/email/templates', async () => {
    const db = getDb();
    await seedSystemTemplates();
    const rows = await db.select().from(emailTemplates).orderBy(emailTemplates.category, emailTemplates.key);
    return { templates: rows };
  });

  app.post('/email/templates', async (request) => {
    const auth = (request as typeof request & { auth: Awaited<ReturnType<typeof requireAuth>> }).auth;
    const input = parseOrThrow(templateSchema, request.body);

    const problems = validateTemplate({
      subject: input.subject,
      html: input.body,
      text: input.textBody,
      allowedVariables: input.category === 'marketing' ? CAMPAIGN_VARIABLES : TRANSACTIONAL_VARIABLES,
    });
    if (problems.length > 0) throw badRequest(problems.join(' '), problems);

    const row = await saveTemplate({
      key: input.key,
      subject: input.subject,
      body: input.body,
      textBody: input.textBody,
      description: input.description,
      category: input.category,
      variables: input.variables ?? [],
      enabled: input.enabled ?? true,
      createdBy: auth.user.id,
    });
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.template_saved',
      targetType: 'email_template',
      targetId: input.key,
    });
    return { template: row };
  });

  app.delete('/email/templates/:key', async (request) => {
    const auth = (request as typeof request & { auth: Awaited<ReturnType<typeof requireAuth>> }).auth;
    const key = (request.params as { key: string }).key;
    const removed = await deleteTemplate(key);
    if (!removed) throw badRequest('Built-in templates cannot be deleted. Disable it instead.');
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.template_deleted',
      targetType: 'email_template',
      targetId: key,
    });
    return { deleted: true };
  });

  /**
   * Render a preview server-side.
   *
   * Sending back both HTML and the derived text lets the editor show exactly
   * what the recipient receives, including escaping, with no client-side
   * template engine to drift out of sync.
   */
  app.post('/email/preview', async (request) => {
    const input = parseOrThrow(
      z.object({
        subject: z.string().max(200),
        html: z.string().max(200_000),
        text: z.string().max(200_000).optional(),
        sample: z.record(z.string()).optional(),
      }),
      request.body,
    );

    const sample: Record<string, string> = {
      name: 'Alex Chen',
      first_name: 'Alex',
      email: 'alex@example.com',
      plan: 'Premium',
      plan_tier: 'premium',
      expiry_date: '2026-01-31',
      premium_until: 'Sat, 31 Jan 2026 00:00:00 GMT',
      account_url: `${env.PUBLIC_WEB_URL}/profile`,
      dashboard_url: `${env.PUBLIC_WEB_URL}/dashboard`,
      exams_url: `${env.PUBLIC_WEB_URL}/exams`,
      verify_url: `${env.PUBLIC_WEB_URL}/verify-email?token=sample`,
      reset_url: `${env.PUBLIC_WEB_URL}/reset-password?token=sample`,
      unsubscribe_url: `${env.PUBLIC_WEB_URL}/unsubscribe?sample=1`,
      support_email: 'examdump.official@gmail.com',
      product_name: 'ExamDump',
      web_url: env.PUBLIC_WEB_URL,
      ...(input.sample ?? {}),
    };

    try {
      const subject = renderTemplate(input.subject, sample, { html: false, strict: false });
      const html = renderTemplate(input.html, sample, { html: true, strict: false });
      const text = input.text?.trim()
        ? renderTemplate(input.text, sample, { html: false, strict: false })
        : htmlToText(html);
      return { subject, html, text };
    } catch (err) {
      throw badRequest(`Preview failed: ${(err as Error).message}`);
    }
  });

  /* ------------------------------ audience ------------------------------ */

  app.post('/email/audience', async (request) => {
    const input = parseOrThrow(
      z.object({ segment: segmentSchema.optional(), marketing: z.boolean().optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }),
      request.body,
    );
    const { members, total } = await resolveAudience(input.segment ?? {}, {
      marketing: input.marketing ?? true,
      limit: input.pageSize ?? 10,
    });
    return {
      total,
      sample: members.map((m) => ({ id: m.id, email: m.email, name: m.name, plan: m.plan })),
    };
  });

  /* ------------------------------ campaigns ----------------------------- */

  app.get('/email/campaigns', async (request) => {
    const db = getDb();
    const query = request.query as Record<string, string | undefined>;
    const { page, pageSize, offset } = paging(query);
    const conditions = [];
    if (query.status) conditions.push(eq(emailCampaigns.status, query.status as 'draft'));
    if (query.search) conditions.push(ilike(emailCampaigns.name, `%${query.search}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(emailCampaigns)
      .where(where)
      .orderBy(desc(emailCampaigns.createdAt))
      .limit(pageSize)
      .offset(offset);
    const [totalRow] = await db.select({ value: count() }).from(emailCampaigns).where(where);
    return { campaigns: rows, total: Number(totalRow?.value ?? 0), page, pageSize };
  });

  app.get('/email/campaigns/:id', async (request) => {
    const db = getDb();
    const id = (request.params as { id: string }).id;
    const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
    if (!campaign) throw notFound('Campaign not found.');
    const { rows } = await listQueue({ campaignId: id, limit: 20 });
    return { campaign, recent: rows };
  });

  app.post('/email/campaigns', async (request) => {
    const auth = (request as typeof request & { auth: Awaited<ReturnType<typeof requireAuth>> }).auth;
    const input = parseOrThrow(campaignSchema, request.body);

    const problems = validateCampaign({
      name: input.name,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (problems.length > 0) throw badRequest(problems.join(' '), problems);

    const db = getDb();
    const [row] = await db
      .insert(emailCampaigns)
      .values({
        name: input.name,
        subject: input.subject,
        html: input.html,
        text: input.text ?? '',
        templateKey: input.templateKey ?? null,
        category: input.category ?? 'marketing',
        status: input.scheduledFor ? 'scheduled' : 'draft',
        segment: input.segment ?? {},
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        createdBy: auth.user.id,
      })
      .returning();

    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.campaign_created',
      targetType: 'email_campaign',
      targetId: row?.id,
    });
    return { campaign: row };
  });

  app.patch('/email/campaigns/:id', async (request) => {
    const db = getDb();
    const id = (request.params as { id: string }).id;
    const input = parseOrThrow(campaignSchema.partial(), request.body);

    const [existing] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
    if (!existing) throw notFound('Campaign not found.');
    // A campaign that has started cannot be edited: some recipients already
    // received the old copy.
    if (!['draft', 'scheduled'].includes(existing.status)) {
      throw badRequest('Only draft or scheduled campaigns can be edited.');
    }

    const [row] = await db
      .update(emailCampaigns)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.html ? { html: input.html } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.segment ? { segment: input.segment } : {}),
        ...(input.scheduledFor !== undefined
          ? { scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null, status: input.scheduledFor ? 'scheduled' : 'draft' }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(emailCampaigns.id, id))
      .returning();
    return { campaign: row };
  });

  /** Send now: fan out into the queue. */
  app.post('/email/campaigns/:id/send', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const auth = (request as typeof request & { auth: Awaited<ReturnType<typeof requireAuth>> }).auth;
    const id = (request.params as { id: string }).id;

    let result;
    try {
      result = await enqueueCampaign(env, id, app.log);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.campaign_sent',
      targetType: 'email_campaign',
      targetId: id,
      metadata: result as unknown as Record<string, unknown>,
    });
    return { queued: result.queued, suppressed: result.suppressed, total: result.total };
  });

  app.post('/email/campaigns/:id/cancel', async (request) => {
    const auth = (request as typeof request & { auth: Awaited<ReturnType<typeof requireAuth>> }).auth;
    const db = getDb();
    const id = (request.params as { id: string }).id;
    const cancelled = await cancelCampaignQueue(id);
    await db
      .update(emailCampaigns)
      .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(emailCampaigns.id, id));
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.campaign_cancelled',
      targetType: 'email_campaign',
      targetId: id,
      metadata: { cancelled },
    });
    return { cancelled };
  });

  /** Recompute counters after the queue drains (also called by the worker). */
  app.post('/email/campaigns/:id/refresh', async (request) => {
    await updateCampaignCounters((request.params as { id: string }).id);
    const db = getDb();
    const [campaign] = await db
      .select()
      .from(emailCampaigns)
      .where(eq(emailCampaigns.id, (request.params as { id: string }).id))
      .limit(1);
    return { campaign };
  });

  /* -------------------------- direct / test send ------------------------ */

  /**
   * Send a single message to one address.
   *
   * Used for "test send" and for one-off admin mail. The recipient is always
   * explicit: there is no "send to everyone" shortcut here, that is a campaign.
   */
  app.post('/email/send-one', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request) => {
    const auth = (request as typeof request & { auth: Awaited<ReturnType<typeof requireAuth>> }).auth;
    const input = parseOrThrow(
      z.object({
        to: z.string().email(),
        subject: z.string().min(1).max(200),
        html: z.string().min(1).max(200_000),
        text: z.string().max(200_000).optional(),
        isTest: z.boolean().optional(),
        template: z.string().max(60).optional(),
      }),
      request.body,
    );

    const db = getDb();
    const [target] = await db.select().from(users).where(eq(users.email, input.to.toLowerCase())).limit(1);

    const text = input.text?.trim() ? input.text : htmlToText(input.html);

    // Admin-authored HTML is queued directly: it is not a named template, and it
    // still goes through the same suppression check and rate limits.
    const policy = await checkRecipientPolicy({
      email: input.to,
      category: 'transactional',
      userId: target?.id ?? null,
      isTest: input.isTest ?? false,
    });
    if (!policy.allowed) {
      throw badRequest(`Cannot send to this address: ${policy.reason ?? 'blocked'}.`);
    }

    const queued = await enqueueEmail({
      to: input.to,
      subject: input.subject,
      html: input.html,
      text,
      template: input.template ?? 'admin_direct',
      category: 'transactional',
      userId: target?.id ?? null,
      referenceId: auth.user.id,
      maxAttempts: env.MAIL_MAX_ATTEMPTS,
      metadata: { adminDirect: true, isTest: input.isTest ?? false },
    });

    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.direct_send',
      targetType: 'email',
      targetId: input.to,
      metadata: { isTest: input.isTest ?? false, queued: queued.queued },
    });
    return { queued: queued.queued, id: queued.id };
  });

  /** Render a built-in transactional template with sample data. */
  app.get('/email/templates/:key/preview', async (request) => {
    const key = (request.params as { key: string }).key;
    const brand = brandContext(env);
    const data = {
      name: 'Alex Chen',
      verifyUrl: `${env.PUBLIC_WEB_URL}/verify-email?token=sample`,
      resetUrl: `${env.PUBLIC_WEB_URL}/reset-password?token=sample`,
      examsUrl: `${env.PUBLIC_WEB_URL}/exams`,
      when: new Date().toUTCString(),
      securityUrl: `${env.PUBLIC_WEB_URL}/profile`,
      heading: 'Account update',
      body: 'This is a sample account notification.',
      title: 'Announcement',
      reference: 'TKT-0001',
      subject: 'Support enquiry',
      message: 'Sample support message.',
      unsubscribeUrl: `${env.PUBLIC_WEB_URL}/unsubscribe?sample=1`,
    };
    try {
      const content = renderMail(key as MailTemplateName, brand, data, env);
      return { subject: content.subject, html: content.html, text: content.text };
    } catch {
      throw notFound('No built-in template with that key.');
    }
  });

  /* -------------------------------- queue ------------------------------- */

  app.get('/email/queue', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const { page, pageSize, offset } = paging(query);
    const { rows, total } = await listQueue({
      status: query.status as never,
      search: query.search,
      limit: pageSize,
      offset,
    });
    return { messages: rows, total, page, pageSize };
  });

  app.post('/email/queue/retry', async (request) => {
    const auth = (request as typeof request & { auth: Awaited<ReturnType<typeof requireAuth>> }).auth;
    const input = parseOrThrow(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }), request.body);
    const requeued = await requeueFailed(input.ids);
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.queue_retry',
      metadata: { requeued },
    });
    return { requeued };
  });

  /* ----------------------------- suppression ---------------------------- */

  app.get('/email/suppressions', async (request) => {
    const db = getDb();
    const query = request.query as Record<string, string | undefined>;
    const { page, pageSize, offset } = paging(query);
    const where = query.search ? ilike(emailSuppressions.email, `%${query.search}%`) : undefined;
    const rows = await db
      .select()
      .from(emailSuppressions)
      .where(where)
      .orderBy(desc(emailSuppressions.createdAt))
      .limit(pageSize)
      .offset(offset);
    const [totalRow] = await db.select({ value: count() }).from(emailSuppressions).where(where);
    return { suppressions: rows, total: Number(totalRow?.value ?? 0), page, pageSize };
  });

  app.post('/email/suppressions', async (request) => {
    const auth = (request as typeof request & { auth: Awaited<ReturnType<typeof requireAuth>> }).auth;
    const input = parseOrThrow(
      z.object({
        email: z.string().email(),
        reason: z.enum(['hard_bounce', 'complaint', 'unsubscribe_marketing', 'unsubscribe_all', 'manual']),
        scope: z.enum(['marketing', 'all']).optional(),
        note: z.string().max(500).optional(),
      }),
      request.body,
    );
    await suppressAddress({ ...input, createdBy: auth.user.id });
    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'email.suppressed',
      targetType: 'email',
      targetId: input.email,
      metadata: { reason: input.reason, scope: input.scope },
    });
    return { suppressed: true };
  });

  app.delete('/email/suppressions/:email', async (request) => {
    const db = getDb();
    const email = decodeURIComponent((request.params as { email: string }).email).toLowerCase();
    const rows = await db.delete(emailSuppressions).where(eq(emailSuppressions.email, email)).returning({ id: emailSuppressions.id });
    if (rows.length === 0) throw notFound('That address is not suppressed.');
    return { removed: true };
  });
}
