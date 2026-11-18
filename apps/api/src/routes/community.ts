import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  questionCommunityQuerySchema,
  questionDiscussionListQuerySchema,
  questionDiscussionSchema,
  questionDiscussionUpdateSchema,
  questionVoteSchema,
} from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import {
  castVote,
  createComment,
  deleteComment,
  getVoteSummary,
  listComments,
  updateComment,
} from '../services/community.service.js';

const commentIdSchema = z.string().uuid();

export async function communityRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /** Live vote totals and the signed-in user's current choice. */
  app.get('/votes', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const query = parseOrThrow(questionCommunityQuerySchema, request.query);
    return reply.send(
      await getVoteSummary(env, user.id, {
        provider: query.provider,
        exam: query.exam,
        questionId: query.questionId,
      }),
    );
  });

  /** Cast or change the one vote this user has on this question. */
  app.post(
    '/votes',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user } = await requireAuth(request, env);
      const input = parseOrThrow(questionVoteSchema, request.body);
      return reply.send(
        await castVote(
          env,
          user.id,
          {
            provider: input.provider,
            exam: input.exam,
            questionId: input.questionId,
          },
          input.choice,
        ),
      );
    },
  );

  /** Paginated top-level comments with every reply for those roots attached. */
  app.get('/discussions', async (request, reply) => {
    await requireAuth(request, env);
    const query = parseOrThrow(questionDiscussionListQuerySchema, request.query);
    return reply.send(
      await listComments(
        env,
        {
          provider: query.provider,
          exam: query.exam,
          questionId: query.questionId,
        },
        { sort: query.sort, page: query.page, pageSize: query.pageSize },
      ),
    );
  });

  app.post(
    '/discussions',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user } = await requireAuth(request, env);
      const input = parseOrThrow(questionDiscussionSchema, request.body);
      return reply.code(201).send({
        comment: await createComment(
          env,
          user.id,
          {
            provider: input.provider,
            exam: input.exam,
            questionId: input.questionId,
          },
          { body: input.body, parentId: input.parentId },
        ),
      });
    },
  );

  app.patch(
    '/discussions/:id',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user } = await requireAuth(request, env);
      const id = parseOrThrow(commentIdSchema, (request.params as { id: string }).id);
      const input = parseOrThrow(questionDiscussionUpdateSchema, request.body);
      return reply.send({
        comment: await updateComment(id, user.id, user.role, input.body),
      });
    },
  );

  app.delete(
    '/discussions/:id',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user } = await requireAuth(request, env);
      const id = parseOrThrow(commentIdSchema, (request.params as { id: string }).id);
      await deleteComment(id, user.id, user.role);
      return reply.send({ success: true });
    },
  );
}