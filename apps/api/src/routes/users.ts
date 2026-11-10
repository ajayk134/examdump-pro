import type { FastifyInstance } from 'fastify';
import { updatePreferencesSchema, updateProfileSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { serializeUser } from '../lib/serializers.js';
import {
  Attempt,
  Bookmark,
  Note,
  Subscription,
  User,
} from '../db/models/index.js';
import { revokeAllSessions } from '../services/auth.service.js';
import { clearAuthCookies } from '../lib/cookies.js';
import { recordAudit } from '../services/audit.service.js';

export async function userRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    return reply.send({ user: serializeUser(user) });
  });

  app.patch('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(updateProfileSchema, request.body);
    if (input.name !== undefined) user.name = input.name;
    if (input.bio !== undefined) user.bio = input.bio;
    if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;
    if (input.timezone !== undefined) user.timezone = input.timezone;
    await user.save();
    return reply.send({ user: serializeUser(user) });
  });

  app.patch('/me/preferences', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(updatePreferencesSchema, request.body);
    user.preferences = { ...user.preferences, ...input };
    await user.save();
    return reply.send({ user: serializeUser(user) });
  });

  app.get('/me/export', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const [attempts, bookmarks, notes, subscriptions] = await Promise.all([
      Attempt.find({ userId: user._id }).sort({ createdAt: -1 }).limit(1000).lean(),
      Bookmark.find({ userId: user._id }).lean(),
      Note.find({ userId: user._id }).lean(),
      Subscription.find({ userId: user._id }).sort({ createdAt: -1 }).lean(),
    ]);
    return reply.send({
      exportedAt: new Date().toISOString(),
      user: serializeUser(user),
      attempts,
      bookmarks,
      notes,
      subscriptions,
    });
  });

  app.delete('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    user.deletedAt = new Date();
    user.suspended = true;
    user.email = `deleted+${user._id.toString()}@examdump.invalid`;
    await user.save();
    await revokeAllSessions(user._id.toString());
    await recordAudit({
      actorId: user._id,
      action: 'admin.user_deleted',
      targetType: 'user',
      targetId: user._id.toString(),
      metadata: { self: true },
      ip: request.ip,
      userAgent: String(request.headers['user-agent'] ?? ''),
    });
    await User.updateOne({ _id: user._id }, { $unset: { googleId: 1 } });
    clearAuthCookies(reply, env);
    return reply.send({ success: true });
  });
}