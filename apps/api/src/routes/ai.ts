import type { FastifyInstance } from 'fastify';
import { aiAssistSchema, aiExplainSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest } from '../lib/errors.js';
import { getDatasetClient } from '../services/dataset.service.js';
import { canAccessExam, resolveEntitlements } from '../services/entitlement.service.js';
import { getSettings, getFeatureFlags } from '../services/settings.service.js';
import { assertWithinQuota, getDailyUsage, incrementUsage } from '../services/usage.service.js';
import {
  aiConfigured,
  AiError,
  buildExplanationMessages,
  buildHintMessages,
  chat,
  offlineExplanation,
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
    const limit = entitlements.plan === 'premium' ? env.AI_DAILY_LIMIT_PREMIUM : env.AI_DAILY_LIMIT_FREE;
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
    const unlimited = canAccessExam(entitlements, input.exam, input.provider);

    const { question, exam, provider } = await getDatasetClient(env).getQuestion(
      input.provider,
      input.exam,
      input.questionId,
    );

    const limit = entitlements.plan === 'premium' ? env.AI_DAILY_LIMIT_PREMIUM : env.AI_DAILY_LIMIT_FREE;
    await assertWithinQuota(user.id, [{ field: 'aiExplanations', limit, label: 'AI explanation' }]);

    // Free preview: the first N questions of an exam are explainable so the
    // free tier still demonstrates the feature; anything else requires access.
    const freeWindow = entitlements.questionsPerExam ?? 5;
    const allowedByPreview = await isWithinFreePreview(env, input.provider, input.exam, input.questionId, freeWindow);
    if (!unlimited && !allowedByPreview) {
      return reply.code(402).send({
        error: {
          code: 'UPGRADE_REQUIRED',
          message: 'AI explanations for this question need a plan. Unlock the exam to continue.',
        },
        questionId: question.id,
        upgradeUrl: '/pricing',
      });
    }

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

  /** A short nudge that never reveals the correct option. */
  app.post('/hint', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(aiExplainSchema, request.body);
    const settings = await getSettings(env);
    const entitlements = await resolveEntitlements(user, settings);
    const unlimited = canAccessExam(entitlements, input.exam, input.provider);
    const freeWindow = entitlements.questionsPerExam ?? 5;
    if (!unlimited && !(await isWithinFreePreview(env, input.provider, input.exam, input.questionId, freeWindow))) {
      return reply.code(402).send({
        error: { code: 'UPGRADE_REQUIRED', message: 'Hints for this question need a plan.' },
      });
    }

    const { question, exam, provider } = await getDatasetClient(env).getQuestion(
      input.provider,
      input.exam,
      input.questionId,
    );
    if (!aiConfigured(env)) {
      return reply.send({ hint: question.explanation?.slice(0, 220) || 'Review the key terms in the question stem.', degraded: true });
    }

    const limit = entitlements.plan === 'premium' ? env.AI_DAILY_LIMIT_PREMIUM : env.AI_DAILY_LIMIT_FREE;
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

    const limit = entitlements.plan === 'premium' ? env.AI_DAILY_LIMIT_PREMIUM : env.AI_DAILY_LIMIT_FREE;
    await assertWithinQuota(user.id, [{ field: 'aiExplanations', limit, label: 'AI assistant message' }]);

    let context = '';
    if (input.questionId) {
      const { question, exam, provider } = await getDatasetClient(env).getQuestion(
        input.provider,
        input.exam,
        input.questionId,
      );
      const unlimited = canAccessExam(entitlements, input.exam, input.provider);
      const freeWindow = entitlements.questionsPerExam ?? 5;
      if (!unlimited && !(await isWithinFreePreview(env, input.provider, input.exam, input.questionId, freeWindow))) {
        throw badRequest('Unlock this exam to ask the assistant about it.');
      }
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
