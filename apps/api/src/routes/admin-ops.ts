/**
 * Administrative operations: bulk user actions, payment/subscription consoles,
 * webhook + reconciliation monitoring, announcements, broadcasts, support
 * tickets, feature flags and CSV exports.
 *
 * Every route is permission-gated through the RBAC permission set (admins have
 * all permissions) and writes an audit log entry.
 */
import type { FastifyInstance } from 'fastify';
import { mailLogs } from '../db/schema/index.js';
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  announcementsSchema,
  broadcastNotificationSchema,
  bulkActionSchema,
  adminPaymentListQuerySchema,
  adminSubscriptionListQuerySchema,
  adminAuditQuerySchema,
  supportTicketUpdateSchema,
  updatePlanAdminSchema,
  updateCouponAdminSchema,
  createCouponAdminSchema,
  createPlanAdminSchema,
} from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requirePermission } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { parsePage, paginate } from '../lib/pagination.js';
import { getDb } from '../db/client.js';
import {
  announcements,
  auditLogs,
  catalogExams,
  coupons,
  payments,
  plans,
  refunds,
  subscriptions,
  supportTickets,
  ticketMessages,
  users,
  webhookEvents,
  reconciliationRuns,
  featureFlags,
} from '../db/schema/index.js';
import { recordAudit } from '../services/audit.service.js';
import { createNotification } from '../services/notification.service.js';
import { reconcilePayments } from '../services/webhook.service.js';
import { refundPayment, recomputeUserPlan } from '../services/subscription.service.js';
import { checkoutReady, hyperswitchConfigured, webhookConfigured } from '../services/hyperswitch.client.js';
import { aiConfigured } from '../services/ai.service.js';
import { serializeUser } from '../lib/serializers.js';

const csvEscape = (value: unknown): string => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

