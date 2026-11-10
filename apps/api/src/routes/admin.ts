import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  adminUserListQuerySchema,
  assignRoleSchema,
  createCouponAdminSchema,
  createPlanAdminSchema,
  createRoleSchema,
  emailTemplateSchema,
  featureFlagSchema,
  grantAccessSchema,
  refundSchema,
  updateRolePermissionsSchema,
  updateSettingsAdminSchema,
  updateUserAdminSchema,
} from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requirePermission } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { conflict, notFound } from '../lib/errors.js';
import { parsePage, paginate } from '../lib/pagination.js';
import { getDb } from '../db/client.js';
import {
  attempts,
  auditLogs,
  catalogExams,
  coupons,
  emailTemplates,
  featureFlags,
  payments,
  plans,
  refunds,
  settings as settingsTable,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { serializeUser } from '../lib/serializers.js';
import { recordAudit } from '../services/audit.service.js';
import { catalogCounts } from '../services/catalog.service.js';
import { syncDatasetCatalog } from '../services/dataset.service.js';
import { getSettings, updateSettings } from '../services/settings.service.js';
import { createNotification } from '../services/notification.service.js';
import { revokeAllSessions } from '../services/auth.service.js';
import {
  createAccessGrant,
  listAccessGrants,
  listAllPlans,
  recomputeUserPlan,
  refundPayment,
  revokeAccessGrant,
} from '../services/subscription.service.js';
import {
  assignUserRoles,
  createRole,
  getUserRoleIds,
  listPermissions,
  listRoles,
  updateRolePermissions,
} from '../services/rbac.service.js';

export async function adminRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/stats', async (request, reply) => {
    await requirePermission(request, env, 'analytics.read');
    const db = getDb();
    const [[totalUsers], [premiumUsers], [verifiedUsers], [suspendedUsers], [attemptCount], [completedAttempts], [activeSubs]] =
      await Promise.all([
        db.select({ value: count() }).from(users).where(isNull(users.deletedAt)),
        db.select({ value: count() }).from(users).where(eq(users.plan, 'premium')),
        db.select({ value: count() }).from(users).where(eq(users.emailVerified, true)),
        db.select({ value: count() }).from(users).where(eq(users.suspended, true)),
        db.select({ value: count() }).from(attempts),
        db.select({ value: count() }).from(attempts).where(eq(attempts.status, 'completed')),
        db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, 'active')),
      ]);

    const [[gross], [refunded]] = await Promise.all([
      db.select({ value: sql<number>`coalesce(sum(${payments.amountMinor}), 0)` }).from(payments).where(inArray(payments.status, ['succeeded', 'partially_refunded'])),
      db.select({ value: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)` }).from(refunds).where(eq(refunds.status, 'succeeded')),
    ]);

    const signups = await db
      .select({
        date: sql<string>`to_char(${users.createdAt}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(users)
      .where(gte(users.createdAt, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)))
      .groupBy(sql`to_char(${users.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(asc(sql`to_char(${users.createdAt}, 'YYYY-MM-DD')`));

    const catalog = await catalogCounts();
    return reply.send({
      users: {
        total: Number(totalUsers?.value ?? 0),
        premium: Number(premiumUsers?.value ?? 0),
        verified: Number(verifiedUsers?.value ?? 0),
        suspended: Number(suspendedUsers?.value ?? 0),
      },
      attempts: { total: Number(attemptCount?.value ?? 0), completed: Number(completedAttempts?.value ?? 0) },
      revenue: {
        grossMinor: Number(gross?.value ?? 0),
        refundedMinor: Number(refunded?.value ?? 0),
        netMinor: Number(gross?.value ?? 0) - Number(refunded?.value ?? 0),
        currency: 'INR',
        mock: !env.PAYMENTS_ENABLED,
      },
      subscriptions: { active: Number(activeSubs?.value ?? 0) },
      catalog,
      signups,
    });
  });

  app.get('/users', async (request, reply) => {
    await requirePermission(request, env, 'users.read');
    const query = parseOrThrow(adminUserListQuerySchema, request.query);
    const page = parsePage(query.page, query.pageSize);
    const db = getDb();
    const conditions = [isNull(users.deletedAt)];
    if (query.role) conditions.push(eq(users.role, query.role as never));
    if (query.plan) conditions.push(eq(users.plan, query.plan));
    if (query.suspended !== undefined) conditions.push(eq(users.suspended, query.suspended));
    if (query.q) conditions.push(or(ilike(users.email, `%${query.q}%`), ilike(users.name, `%${query.q}%`))!);

    const [items, [totalRow]] = await Promise.all([
      db.select().from(users).where(and(...conditions)).orderBy(desc(users.createdAt)).offset(page.skip).limit(page.limit),
      db.select({ value: count() }).from(users).where(and(...conditions)),
    ]);
    return reply.send(paginate(items.map(serializeUser), Number(totalRow?.value ?? 0), page));
  });

  app.get('/users/:id', async (request, reply) => {
    await requirePermission(request, env, 'users.read');
    const { id } = request.params as { id: string };
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw notFound('User not found');
    const [subs, pays, grants, roleIds] = await Promise.all([
      db.select().from(subscriptions).where(eq(subscriptions.userId, id)).orderBy(desc(subscriptions.createdAt)),
      db.select().from(payments).where(eq(payments.userId, id)).orderBy(desc(payments.createdAt)),
      listAccessGrants(id),
      getUserRoleIds(id),
    ]);
    return reply.send({ user: serializeUser(user), subscriptions: subs, payments: pays, grants, roleIds });
  });

  app.patch('/users/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'users.write');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(updateUserAdminSchema, request.body);
    const db = getDb();
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw notFound('User not found');

    const changes: string[] = [];
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.role && input.role !== target.role) {
      patch.role = input.role;
      changes.push('role');
    }
    if (input.plan && input.plan !== target.plan) {
      patch.plan = input.plan;
      changes.push('plan');
    }
    if (typeof input.suspended === 'boolean' && input.suspended !== target.suspended) {
      patch.suspended = input.suspended;
      changes.push('suspended');
    }
    if (input.name) {
      patch.name = input.name;
      changes.push('name');
    }
    if (typeof input.emailVerified === 'boolean' && input.emailVerified !== target.emailVerified) {
      patch.emailVerified = input.emailVerified;
      changes.push('emailVerified');
    }
    await db.update(users).set(patch).where(eq(users.id, id));

    if (changes.includes('suspended') && input.suspended) {
      await revokeAllSessions(id);
      await createNotification({
        userId: id,
        type: 'system',
        title: 'Account suspended',
        body: 'Your account has been suspended. Contact support if you believe this is a mistake.',
      });
    }
    if (changes.includes('plan') && !changes.includes('suspended')) {
      await recomputeUserPlan(id);
    }

    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: input.role ? 'user.role_changed' : 'user.updated',
      targetType: 'user',
      targetId: id,
      metadata: { changes },
      ip: request.ip,
      userAgent: String(request.headers['user-agent'] ?? ''),
    });

    const [fresh] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return reply.send({ user: serializeUser(fresh!) });
  });

  app.delete('/users/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'users.delete');
    const { id } = request.params as { id: string };
    if (id === admin.id) throw conflict('You cannot delete your own admin account.');
    const db = getDb();
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw notFound('User not found');
    await db
      .update(users)
      .set({ deletedAt: new Date(), suspended: true, email: `deleted+${id}@examdump.invalid`, googleId: null, updatedAt: new Date() })
      .where(eq(users.id, id));
    await revokeAllSessions(id);
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'admin.user_deleted',
      targetType: 'user',
      targetId: id,
      ip: request.ip,
    });
    return reply.send({ success: true });
  });

  app.post('/users/:id/grant', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'grants.manage');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(grantAccessSchema, request.body);
    const grant = await createAccessGrant({
      userId: id,
      scope: input.scope,
      examKey: input.examKey,
      providerId: input.providerId,
      note: input.note,
      expiresAt: input.expiresAt,
      grantedBy: admin.id,
    });
    return reply.code(201).send({ grant });
  });

  app.delete('/grants/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'grants.manage');
    const { id } = request.params as { id: string };
    await revokeAccessGrant(id, admin.id);
    return reply.send({ success: true });
  });

  app.post('/users/:id/roles', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'roles.manage');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(assignRoleSchema, request.body);
    await assignUserRoles(id, input.roleIds, admin.id);
    await recordAudit({ actorId: admin.id, action: 'user.role_changed', targetType: 'user', targetId: id, metadata: { roleIds: input.roleIds } });
    return reply.send({ success: true, roleIds: await getUserRoleIds(id) });
  });

  app.get('/roles', async (request, reply) => {
    await requirePermission(request, env, 'roles.manage');
    return reply.send({ roles: await listRoles() });
  });

  app.get('/permissions', async (request, reply) => {
    await requirePermission(request, env, 'roles.manage');
    return reply.send({ permissions: await listPermissions() });
  });

  app.post('/roles', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'roles.manage');
    const input = parseOrThrow(createRoleSchema, request.body);
    const role = await createRole(input);
    await recordAudit({ actorId: admin.id, action: 'role.created', targetType: 'role', targetId: role.id });
    return reply.code(201).send({ role });
  });

  app.patch('/roles/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'roles.manage');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(updateRolePermissionsSchema, request.body);
    const role = await updateRolePermissions(id, input.permissions);
    await recordAudit({ actorId: admin.id, action: 'role.permissions_updated', targetType: 'role', targetId: id });
    return reply.send({ role });
  });

  app.get('/plans', async (request, reply) => {
    await requirePermission(request, env, 'plans.manage');
    return reply.send({ plans: await listAllPlans() });
  });

  app.post('/plans', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'plans.manage');
    const input = parseOrThrow(createPlanAdminSchema, request.body);
    const db = getDb();
    const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, input.id)).limit(1);
    if (existing) throw conflict('A plan with this id already exists.');
    const [plan] = await db
      .insert(plans)
      .values({
        id: input.id,
        name: input.name,
        description: input.description,
        scope: input.scope,
        durationDays: input.durationDays,
        earlyAccess: input.earlyAccess,
        priceMinor: input.priceMinor,
        currency: input.currency,
        features: input.features,
        active: input.active,
        sortOrder: input.sortOrder,
      })
      .returning();
    await recordAudit({ actorId: admin.id, action: 'plan.created', targetType: 'plan', targetId: plan!.id });
    return reply.code(201).send({ plan });
  });

  app.patch('/plans/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'plans.manage');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(createPlanAdminSchema.partial(), request.body);
    const db = getDb();
    const [plan] = await db
      .update(plans)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
        ...(input.earlyAccess !== undefined ? { earlyAccess: input.earlyAccess } : {}),
        ...(input.priceMinor !== undefined ? { priceMinor: input.priceMinor } : {}),
        ...(input.features !== undefined ? { features: input.features } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(plans.id, id))
      .returning();
    if (!plan) throw notFound('Plan not found');
    await recordAudit({ actorId: admin.id, action: 'plan.updated', targetType: 'plan', targetId: id });
    return reply.send({ plan });
  });

  app.delete('/plans/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'plans.manage');
    const { id } = request.params as { id: string };
    const [plan] = await getDb().update(plans).set({ active: false, updatedAt: new Date() }).where(eq(plans.id, id)).returning();
    if (!plan) throw notFound('Plan not found');
    await recordAudit({ actorId: admin.id, action: 'plan.updated', targetType: 'plan', targetId: id, metadata: { deactivated: true } });
    return reply.send({ success: true });
  });

  app.get('/coupons', async (request, reply) => {
    await requirePermission(request, env, 'coupons.manage');
    return reply.send({ coupons: await getDb().select().from(coupons).orderBy(desc(coupons.createdAt)) });
  });

  app.post('/coupons', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'coupons.manage');
    const input = parseOrThrow(createCouponAdminSchema, request.body);
    const db = getDb();
    const [existing] = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, input.code.toUpperCase())).limit(1);
    if (existing) throw conflict('This coupon code already exists.');
    const [coupon] = await db
      .insert(coupons)
      .values({
        code: input.code.toUpperCase(),
        description: input.description ?? '',
        percentOff: input.percentOff,
        maxRedemptions: input.maxRedemptions,
        expiresAt: input.expiresAt ?? null,
        active: input.active,
        createdBy: admin.id,
      })
      .returning();
    await recordAudit({ actorId: admin.id, action: 'coupon.created', targetType: 'coupon', targetId: coupon!.id, metadata: { code: coupon!.code } });
    return reply.code(201).send({ coupon });
  });

  app.patch('/coupons/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'coupons.manage');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(createCouponAdminSchema.partial(), request.body);
    const [coupon] = await getDb()
      .update(coupons)
      .set({
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.percentOff !== undefined ? { percentOff: input.percentOff } : {}),
        ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(coupons.id, id))
      .returning();
    if (!coupon) throw notFound('Coupon not found');
    await recordAudit({ actorId: admin.id, action: 'coupon.updated', targetType: 'coupon', targetId: id });
    return reply.send({ coupon });
  });

  app.delete('/coupons/:id', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'coupons.manage');
    const { id } = request.params as { id: string };
    const [coupon] = await getDb().update(coupons).set({ active: false, updatedAt: new Date() }).where(eq(coupons.id, id)).returning();
    if (!coupon) throw notFound('Coupon not found');
    await recordAudit({ actorId: admin.id, action: 'coupon.updated', targetType: 'coupon', targetId: id, metadata: { deactivated: true } });
    return reply.send({ success: true });
  });

  app.get('/payments', async (request, reply) => {
    await requirePermission(request, env, 'payments.read');
    const query = request.query as { page?: number; pageSize?: number };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const db = getDb();
    const [items, [totalRow]] = await Promise.all([
      db.select().from(payments).orderBy(desc(payments.createdAt)).offset(page.skip).limit(page.limit),
      db.select({ value: count() }).from(payments),
    ]);
    return reply.send(paginate(items, Number(totalRow?.value ?? 0), page));
  });

  app.post('/payments/:id/refund', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'payments.refund');
    const { id } = request.params as { id: string };
    const input = parseOrThrow(refundSchema, request.body ?? {});
    const refund = await refundPayment(id, input.amountMinor, input.reason ?? '', admin.id);
    return reply.code(201).send({ refund });
  });

  app.get('/refunds', async (request, reply) => {
    await requirePermission(request, env, 'payments.read');
    return reply.send({ refunds: await getDb().select().from(refunds).orderBy(desc(refunds.createdAt)).limit(200) });
  });

  app.get('/settings', async (request, reply) => {
    await requirePermission(request, env, 'settings.manage');
    return reply.send({ settings: await getSettings(env, true) });
  });

  app.patch('/settings', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'settings.manage');
    const input = parseOrThrow(updateSettingsAdminSchema, request.body);
    const updated = await updateSettings(input);
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'admin.settings_updated',
      targetType: 'settings',
      targetId: 'global',
      metadata: { ...input },
    });
    return reply.send({ settings: updated });
  });

  app.get('/feature-flags', async (request, reply) => {
    await requirePermission(request, env, 'feature_flags.manage');
    return reply.send({ flags: await getDb().select().from(featureFlags).orderBy(asc(featureFlags.key)) });
  });

  app.patch('/feature-flags/:key', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'feature_flags.manage');
    const { key } = request.params as { key: string };
    const input = parseOrThrow(featureFlagSchema.partial().extend({ key: featureFlagSchema.shape.key }), { key, ...(request.body as object) });
    const [flag] = await getDb()
      .insert(featureFlags)
      .values({ key, enabled: input.enabled ?? false, description: input.description ?? '', rolloutPercent: input.rolloutPercent ?? 100 })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.rolloutPercent !== undefined ? { rolloutPercent: input.rolloutPercent } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    await recordAudit({ actorId: admin.id, action: 'admin.feature_flag_updated', targetType: 'feature_flag', targetId: key });
    return reply.send({ flag });
  });

  app.get('/email-templates', async (request, reply) => {
    await requirePermission(request, env, 'email_templates.manage');
    return reply.send({ templates: await getDb().select().from(emailTemplates).orderBy(asc(emailTemplates.key)) });
  });

  app.patch('/email-templates/:key', async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'email_templates.manage');
    const { key } = request.params as { key: string };
    const input = parseOrThrow(emailTemplateSchema.partial().extend({ key: emailTemplateSchema.shape.key }), { key, ...(request.body as object) });
    const [template] = await getDb()
      .insert(emailTemplates)
      .values({ key, subject: input.subject ?? 'Untitled', body: input.body ?? '', description: input.description ?? '' })
      .onConflictDoUpdate({
        target: emailTemplates.key,
        set: {
          ...(input.subject !== undefined ? { subject: input.subject } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    await recordAudit({ actorId: admin.id, action: 'admin.email_template_updated', targetType: 'email_template', targetId: key });
    return reply.send({ template });
  });

  app.get('/audit', async (request, reply) => {
    await requirePermission(request, env, 'audit.read');
    const query = request.query as { page?: number; pageSize?: number; action?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const conditions = query.action ? [eq(auditLogs.action, query.action)] : [];
    const db = getDb();
    const [items, [totalRow]] = await Promise.all([
      db.select().from(auditLogs).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(auditLogs.createdAt)).offset(page.skip).limit(page.limit),
      db.select({ value: count() }).from(auditLogs).where(conditions.length ? and(...conditions) : undefined),
    ]);
    return reply.send(paginate(items, Number(totalRow?.value ?? 0), page));
  });

  app.get('/reports/overview', async (request, reply) => {
    await requirePermission(request, env, 'reports.read');
    const db = getDb();
    const [[revenue], [refundTotal], [activeSubs], [newUsers]] = await Promise.all([
      db.select({ value: sql<number>`coalesce(sum(${payments.amountMinor}), 0)` }).from(payments).where(inArray(payments.status, ['succeeded', 'partially_refunded'])),
      db.select({ value: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)` }).from(refunds).where(eq(refunds.status, 'succeeded')),
      db.select({ value: count() }).from(subscriptions).where(inArray(subscriptions.status, ['active', 'trialing'])),
      db.select({ value: count() }).from(users).where(gte(users.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))),
    ]);
    const byPlan = await db
      .select({ planId: subscriptions.planId, count: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ['active', 'trialing']))
      .groupBy(subscriptions.planId);
    return reply.send({
      revenue: {
        grossMinor: Number(revenue?.value ?? 0),
        refundedMinor: Number(refundTotal?.value ?? 0),
        netMinor: Number(revenue?.value ?? 0) - Number(refundTotal?.value ?? 0),
        currency: 'INR',
      },
      activeSubscriptions: Number(activeSubs?.value ?? 0),
      newUsers30d: Number(newUsers?.value ?? 0),
      byPlan,
    });
  });

  app.get('/dataset/status', async (request, reply) => {
    await requirePermission(request, env, 'dataset.sync');
    const db = getDb();
    const [catalog, [row]] = await Promise.all([
      catalogCounts(),
      db.select({ syncedAt: sql<Date | null>`max(${catalogExams.syncedAt})` }).from(catalogExams),
    ]);
    return reply.send({
      branch: env.DATASET_BRANCH,
      owner: env.DATASET_OWNER,
      repo: env.DATASET_REPO,
      providers: catalog.providers,
      exams: catalog.exams,
      lastSyncedAt: row?.syncedAt ?? null,
    });
  });

  app.post('/dataset/sync', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { user: admin } = await requirePermission(request, env, 'dataset.sync');
    const result = await syncDatasetCatalog(env, request.log);
    await recordAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'admin.dataset_synced',
      targetType: 'dataset',
      metadata: { ...result },
      ip: request.ip,
    });
    return reply.send({ result });
  });

  app.get('/system/health', async (request, reply) => {
    await requirePermission(request, env, 'system.health');
    const db = getDb();
    const [[userCount], [settingsRow]] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select().from(settingsTable).where(eq(settingsTable.key, 'global')).limit(1),
    ]);
    return reply.send({
      database: 'ok',
      users: Number(userCount?.value ?? 0),
      maintenanceMode: settingsRow?.maintenanceMode ?? false,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      node: process.version,
    });
  });
}
