import type { FastifyInstance } from 'fastify';
import { noteSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';
import { Note } from '../db/models/index.js';
import { parsePage, paginate } from '../lib/pagination.js';

export async function noteRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const query = request.query as { page?: number; pageSize?: number; examKey?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const filter: Record<string, unknown> = { userId: user._id };
    if (query.examKey) filter.examKey = query.examKey;
    const [items, total] = await Promise.all([
      Note.find(filter).sort({ updatedAt: -1 }).skip(page.skip).limit(page.limit).lean(),
      Note.countDocuments(filter),
    ]);
    return reply.send(paginate(items, total, page));
  });

  app.post('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(noteSchema, request.body);
    const note = await Note.findOneAndUpdate(
      { userId: user._id, examKey: input.exam, questionId: input.questionId },
      {
        $set: { body: input.body, providerId: input.provider },
        $setOnInsert: { userId: user._id, examKey: input.exam, questionId: input.questionId },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return reply.code(201).send({ note });
  });

  app.get('/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const note = await Note.findOne({ _id: id, userId: user._id }).lean();
    if (!note) throw notFound('Note not found');
    return reply.send({ note });
  });

  app.delete('/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const result = await Note.deleteOne({ _id: id, userId: user._id });
    if (result.deletedCount === 0) throw notFound('Note not found');
    return reply.send({ success: true });
  });
}