export async function adminOpsRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /* ------------------------------------------------------------------ */
  /* Payment / subscription consoles                                     */
  /* ------------------------------------------------------------------ */

  app.get('/payments', async (request, reply) => {
    await requirePermission(request, env, 'payments.read');
    const query = parseOrThrow(adminPaymentListQuerySchema, request.query);
    const page = parsePage(query.page, query.pageSize);
    const db = getDb();

    const conditions = [];
    if (query.status) conditions.push(eq(payments.status, query.status as never));
    if (query.provider) conditions.push(eq(payments.provider, query.provider as never));
    if (query.from) conditions.push(gte(payments.createdAt, query.from));
    if (query.to) conditions.push(lte(payments.createdAt, query.to));
    if (query.q) {
      conditions.push(
        or(
          ilike(users.email, `%${query.q}%`),
          ilike(users.name, `%${query.q}%`),
          ilike(payments.orderRef, `%${query.q}%`),
          ilike(payments.providerPaymentId, `%${query.q}%`),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const orderBy =
      query.sort === 'oldest'
        ? payments.createdAt
        : query.sort === 'amount_desc'
          ? desc(payments.amountMinor)
          : query.sort === 'amount_asc'
            ? payments.amountMinor
            : desc(payments.createdAt);

    const [items, [totalRow]] = await Promise.all([
      db
        .select({
          payment: payments,
          userEmail: users.email,
          userName: users.name,
        })
        .from(payments)
        .leftJoin(users, eq(users.id, payments.userId))
        .where(where)
        .orderBy(orderBy)
        .offset(page.skip)
        .limit(page.limit),
      db
        .select({ value: count() })
        .from(payments)
        .leftJoin(users, eq(users.id, payments.userId))
        .where(where),
    ]);

    return reply.send(
      paginate(
        items.map((r) => ({ ...r.payment, userEmail: r.userEmail, userName: r.userName })),
        Number(totalRow?.value ?? 0),
        page,
      ),
    );
  });

  app.get('/subscriptions', async (request, reply) => {
    await requirePermission(request, env, 'subscriptions.read');
    const query = parseOrThrow(adminSubscriptionListQuerySchema, request.query);
    const page = parsePage(query.page, query.pageSize);
    const db = getDb();
    const conditions = [];
    if (query.status) conditions.push(eq(subscriptions.status, query.status as never));
    if (query.scope) conditions.push(eq(subscriptions.scope, query.scope));
    if (query.q) conditions.push(or(ilike(users.email, `%${query.q}%`), ilike(users.name, `%${query.q}%`))!);
    const where = conditions.length ? and(...conditions) : undefined;

    const [items, [totalRow]] = await Promise.all([
      db
        .select({ subscription: subscriptions, userEmail: users.email, userName: users.name })
        .from(subscriptions)
        .leftJoin(users, eq(users.id, subscriptions.userId))
        .where(where)
        .orderBy(desc(subscriptions.createdAt))
        .offset(page.skip)
        .limit(page.limit),
      db
        .select({ value: count() })
        .from(subscriptions)
        .leftJoin(users, eq(users.id, subscriptions.userId))
        .where(where),
    ]);
    return reply.send(
      paginate(
        items.map((r) => ({ ...r.subscription, userEmail: r.userEmail, userName: r.userName })),
        Number(totalRow?.value ?? 0),
        page,
      ),
    );
  });

  /* ------------------------------------------------------------------ */
  /* Webhooks + reconciliation                                           */
  /* ------------------------------------------------------------------ */

  app.get('/webhooks', async (request, reply) => {
    await requirePermission(request, env, 'payments.read');
    const query = request.query as { page?: string; pageSize?: string; status?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const db = getDb();
    const where = query.status ? eq(webhookEvents.status, query.status) : undefined;
    const [items, [totalRow]] = await Promise.all([
      db
        .select({
          id: webhookEvents.id,
          eventId: webhookEvents.eventId,
          eventType: webhookEvents.eventType,
          status: webhookEvents.status,
          signatureValid: webhookEvents.signatureValid,
          note: webhookEvents.note,
          processedAt: webhookEvents.processedAt,
          createdAt: webhookEvents.createdAt,
        })
        .from(webhookEvents)
        .where(where)
        .orderBy(desc(webhookEvents.createdAt))
        .offset(page.skip)
        .limit(page.limit),
      db.select({ value: count() }).from(webhookEvents).where(where),
    ]);
    return reply.send(paginate(items, Number(totalRow?.value ?? 0), page));
  });

  app.get('/webhooks/:id', async (request, reply) => {
    await requirePermission(request, env, 'payments.read');
    const { id } = request.params as { id: string };
    const [row] = await getDb().select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
    if (!row) throw notFound('Webhook event not found.');
    return reply.send({ event: row });
  });

  app.post('/webhooks/:id/replay', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'payments.manage');
    const { id } = request.params as { id: string };
    const { processWebhookEvent } = await import('../services/webhook.service.js');
    const [row] = await getDb().select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
    if (!row) throw notFound('Webhook event not found.');
    if (!row.signatureValid) throw badRequest('Refusing to replay an event with an invalid signature.');
    const result = await processWebhookEvent(env, row.id, row.payload as Record<string, unknown>);
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email ?? null,
      action: 'payment.webhook_received',
      targetType: 'webhook_event',
      targetId: row.id,
      metadata: { replay: true, result },
    });
    return reply.send({ result });
  });

  app.get('/reconciliation', async (request, reply) => {
    await requirePermission(request, env, 'payments.read');
    const db = getDb();
    const rows = await db
      .select()
      .from(reconciliationRuns)
      .orderBy(desc(reconciliationRuns.startedAt))
      .limit(50);
    const [pending] = await db
      .select({ value: count() })
      .from(payments)
      .where(eq(payments.status, 'pending'));
    return reply.send({ runs: rows, pendingPayments: Number(pending?.value ?? 0) });
  });

  app.post('/reconciliation/run', { config: { rateLimit: { max: 6, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'payments.read');
    if (!hyperswitchConfigured(env)) {
      throw badRequest('HyperSwitch is not configured; nothing to reconcile.');
    }
    const result = await reconcilePayments(env, `admin:${admin.email ?? admin.id}`);
    return reply.send({ result });
  });

  /* ------------------------------------------------------------------ */
  /* Announcements + broadcasts                                          */
  /* ------------------------------------------------------------------ */

  app.get('/announcements', async (request, reply) => {
    await requirePermission(request, env, 'notifications.send' as never).catch(async () => {
      await requirePermission(request, env, 'users.read');
      return { user: adminFallback() };
    });
    const rows = await getDb().select().from(announcements).orderBy(desc(announcements.createdAt)).limit(200);
    return reply.send({ announcements: rows });
  });

  app.post('/announcements', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'notifications.send');
    const input = parseOrThrow(announcementsSchema, request.body);
    const [row] = await getDb()
      .insert(announcements)
      .values({
        title: input.title,
        body: input.body,
        level: input.level,
        audience: input.audience,
        active: input.active,
        startsAt: new Date(),
        expiresAt: input.expiresAt ?? null,
        createdBy: admin.id,
      })
      .returning();
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'announcement.created',
      targetType: 'announcement',
      targetId: row!.id,
    });
    return reply.code(201).send({ announcement: row });
  });

  app.patch('/announcements/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'notifications.send');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(announcementsSchema.partial(), request.body);
    const [row] = await getDb()
      .update(announcements)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(announcements.id, id))
      .returning();
    if (!row) throw notFound('Announcement not found.');
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'announcement.updated',
      targetType: 'announcement',
      targetId: id,
    });
    return reply.send({ announcement: row });
  });

  app.delete('/announcements/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'notifications.send');
    const { id } = request.params as { id: string };
    await getDb().delete(announcements).where(eq(announcements.id, id));
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'announcement.deleted',
      targetType: 'announcement',
      targetId: id,
    });
    return reply.send({ success: true });
  });

  app.post('/notifications/broadcast', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'notifications.send');
    const input = parseOrThrow(broadcastNotificationSchema, request.body);
    const db = getDb();
    const conditions = [isNull(users.deletedAt)];
    if (input.audience === 'premium') conditions.push(eq(users.plan, 'premium'));
    if (input.audience === 'free') conditions.push(eq(users.plan, 'free'));
    if (input.audience === 'admins') conditions.push(eq(users.role, 'admin'));
    const targets = await db.select({ id: users.id }).from(users).where(and(...conditions)).limit(5000);

    for (const target of targets) {
      await createNotification({
        userId: target.id,
        type: 'announcement',
        title: input.title,
        body: input.body,
        link: input.link ?? null,
      });
    }
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'notification.broadcast',
      targetType: 'notification',
      metadata: { audience: input.audience, recipients: targets.length },
    });
    return reply.send({ sent: targets.length });
  });

  /* ------------------------------------------------------------------ */
  /* Support tickets                                                     */
  /* ------------------------------------------------------------------ */

  app.get('/tickets', async (request, reply) => {
    await requirePermission(request, env, 'users.read');
    const query = request.query as { status?: string; priority?: string; page?: string; pageSize?: string; q?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const db = getDb();
    const conditions = [];
    if (query.status) conditions.push(eq(supportTickets.status, query.status as never));
    if (query.priority) conditions.push(eq(supportTickets.priority, query.priority as never));
    if (query.q) conditions.push(or(ilike(supportTickets.subject, `%${query.q}%`), ilike(supportTickets.email, `%${query.q}%`))!);
    const where = conditions.length ? and(...conditions) : undefined;
    const [items, [totalRow]] = await Promise.all([
      db.select().from(supportTickets).where(where).orderBy(desc(supportTickets.createdAt)).offset(page.skip).limit(page.limit),
      db.select({ value: count() }).from(supportTickets).where(where),
    ]);
    return reply.send(paginate(items, Number(totalRow?.value ?? 0), page));
  });

  app.patch('/tickets/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'users.write');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(supportTicketUpdateSchema, request.body);
    const [row] = await getDb()
      .update(supportTickets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(supportTickets.id, id))
      .returning();
    if (!row) throw notFound('Ticket not found.');
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'ticket.updated',
      targetType: 'ticket',
      targetId: id,
      metadata: { ...input },
    });
    return reply.send({ ticket: row });
  });

  /* ------------------------------------------------------------------ */
  /* Bulk actions + exports                                              */
  /* ------------------------------------------------------------------ */

  app.post('/users/bulk', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'users.write');
    const input = parseOrThrow(bulkActionSchema, request.body);
    const db = getDb();
    const ids = input.ids;
    let affected = 0;

    switch (input.action) {
      case 'suspend':
      case 'unsuspend': {
        const rows = await db
          .update(users)
          .set({ suspended: input.action === 'suspend', updatedAt: new Date() })
          .where(and(inArray(users.id, ids), isNull(users.deletedAt)))
          .returning({ id: users.id });
        affected = rows.length;
        break;
      }
      case 'verify_email': {
        const rows = await db
          .update(users)
          .set({ emailVerified: true, updatedAt: new Date() })
          .where(inArray(users.id, ids))
          .returning({ id: users.id });
        affected = rows.length;
        break;
      }
      case 'make_admin':
      case 'make_user': {
        const rows = await db
          .update(users)
          .set({ role: input.action === 'make_admin' ? 'admin' : 'user', updatedAt: new Date() })
          .where(inArray(users.id, ids))
          .returning({ id: users.id });
        affected = rows.length;
        break;
      }
      case 'cancel_subscriptions': {
        const rows = await db
          .update(subscriptions)
          .set({ cancelAtPeriodEnd: true, canceledAt: new Date(), autoRenew: false, updatedAt: new Date() })
          .where(and(inArray(subscriptions.userId, ids), inArray(subscriptions.status, ['active', 'trialing', 'past_due'])))
          .returning({ id: subscriptions.id, userId: subscriptions.userId });
        affected = rows.length;
        await Promise.all([...new Set(rows.map((r) => r.userId))].map((id) => recomputeUserPlan(id)));
        break;
      }
      case 'delete': {
        const rows = await db
          .update(users)
          .set({
            deletedAt: new Date(),
            suspended: true,
            email: sql`concat('deleted+', ${users.id}, '@invalid.local')`,
            updatedAt: new Date(),
          })
          .where(and(inArray(users.id, ids), eq(users.role, 'user')))
          .returning({ id: users.id });
        affected = rows.length;
        break;
      }
    }

    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'admin.bulk_action',
      targetType: 'user',
      metadata: { action: input.action, ids: ids.length, affected },
      ip: request.ip,
    });
    return reply.send({ action: input.action, affected, updated: affected });
  });

  app.get('/export/:resource', async (request, reply) => {
    await requirePermission(request, env, 'reports.read');
    const { resource } = request.params as { resource: string };
    const db = getDb();
    let rows: Array<Record<string, unknown>> = [];
    let columns: string[] = [];

    if (resource === 'users') {
      const data = await db.select().from(users).where(isNull(users.deletedAt)).limit(20000);
      rows = data.map((u) => ({
        ...serializeUser(u),
        createdAt: u.createdAt.toISOString(),
      })) as unknown as Array<Record<string, unknown>>;
      columns = ['id', 'email', 'name', 'role', 'plan', 'emailVerified', 'suspended', 'createdAt', 'premiumUntil'];
    } else if (resource === 'payments') {
      const data = await db
        .select({ payment: payments, email: users.email })
        .from(payments)
        .leftJoin(users, eq(users.id, payments.userId))
        .orderBy(desc(payments.createdAt))
        .limit(20000);
      rows = data.map((r) => ({
        id: r.payment.id,
        email: r.email,
        amountMinor: r.payment.amountMinor,
        refundedMinor: r.payment.refundedMinor,
        currency: r.payment.currency,
        status: r.payment.status,
        provider: r.payment.provider,
        providerPaymentId: r.payment.providerPaymentId,
        createdAt: r.payment.createdAt.toISOString(),
      }));
      columns = ['id', 'email', 'amountMinor', 'refundedMinor', 'currency', 'status', 'provider', 'providerPaymentId', 'createdAt'];
    } else if (resource === 'subscriptions') {
      const data = await db
        .select({ sub: subscriptions, email: users.email })
        .from(subscriptions)
        .leftJoin(users, eq(users.id, subscriptions.userId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(20000);
      rows = data.map((r) => ({
        id: r.sub.id,
        email: r.email,
        planId: r.sub.planId,
        scope: r.sub.scope,
        status: r.sub.status,
        examKeys: (r.sub.examKeys ?? []).join('|'),
        startedAt: r.sub.startedAt.toISOString(),
        currentPeriodEnd: r.sub.currentPeriodEnd.toISOString(),
        priceMinor: r.sub.priceMinor,
      }));
      columns = ['id', 'email', 'planId', 'scope', 'status', 'examKeys', 'startedAt', 'currentPeriodEnd', 'priceMinor'];
    } else if (resource === 'refunds') {
      const data = await db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(20000);
      rows = data.map((r) => ({
        id: r.id,
        paymentId: r.paymentId,
        amountMinor: r.amountMinor,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      }));
      columns = ['id', 'paymentId', 'amountMinor', 'status', 'reason', 'createdAt'];
    } else if (resource === 'audit') {
      const data = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(20000);
      rows = data.map((r) => ({
        id: r.id,
        action: r.action,
        actorEmail: r.actorEmail,
        targetType: r.targetType,
        targetId: r.targetId,
        createdAt: r.createdAt.toISOString(),
      }));
      columns = ['id', 'action', 'actorEmail', 'targetType', 'targetId', 'createdAt'];
    } else {
      throw badRequest('Unknown export resource. Use users, payments, subscriptions, refunds or audit.');
    }

    await recordAudit({
      actorId: null,
      action: 'audit.export',
      targetType: 'export',
      metadata: { resource, rows: rows.length },
    });

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="examdump-${resource}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(toCsv(rows, columns));
  });

  /* ------------------------------------------------------------------ */
  /* Platform status (integration health for the console)                */
  /* ------------------------------------------------------------------ */

  app.get('/integrations', async (request, reply) => {
    await requirePermission(request, env, 'system.health');
    return reply.send({
      hyperswitch: {
        configured: hyperswitchConfigured(env),
        checkoutReady: checkoutReady(env),
        webhooksConfigured: webhookConfigured(env),
        baseUrl: env.HYPERSWITCH_BASE_URL ?? null,
        merchantId: env.HYPERSWITCH_MERCHANT_ID ?? null,
        provider: env.PAYMENT_PROVIDER,
      },
      ai: {
        configured: aiConfigured(env),
        provider: env.AI_PROVIDER,
        model: env.AI_MODEL,
        dailyLimitFree: env.AI_DAILY_LIMIT_FREE,
        dailyLimitPremium: env.AI_DAILY_LIMIT_PREMIUM,
      },
      dataset: {
        owner: env.DATASET_OWNER,
        repo: env.DATASET_REPO,
        branch: env.DATASET_BRANCH,
        tokenConfigured: Boolean(env.GITHUB_TOKEN),
      },
      flags: await getDb().select().from(featureFlags),
    });
  });

  /**
   * ExamDump Mail + ExamDump Pay diagnostics.
   *
   * Reports only whether things are configured - never the credential values.
   * This is the endpoint an operator needs when "no email arrived" or "the Pay
   * button is missing".
   */
  app.get('/infrastructure', async (request, reply) => {
    await requirePermission(request, env, 'system.health');
    const { mailConfigured } = await import('../services/mail/mail.service.js');
    const { resolvePaymentAdapter } = await import('../services/payments/registry.js');
    const pay = resolvePaymentAdapter(env);

    const recent = await getDb()
      .select({
        status: mailLogs.status,
        template: mailLogs.template,
        at: mailLogs.createdAt,
      })
      .from(mailLogs)
      .orderBy(desc(mailLogs.createdAt))
      .limit(10);

    return reply.send({
      mail: {
        enabled: env.MAIL_ENABLED,
        configured: mailConfigured(env),
        host: env.SMTP_HOST ?? null,
        port: env.SMTP_PORT,
        starttls: !env.SMTP_SECURE,
        sender: env.MAIL_FROM,
        replyTo: env.MAIL_REPLY_TO ?? null,
        maxAttempts: env.MAIL_MAX_ATTEMPTS,
        rateLimit: `${env.MAIL_RATE_MAX}/${Math.round(env.MAIL_RATE_WINDOW_MS / 1000)}s`,
      },
      pay: {
        paymentsEnabled: env.PAYMENTS_ENABLED,
        adapter: pay.adapterId,
        available: pay.adapter !== null,
        reason: pay.reason,
        methods: pay.methods,
        minAmountMinor: env.PAYMENT_MIN_AMOUNT_MINOR,
        maxAmountMinor: env.PAYMENT_MAX_AMOUNT_MINOR,
      },
      recentMail: recent,
    });
  });

  /** Send a live test email. Never returns credentials; log row is written. */
  app.post('/infrastructure/mail-test', async (request, reply) => {
    const auth = await requirePermission(request, env, 'settings.manage');
    const { sendTransactionalMail } = await import('../services/mail/mail.service.js');
    // Prefer the configured test recipient so verification is deterministic.
    const requested = (request.body as { to?: string } | undefined)?.to;
    const target = env.MAIL_TEST_RECIPIENT ?? requested ?? auth.user.email;
    const result = await sendTransactionalMail(env, {
      to: target,
      template: 'test',
      userId: auth.user.id,
      bypassRateLimit: true,
      logger: request.log,
      data: { sentAt: new Date().toISOString() },
    });
    return reply.send({
      delivered: result.delivered,
      suppressed: result.suppressed,
      attempts: result.attempts,
      // Error text only; credentials are never part of it.
      error: result.error ?? null,
    });
  });
}

function adminFallback(): { id: string; email: string | null } {
  return { id: '', email: null };
}

export { adminOpsRoutes as default };
