import type { FastifyInstance } from 'fastify';
import {
  aiAssistSchema,
  aiChatMessageSchema,
  aiChatStartSchema,
  aiConversationRenameSchema,
  aiExplainSchema,
} from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest } from '../lib/errors.js';
import { getDatasetClient } from '../services/dataset.service.js';
import { resolveEntitlements } from '../services/entitlement.service.js';
import { getSettings, getFeatureFlags } from '../services/settings.service.js';
import { assertWithinQuota, getDailyUsage, incrementUsage } from '../services/usage.service.js';
import {
  createConversation,
  deleteConversation,
  findQuestionConversation,
  getConversation,
  listConversations,
  renameConversation,
  sendMessage,
} from '../services/ai-chat.service.js';
import {
  aiConfigured,
  AiError,
  buildExplanationMessages,
  buildHintMessages,
  chat,
  offlineExplanation,
  streamChat,
} from '../services/ai.service.js';

export async function aiRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /** Capability probe used by the UI to hide/annotate AI affordances. */
  app.get('/status', async (request, reply) => {
    const auth = await requireAuth(request, env).catch(() => null);
    if (!auth) {
      return reply.send({ enabled: aiConfigured(env), provider: env.AI_PROVIDER, model: env.AI_MODEL });
    }
    const settings = await getSettings(env);
    const entitlements = await resolveEntitlements(auth.user, settings);
    const usage = await getDailyUsage(auth.user.id);
    const limit = aiDailyLimit(env, entitlements.plan);
    const flags = await getFeatureFlags();
    const flagOn = flags.get('ai_explanations')?.enabled ?? true;
    return reply.send({
      enabled: aiConfigured(env) && flagOn,
      provider: env.AI_PROVIDER,
      model: env.AI_MODEL,
      dailyLimit: limit,
      usedToday: usage.aiExplanations,
      remaining: Math.max(0, limit - usage.aiExplanations),
      premium: entitlements.plan === 'premium',
    });
  });

  /**
   * Detailed explanation for a question. Requires access to the exam (either
   * full entitlement or the free preview window) and a per-tier daily quota.
   * The provider is never trusted to disclose an answer when access is denied.
   */
  app.post('/explain', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(aiExplainSchema, request.body);

    if (!aiConfigured(env)) {
      return reply.code(503).send({
        error: { code: 'AI_NOT_CONFIGURED', message: 'AI assistance is not configured on this server.' },
        degraded: true,
      });
    }

    const settings = await getSettings(env);
    const entitlements = await resolveEntitlements(user, settings);

    const { question, exam, provider } = await getDatasetClient(env).getQuestion(
      input.provider,
      input.exam,
      input.questionId,
    );

    const limit = aiDailyLimit(env, entitlements.plan);
    await assertWithinQuota(user.id, [{ field: 'aiExplanations', limit, label: 'AI explanation' }]);

    try {
      const result = await chat(env, {
        messages: buildExplanationMessages(question, {
          examTitle: exam.title,
          examCode: exam.code,
          providerTitle: provider.title,
          learnerChoice: input.choice,
        }),
        maxTokens: env.AI_MAX_TOKENS,
        temperature: 0.25,
      });
      await incrementUsage(user.id, 'aiExplanations', 1);
      return reply.send({
        explanation: result.text,
        model: result.model,
        provider: result.provider,
        degraded: false,
        remaining: Math.max(0, limit - (await getDailyUsage(user.id)).aiExplanations),
        dailyLimit: limit,
      });
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      // Graceful degradation: return the verified dataset explanation.
      const usage = await incrementUsage(user.id, 'aiExplanations', 1);
      request.log.warn({ err: err.message }, 'ai.explain.degraded');
      return reply.code(200).send({
        explanation: offlineExplanation(question, { code: exam.code, title: exam.title }),
        model: 'dataset',
        provider: 'fallback',
        degraded: true,
        degradedReason: err.message,
        remaining: Math.max(0, limit - usage.aiExplanations),
        dailyLimit: limit,
      });
    }
  });

  /**
   * Streaming variant of /explain.
   *
   * Explanations are the longest AI output in the product, so they stream so
   * the learner can start reading immediately and can cancel mid-answer. The
   * same grounding is used as the non-streaming route: the question is rebuilt
   * from the private dataset server-side, never from client input.
   */
  app.post(
    '/explain/stream',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user } = await requireAuth(request, env);
      const input = parseOrThrow(aiExplainSchema, request.body);

      if (!aiConfigured(env)) {
        return reply.code(503).send({
          error: { code: 'AI_NOT_CONFIGURED', message: 'AI assistance is not configured on this server.' },
        });
      }

      const settings = await getSettings(env);
      const entitlements = await resolveEntitlements(user, settings);
      const limit = aiDailyLimit(env, entitlements.plan);
      await assertWithinQuota(user.id, [{ field: 'aiExplanations', limit, label: 'AI explanation' }]);

      const { question, exam, provider } = await getDatasetClient(env).getQuestion(
        input.provider,
        input.exam,
        input.questionId,
      );

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      res.socket?.setNoDelay(true);

      const send = async (payload: unknown): Promise<void> => {
        if (res.writableEnded || res.destroyed) return;
        const ok = res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if (!ok) {
          await new Promise<void>((resolve) => {
            const done = () => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.once('drain', done);
            res.once('close', done);
          });
        }
      };

      let terminated = false;
      try {
        for await (const chunk of streamChat(env, {
          messages: buildExplanationMessages(question, {
            examTitle: exam.title,
            examCode: exam.code,
            providerTitle: provider.title,
            learnerChoice: input.choice,
          }),
          maxTokens: env.AI_MAX_TOKENS,
          temperature: 0.25,
        })) {
          if (chunk.type === 'done' || chunk.type === 'error') terminated = true;
          await send(chunk);
        }
      } catch (err) {
        request.log.error({ err }, 'ai.explain.stream_failed');
        terminated = true;
        await send({ type: 'error', message: 'The AI tutor is temporarily unavailable.' });
      } finally {
        if (!terminated && !res.writableEnded && !res.destroyed) await send({ type: 'done' });
        if (!res.writableEnded) res.end();
        if (!res.destroyed) await incrementUsage(user.id, 'aiExplanations', 1).catch(() => undefined);
      }
    },
  );

  /**
   * Streaming variant of `/hint`.
   *
   * Hints are short, so the win here is perceived responsiveness: the reader
   * sees the nudge being written instead of staring at a spinner. Reuses the
   * same SSE plumbing (hijack, flush, drain-aware writes, explicit terminator)
   * as `/explain/stream` so proxy buffering cannot swallow the frames.
   */
  app.post(
    '/hint/stream',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user } = await requireAuth(request, env);
      const input = parseOrThrow(aiExplainSchema, request.body);

      const settings = await getSettings(env);
      const entitlements = await resolveEntitlements(user, settings);

      const { question, exam, provider } = await getDatasetClient(env).getQuestion(
        input.provider,
        input.exam,
        input.questionId,
      );

      // Without a model we can still offer the curated fallback, but there is
      // nothing to stream, so answer with a normal JSON response.
      if (!aiConfigured(env)) {
        return reply.send({
          hint: question.explanation?.slice(0, 220) || 'Review the key terms in the question stem.',
          degraded: true,
        });
      }

      const limit = aiDailyLimit(env, entitlements.plan);
      await assertWithinQuota(user.id, [{ field: 'aiExplanations', limit, label: 'AI hint' }]);

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      res.socket?.setNoDelay(true);

      const send = async (payload: unknown): Promise<void> => {
        if (res.writableEnded || res.destroyed) return;
        const ok = res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if (!ok) {
          await new Promise<void>((resolve) => {
            const done = () => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.once('drain', done);
            res.once('close', done);
          });
        }
      };

      let terminated = false;
      let wroteAny = false;
      try {
        for await (const chunk of streamChat(env, {
          // Hints stay deliberately short and must never reveal the answer key.
          messages: buildHintMessages(question, {
            examTitle: exam.title,
            examCode: exam.code,
            providerTitle: provider.title,
          }),
          maxTokens: 220,
          temperature: 0.4,
        })) {
          // Hints are a single short nudge; showing the model's planning text
          // here would be noise, so only answer-channel text is forwarded.
          if (chunk.type === 'delta' && chunk.channel === 'reasoning') continue;
          if (chunk.type === 'reasoning_start' || chunk.type === 'reasoning_end') continue;
          if (chunk.type === 'delta') wroteAny = true;
          if (chunk.type === 'done' || chunk.type === 'error') terminated = true;
          await send(chunk);
        }
      } catch (err) {
        request.log.error({ err }, 'ai.hint.stream_failed');
        terminated = true;
        await send({ type: 'error', message: 'The AI tutor is temporarily unavailable.' });
      } finally {
        if (!terminated) await send({ type: 'done' });
        if (!res.writableEnded) res.end();
        // A failed attempt still consumes the model call we already made.
        if (wroteAny || !terminated) {
          await incrementUsage(user.id, 'aiExplanations', 1).catch(() => undefined);
        }
      }
    },
  );

  /** A short nudge that never reveals the correct option. */
  app.post('/hint', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(aiExplainSchema, request.body);
    const settings = await getSettings(env);
    const entitlements = await resolveEntitlements(user, settings);
    // Hints are part of basic doubt clearing: open to every signed-in account.

    const { question, exam, provider } = await getDatasetClient(env).getQuestion(
      input.provider,
      input.exam,
      input.questionId,
    );
    if (!aiConfigured(env)) {
      return reply.send({ hint: question.explanation?.slice(0, 220) || 'Review the key terms in the question stem.', degraded: true });
    }

    const limit = aiDailyLimit(env, entitlements.plan);
    await assertWithinQuota(user.id, [{ field: 'aiExplanations', limit, label: 'AI hint' }]);

    try {
      const result = await chat(env, {
        messages: buildHintMessages(question, {
          examTitle: exam.title,
          examCode: exam.code,
          providerTitle: provider.title,
        }),
        maxTokens: 160,
        temperature: 0.4,
      });
      await incrementUsage(user.id, 'aiExplanations', 1);
      return reply.send({ hint: result.text, model: result.model, degraded: false });
    } catch {
      await incrementUsage(user.id, 'aiExplanations', 1);
      return reply.send({ hint: 'Focus on the key constraint in the scenario before eliminating options.', degraded: true });
    }
  });

  /** Free-form tutoring about the current question. */
  app.post('/assist', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(aiAssistSchema, request.body);
    const settings = await getSettings(env);
    const entitlements = await resolveEntitlements(user, settings);

    const limit = aiDailyLimit(env, entitlements.plan);
    await assertWithinQuota(user.id, [{ field: 'aiExplanations', limit, label: 'AI assistant message' }]);

    let context = '';
    if (input.questionId) {
      const { question, exam, provider } = await getDatasetClient(env).getQuestion(
        input.provider,
        input.exam,
        input.questionId,
      );
      context = [
        `Exam: ${exam.code} - ${exam.title} (${provider.title})`,
        `Question: ${question.stemText}`,
        question.choices.length
          ? `Choices:\n${question.choices.map((c) => `${c.key}. ${c.text}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (!aiConfigured(env)) {
      return reply.code(503).send({
        error: { code: 'AI_NOT_CONFIGURED', message: 'The assistant is unavailable right now.' },
      });
    }

    try {
      const result = await chat(env, {
        messages: [
          {
            role: 'system',
            content:
              'You are an exam tutor. Answer questions about certification content accurately and concisely (max 200 words). ' +
              'Plain text only, no markdown headings.',
          },
          { role: 'user', content: `${context}\n\nLearner question: ${input.question}`.trim() },
        ],
        maxTokens: Math.min(env.AI_MAX_TOKENS, 500),
        temperature: 0.3,
      });
      const usage = await incrementUsage(user.id, 'aiExplanations', 1);
      return reply.send({
        answer: result.text,
        model: result.model,
        remaining: Math.max(0, limit - usage.aiExplanations),
      });
    } catch (err) {
      if (err instanceof AiError) {
        return reply.code(503).send({
          error: { code: err.code, message: err.message },
          degraded: true,
        });
      }
      throw err;
    }
  });

  /* ---------------------------------------------------------------- */
  /* Tutor chat (persisted, streaming)                                 */
  /* ---------------------------------------------------------------- */

  app.get('/chat/conversations', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const conversations = await listConversations(user.id);
    return reply.send({ conversations });
  });

  app.post('/chat/conversations', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(aiChatStartSchema, request.body);
    const result = await createConversation(env, user, input);
    return reply.code(201).send(result);
  });

  /** Latest conversation anchored to a question, so the card can resume it. */
  app.get('/chat/by-question', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const query = request.query as { provider?: string; exam?: string; questionId?: string };
    if (!query.provider || !query.exam || !query.questionId) {
      throw badRequest('provider, exam and questionId are required.');
    }
    const conversation = await findQuestionConversation(
      user.id,
      query.provider,
      query.exam,
      query.questionId,
    );
    return reply.send({ conversation });
  });

  app.get('/chat/conversations/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    return reply.send(await getConversation(user.id, id));
  });

  app.patch('/chat/conversations/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const input = parseOrThrow(aiConversationRenameSchema, request.body);
    return reply.send({ conversation: await renameConversation(user.id, id, input.title) });
  });

  app.delete('/chat/conversations/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    await deleteConversation(user.id, id);
    return reply.code(204).send();
  });

  /**
   * Stream a tutor reply as Server-Sent Events. Text deltas arrive as
   * `{"type":"delta","text":"..."}` frames; the stream always terminates with
   * a `done` or `error` frame.
   */
  app.post(
    '/chat/conversations/:id/messages',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user } = await requireAuth(request, env);
      const { id } = request.params as { id: string };
      const input = parseOrThrow(aiChatMessageSchema, request.body);

      if (!aiConfigured(env)) {
        return reply.code(503).send({
          error: { code: 'AI_NOT_CONFIGURED', message: 'AI assistance is not configured on this server.' },
        });
      }
      const flags = await getFeatureFlags();
      if (!(flags.get('ai_explanations')?.enabled ?? true)) {
        return reply.code(503).send({
          error: { code: 'AI_DISABLED', message: 'The AI tutor is temporarily disabled.' },
        });
      }

      // Take over the socket: Fastify must not serialise a body for us.
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      // Keep small SSE frames from sitting in Nagle's buffer.
      res.socket?.setNoDelay(true);

      /**
       * Write one frame and wait for the socket to drain. Awaiting `drain` is
       * what keeps a fast token stream from outrunning the socket buffer —
       * without it the tail of long answers is silently dropped when the
       * response is ended.
       */
      const send = async (payload: unknown): Promise<void> => {
        if (res.writableEnded || res.destroyed) return;
        const ok = res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if (!ok) {
          await new Promise<void>((resolve) => {
            const done = () => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.once('drain', done);
            res.once('close', done);
          });
        }
      };

      let terminated = false;
      try {
        for await (const chunk of sendMessage(env, user, id, input)) {
          if (chunk.type === 'done' || chunk.type === 'error') terminated = true;
          await send(chunk);
        }
      } catch (err) {
        request.log.error({ err }, 'ai.chat.stream_failed');
        terminated = true;
        await send({ type: 'error', message: 'The AI tutor is temporarily unavailable.' });
      } finally {
        // Always give the client a terminator so it never hangs on a pending
        // assistant bubble, even if the generator ended without one.
        if (!terminated && !res.writableEnded && !res.destroyed) {
          await send({ type: 'done' });
        }
        if (!res.writableEnded) res.end();
      }
    },
  );
}

/**
 * True when the question is inside the free preview window (first N questions)
 * of an exam, so the free tier can try AI without unlocking everything.
 */
async function isWithinFreePreview(
  env: Env,
  providerId: string,
  examKey: string,
  questionId: string,
  window: number,
): Promise<boolean> {
  try {
    const { questions } = await getDatasetClient(env).getExamQuestions(providerId, examKey);
    const index = questions.findIndex((q) => q.id === questionId);
    return index >= 0 && index < window;
  } catch {
    return false;
  }
}

/**
 * Daily tutor allowance. The AI tutor is intentionally available to every
 * registered account: the per-plan limits only differ so that paying accounts
 * get a higher fair-use ceiling, never so that free accounts are locked out.
 */
export function aiDailyLimit(env: Env, plan: string): number {
  return plan === 'free' ? env.AI_DAILY_LIMIT_FREE : Math.max(env.AI_DAILY_LIMIT_FREE, env.AI_DAILY_LIMIT_PREMIUM);
}
