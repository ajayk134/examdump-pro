import type { FastifyInstance } from 'fastify';
import { bookmarkSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';
import { Bookmark } from '../db/models/index.js';
import { parsePage, paginate } from '../lib/pagination.js';

export async function bookmarkRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const query = request.query as { page?: number; pageSize?: number; examKey?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const filter: Record<string, unknown> = { userId: user._id };
    if (query.examKey) filter.examKey = query.examKey;
    const [items, total] = await Promise.all([
      Bookmark.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).lean(),
      Bookmark.countDocuments(filter),
    ]);
    return reply.send(paginate(items, total, page));
  });

  app.post('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(bookmarkSchema, request.body);
    const bookmark = await Bookmark.findOneAndUpdate(
      { userId: user._id, examKey: input.exam, questionId: input.questionId },
      { $setOnInsert: { userId: user._id, ...input, examKey: input.exam } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return reply.code(201).send({ bookmark, bookmarked: true });
  });

  app.get('/status', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { examKey, questionId } = request.query as { examKey?: string; questionId?: string };
    if (!examKey || !questionId) return reply.send({ bookmarked: false });
    const exists = await Bookmark.exists({ userId: user._id, examKey, questionId });
    return reply.send({ bookmarked: Boolean(exists) });
  });

  app.delete('/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const result = await Bookmark.deleteOne({ _id: id, userId: user._id });
    if (result.deletedCount === 0) throw notFound('Bookmark not found');
    return reply.send({ success: true });
  });

  app.delete('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { examKey, questionId } = request.query as { examKey?: string; questionId?: string };
    if (!examKey || !questionId) throw notFound('Bookmark not found');
    await Bookmark.deleteOne({ userId: user._id, examKey, questionId });
    return reply.send({ success: true });
  });
}