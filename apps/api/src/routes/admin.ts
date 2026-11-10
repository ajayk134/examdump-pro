import type { FastifyInstance } from 'fastify';
import {
  adminUserListQuerySchema,
  createCouponAdminSchema,
  createPlanAdminSchema,
  updateSettingsAdminSchema,
  updateUserAdminSchema,
} from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAdmin } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { conflict, notFound } from '../lib/errors.js';
import { parsePage, paginate } from '../lib/pagination.js';
import {
  Attempt,
  AuditLog,
  CatalogExam,
  CatalogProvider,
  Coupon,
  Payment,
  Plan,
  Subscription,
  User,
} from '../db/models/index.js';
import { serializeUser } from '../lib/serializers.js';
import { recordAudit } from '../services/audit.service.js';
import { catalogCounts } from '../services/catalog.service.js';
import { syncDatasetCatalog } from '../services/dataset.service.js';
import { getSettings, updateSettings } from '../services/settings.service.js';
import { createNotification } from '../services/notification.service.js';
import { revokeAllSessions } from '../services/auth.service.js';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function adminRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/stats', async (request, reply) => {
    await requireAdmin(request, env);
    const [totalUsers, premiumUsers, verifiedUsers, suspendedUsers, attempts, completedAttempts] =
      await Promise.all([
        User.countDocuments({ deletedAt: null }),
        User.countDocuments({ plan: 'premium' }),
        User.countDocuments({ emailVerified: true }),
        User.countDocuments({ suspended: true }),
        Attempt.countDocuments(),
        Attempt.countDocuments({ status: 'completed' }),
      ]);

    const revenue = await Payment.aggregate([
      { $match: { status: 'succeeded' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const signups = await User.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, date: '$_id', count: 1 } },
      { $sort: { date: 1 } },
    ]);

    const [activeSubscriptions, catalog] = await Promise.all([
      Subscription.countDocuments({ status: 'active' }),
      catalogCounts(),
    ]);

    return reply.send({
      users: { total: totalUsers, premium: premiumUsers, verified: verifiedUsers, suspended: suspendedUsers },
      attempts: { total: attempts, completed: completedAttempts },
      revenue: { total: revenue[0]?.total ?? 0, currency: env.DEFAULT_CURRENCY, mock: !env.PAYMENTS_ENABLED },
      subscriptions: { active: activeSubscriptions },
      catalog,
      signups,
    });
  });

  app.get('/users', async (request, reply) => {
    await requireAdmin(request, env);
    const query = parseOrThrow(adminUserListQuerySchema, request.query);
    const page = parsePage(query.page, query.pageSize);
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.role) filter.role = query.role;
    if (query.plan) filter.plan = query.plan;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ email: rx }, { name: rx }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).lean(),
      User.countDocuments(filter),
    ]);
    return reply.send(
      paginate(
        items.map((u) => ({ ...serializeUser(u as never), suspended: u.suspended })),
        total,
        page,
      ),
    );
  });

  app.patch('/users/:id', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const { id } = request.params as { id: string };
    const input = parseOrThrow(updateUserAdminSchema, request.body);
    const target = await User.findById(id);
    if (!target) throw notFound('User not found');

    const changes: string[] = [];
    if (input.role && input.role !== target.role) {
      target.role = input.role;
      changes.push('role');
    }
    if (input.plan && input.plan !== target.plan) {
      target.plan = input.plan;
      target.premiumUntil = input.plan === 'premium' ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null;
      changes.push('plan');
    }
    if (typeof input.suspended === 'boolean' && input.suspended !== target.suspended) {
      target.suspended = input.suspended;
      changes.push('suspended');
      if (input.suspended) await revokeAllSessions(target._id.toString());
    }
    if (input.name) {
      target.name = input.name;
      changes.push('name');
    }
    await target.save();

    if (changes.includes('suspended') && target.suspended) {
      await createNotification({
        userId: target._id,
        type: 'system',
        title: 'Account suspended',
        body: 'Your account has been suspended. Contact support if you believe this is a mistake.',
      });
    }

    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: input.role ? 'user.role_changed' : 'admin.settings_updated',
      targetType: 'user',
      targetId: target._id.toString(),
      metadata: { changes },
      ip: request.ip,
      userAgent: String(request.headers['user-agent'] ?? ''),
    });

    return reply.send({ user: serializeUser(target) });
  });

  app.delete('/users/:id', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const { id } = request.params as { id: string };
    if (id === admin._id.toString()) throw conflict('You cannot delete your own admin account.');
    const target = await User.findById(id);
    if (!target) throw notFound('User not found');
    target.deletedAt = new Date();
    target.suspended = true;
    target.email = `deleted+${target._id.toString()}@examdump.invalid`;
    await target.save();
    await revokeAllSessions(target._id.toString());
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'admin.user_deleted',
      targetType: 'user',
      targetId: target._id.toString(),
      ip: request.ip,
    });
    return reply.send({ success: true });
  });

  app.get('/plans', async (request, reply) => {
    await requireAdmin(request, env);
    return reply.send({ plans: await Plan.find().sort({ sortOrder: 1 }).lean() });
  });

  app.post('/plans', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const input = parseOrThrow(createPlanAdminSchema, request.body);
    const exists = await Plan.exists({ planId: input.id });
    if (exists) throw conflict('A plan with this id already exists.');
    const plan = await Plan.create({
      planId: input.id,
      name: input.name,
      description: input.description,
      monthlyPrice: input.monthlyPrice,
      yearlyPrice: input.yearlyPrice,
      currency: input.currency,
      features: input.features,
      active: input.active,
      sortOrder: input.sortOrder,
    });
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'admin.settings_updated',
      targetType: 'plan',
      targetId: plan._id.toString(),
      metadata: { created: true },
    });
    return reply.code(201).send({ plan });
  });

  app.patch('/plans/:id', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const { id } = request.params as { id: string };
    const plan = await Plan.findById(id);
    if (!plan) throw notFound('Plan not found');
    const input = parseOrThrow(createPlanAdminSchema.partial(), request.body);
    Object.assign(plan, input);
    if (input.id) plan.planId = input.id;
    await plan.save();
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'admin.settings_updated',
      targetType: 'plan',
      targetId: plan._id.toString(),
    });
    return reply.send({ plan });
  });

  app.delete('/plans/:id', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const { id } = request.params as { id: string };
    const plan = await Plan.findByIdAndUpdate(id, { active: false }, { new: true });
    if (!plan) throw notFound('Plan not found');
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'admin.settings_updated',
      targetType: 'plan',
      targetId: id,
      metadata: { deactivated: true },
    });
    return reply.send({ success: true });
  });

  app.get('/coupons', async (request, reply) => {
    await requireAdmin(request, env);
    return reply.send({ coupons: await Coupon.find().sort({ createdAt: -1 }).lean() });
  });

  app.post('/coupons', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const input = parseOrThrow(createCouponAdminSchema, request.body);
    const exists = await Coupon.exists({ code: input.code.toUpperCase() });
    if (exists) throw conflict('This coupon code already exists.');
    const coupon = await Coupon.create({ ...input, createdBy: admin._id });
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'coupon.created',
      targetType: 'coupon',
      targetId: coupon._id.toString(),
      metadata: { code: coupon.code },
    });
    return reply.code(201).send({ coupon });
  });

  app.patch('/coupons/:id', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const { id } = request.params as { id: string };
    const coupon = await Coupon.findById(id);
    if (!coupon) throw notFound('Coupon not found');
    const input = parseOrThrow(createCouponAdminSchema.partial(), request.body);
    Object.assign(coupon, input);
    await coupon.save();
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'admin.settings_updated',
      targetType: 'coupon',
      targetId: coupon._id.toString(),
    });
    return reply.send({ coupon });
  });

  app.delete('/coupons/:id', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const { id } = request.params as { id: string };
    const coupon = await Coupon.findByIdAndUpdate(id, { active: false }, { new: true });
    if (!coupon) throw notFound('Coupon not found');
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'admin.settings_updated',
      targetType: 'coupon',
      targetId: id,
      metadata: { deactivated: true },
    });
    return reply.send({ success: true });
  });

  app.get('/settings', async (request, reply) => {
    await requireAdmin(request, env);
    const settings = await getSettings(env, true);
    return reply.send({ settings });
  });

  app.patch('/settings', async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const input = parseOrThrow(updateSettingsAdminSchema, request.body);
    const settings = await updateSettings(input);
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'admin.settings_updated',
      targetType: 'settings',
      targetId: settings._id.toString(),
      metadata: { ...input },
    });
    return reply.send({ settings });
  });

  app.get('/audit', async (request, reply) => {
    await requireAdmin(request, env);
    const query = request.query as { page?: number; pageSize?: number; action?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = query.action;
    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    return reply.send(paginate(items, total, page));
  });

  app.get('/dataset/status', async (request, reply) => {
    await requireAdmin(request, env);
    const [providers, exams, latest] = await Promise.all([
      CatalogProvider.countDocuments(),
      CatalogExam.countDocuments(),
      CatalogExam.findOne().sort({ syncedAt: -1 }).select('syncedAt').lean(),
    ]);
    return reply.send({
      branch: env.DATASET_BRANCH,
      owner: env.DATASET_OWNER,
      repo: env.DATASET_REPO,
      providers,
      exams,
      lastSyncedAt: latest?.syncedAt ?? null,
    });
  });

  app.post('/dataset/sync', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { user: admin } = await requireAdmin(request, env);
    const result = await syncDatasetCatalog(env, request.log);
    await recordAudit({
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'admin.dataset_synced',
      targetType: 'dataset',
      metadata: { ...result },
      ip: request.ip,
    });
    return reply.send({ result });
  });
}