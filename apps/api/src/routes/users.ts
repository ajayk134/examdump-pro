import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { updatePreferencesSchema, updateProfileSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { serializeUser } from '../lib/serializers.js';
import { getDb } from '../db/client.js';
import { attempts, bookmarks, notes, subscriptions, users } from '../db/schema/index.js';
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
    const [updated] = await getDb()
      .update(users)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    return reply.send({ user: serializeUser(updated!) });
  });

  app.patch('/me/preferences', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(updatePreferencesSchema, request.body);
    const [updated] = await getDb()
      .update(users)
      .set({ preferences: { ...user.preferences, ...input }, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return reply.send({ user: serializeUser(updated!) });
  });

  app.get('/me/export', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const db = getDb();
    const [userAttempts, userBookmarks, userNotes, userSubscriptions] = await Promise.all([
      db.select().from(attempts).where(eq(attempts.userId, user.id)).orderBy(desc(attempts.createdAt)).limit(1000),
      db.select().from(bookmarks).where(eq(bookmarks.userId, user.id)),
      db.select().from(notes).where(eq(notes.userId, user.id)),
      db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).orderBy(desc(subscriptions.createdAt)),
    ]);
    return reply.send({
      exportedAt: new Date().toISOString(),
      user: serializeUser(user),
      attempts: userAttempts,
      bookmarks: userBookmarks,
      notes: userNotes,
      subscriptions: userSubscriptions,
    });
  });

  app.delete('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const db = getDb();
    await db
      .update(users)
      .set({
        deletedAt: new Date(),
        suspended: true,
        email: `deleted+${user.id}@examdump.invalid`,
        googleId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, user.id), isNull(users.deletedAt)));
    await revokeAllSessions(user.id);
    await recordAudit({
      actorId: user.id,
      action: 'admin.user_deleted',
      targetType: 'user',
      targetId: user.id,
      metadata: { self: true },
      ip: request.ip,
      userAgent: String(request.headers['user-agent'] ?? ''),
    });
    clearAuthCookies(reply, env);
    return reply.send({ success: true });
  });
}
