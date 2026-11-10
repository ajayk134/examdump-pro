import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';
import { bookmarkSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { bookmarks } from '../db/schema/index.js';
import { parsePage, paginate } from '../lib/pagination.js';

export async function bookmarkRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const query = request.query as { page?: number; pageSize?: number; examKey?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const conditions = [eq(bookmarks.userId, user.id)];
    if (query.examKey) conditions.push(eq(bookmarks.examKey, query.examKey));
    const db = getDb();
    const [items, [totalRow]] = await Promise.all([
      db
        .select()
        .from(bookmarks)
        .where(and(...conditions))
        .orderBy(desc(bookmarks.createdAt))
        .offset(page.skip)
        .limit(page.limit),
      db.select({ value: count() }).from(bookmarks).where(and(...conditions)),
    ]);
    return reply.send(paginate(items, Number(totalRow?.value ?? 0), page));
  });

  app.post('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(bookmarkSchema, request.body);
    const [bookmark] = await getDb()
      .insert(bookmarks)
      .values({
        userId: user.id,
        providerId: input.provider,
        examKey: input.exam,
        questionId: input.questionId,
      })
      .onConflictDoUpdate({
        target: [bookmarks.userId, bookmarks.examKey, bookmarks.questionId],
        set: { providerId: input.provider },
      })
      .returning();
    return reply.code(201).send({ bookmark, bookmarked: true });
  });

  app.get('/status', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { examKey, questionId } = request.query as { examKey?: string; questionId?: string };
    if (!examKey || !questionId) return reply.send({ bookmarked: false });
    const [row] = await getDb()
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.examKey, examKey), eq(bookmarks.questionId, questionId)))
      .limit(1);
    return reply.send({ bookmarked: Boolean(row) });
  });

  app.delete('/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const deleted = await getDb()
      .delete(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)))
      .returning({ id: bookmarks.id });
    if (deleted.length === 0) throw notFound('Bookmark not found');
    return reply.send({ success: true });
  });

  app.delete('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { examKey, questionId } = request.query as { examKey?: string; questionId?: string };
    if (!examKey || !questionId) throw notFound('Bookmark not found');
    await getDb()
      .delete(bookmarks)
      .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.examKey, examKey), eq(bookmarks.questionId, questionId)));
    return reply.send({ success: true });
  });
}
