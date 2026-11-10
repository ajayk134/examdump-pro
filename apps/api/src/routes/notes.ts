import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';
import { noteSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { notes } from '../db/schema/index.js';
import { parsePage, paginate } from '../lib/pagination.js';

export async function noteRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const query = request.query as { page?: number; pageSize?: number; examKey?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const conditions = [eq(notes.userId, user.id)];
    if (query.examKey) conditions.push(eq(notes.examKey, query.examKey));
    const db = getDb();
    const [items, [totalRow]] = await Promise.all([
      db.select().from(notes).where(and(...conditions)).orderBy(desc(notes.updatedAt)).offset(page.skip).limit(page.limit),
      db.select({ value: count() }).from(notes).where(and(...conditions)),
    ]);
    return reply.send(paginate(items, Number(totalRow?.value ?? 0), page));
  });

  app.post('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(noteSchema, request.body);
    const [note] = await getDb()
      .insert(notes)
      .values({
        userId: user.id,
        providerId: input.provider,
        examKey: input.exam,
        questionId: input.questionId,
        body: input.body,
      })
      .onConflictDoUpdate({
        target: [notes.userId, notes.examKey, notes.questionId],
        set: { body: input.body, providerId: input.provider, updatedAt: new Date() },
      })
      .returning();
    return reply.code(201).send({ note });
  });

  app.get('/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const [note] = await getDb()
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
      .limit(1);
    if (!note) throw notFound('Note not found');
    return reply.send({ note });
  });

  app.delete('/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const deleted = await getDb()
      .delete(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
      .returning({ id: notes.id });
    if (deleted.length === 0) throw notFound('Note not found');
    return reply.send({ success: true });
  });
}
