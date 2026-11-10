import type { FastifyInstance, FastifyRequest } from 'fastify';
import { examSearchQuerySchema, listQuestionsQuerySchema, toClientQuestion } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { optionalAuth, requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { notFound, quotaExceeded } from '../lib/errors.js';
import { getDatasetClient } from '../services/dataset.service.js';
import {
  getCatalogExam,
  getProviderExamsFromCatalog,
  listProviders,
  searchExams,
} from '../services/catalog.service.js';
import { getEntitlements, type Entitlements } from '../services/entitlement.service.js';
import { getSettings } from '../services/settings.service.js';
import { incrementUsage } from '../services/usage.service.js';

interface Context {
  entitlements: Entitlements;
  userId?: string;
}

async function resolveContext(request: FastifyRequest, env: Env): Promise<Context> {
  const [auth, settings] = await Promise.all([optionalAuth(request, env), getSettings(env)]);
  return {
    entitlements: getEntitlements(auth?.user, settings),
    userId: auth?.user?._id.toString(),
  };
}

export async function examRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/providers', async (request, reply) => {
    void request;
    let providers = await listProviders();
    if (providers.length === 0) {
      try {
        const live = await getDatasetClient(env).getProviders();
        providers = live.map((p) => ({
          _id: p.id as unknown,
          providerId: p.id,
          file: p.file,
          title: p.title,
          slug: p.slug,
          examCount: 0,
          totalQuestions: 0,
          syncedAt: new Date(),
        })) as typeof providers;
      } catch {
        providers = [];
      }
    }
    return reply.send({ providers });
  });

  app.get('/search', async (request, reply) => {
    const query = parseOrThrow(examSearchQuerySchema, request.query);
    const result = await searchExams(query);
    return reply.send(result);
  });

  app.get('/random', async (request, reply) => {
    const { provider } = parseOrThrow(examSearchQuerySchema, request.query);
    const result = await searchExams({ provider, sort: 'popular', page: 1, pageSize: 8 });
    const shuffled = [...result.items].sort(() => Math.random() - 0.5).slice(0, 4);
    return reply.send({ exams: shuffled });
  });

  app.get('/:providerId', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };

    interface ProviderView {
      providerId: string;
      title: string;
      slug: string;
      examCount: number;
      totalQuestions: number;
    }
    interface ExamView {
      providerId: string;
      providerTitle: string;
      providerSlug: string;
      key: string;
      code: string;
      title: string;
      slug: string;
      questionCount: number;
      syncedAt: Date;
    }

    let exams: ExamView[] = await getProviderExamsFromCatalog(providerId);
    const providers = await listProviders();
    const catalogProvider = providers.find(
      (p) => p.providerId === providerId || p.slug === providerId,
    );

    let provider: ProviderView | undefined = catalogProvider
      ? {
          providerId: catalogProvider.providerId,
          title: catalogProvider.title,
          slug: catalogProvider.slug,
          examCount: catalogProvider.examCount,
          totalQuestions: catalogProvider.totalQuestions,
        }
      : undefined;

    if (!provider) {
      // Live fallback so the product works before the first catalog sync.
      try {
        const live = await getDatasetClient(env).getProviderExams(providerId);
        provider = {
          providerId: live.provider.id,
          title: live.provider.title,
          slug: live.provider.slug,
          examCount: live.exams.length,
          totalQuestions: live.exams.reduce((s, e) => s + e.questionCount, 0),
        };
        exams = live.exams.map((e) => ({
          providerId: live.provider.id,
          providerTitle: live.provider.title,
          providerSlug: live.provider.slug,
          key: e.key,
          code: e.code,
          title: e.title,
          slug: '',
          questionCount: e.questionCount,
          syncedAt: new Date(),
        }));
      } catch {
        throw notFound('Provider not found');
      }
    }

    return reply.send({ provider, exams });
  });

  app.get('/:providerId/:examKey', async (request, reply) => {
    const { providerId, examKey } = request.params as { providerId: string; examKey: string };
    const ctx = await resolveContext(request, env);

    const catalogExam = await getCatalogExam(providerId, examKey);
    try {
      const { provider, exam, questions } = await getDatasetClient(env).getExamQuestions(providerId, examKey);
      const accessible = ctx.entitlements.unlimitedQuestions
        ? questions.length
        : Math.min(questions.length, ctx.entitlements.questionsPerExam ?? 0);

      return reply.send({
        provider: { id: provider.id, title: provider.title, slug: provider.slug },
        exam: {
          key: exam.key,
          code: exam.code,
          title: exam.title,
          questionCount: questions.length,
          providerId: provider.id,
          providerTitle: provider.title,
        },
        catalog: catalogExam,
        entitlement: {
          plan: ctx.entitlements.plan,
          accessibleQuestions: accessible,
          totalQuestions: questions.length,
          lockedQuestions: Math.max(0, questions.length - accessible),
          isLimited: !ctx.entitlements.unlimitedQuestions,
        },
      });
    } catch {
      if (catalogExam) {
        return reply.send({
          provider: { id: catalogExam.providerId, title: catalogExam.providerTitle, slug: catalogExam.providerSlug },
          exam: {
            key: catalogExam.key,
            code: catalogExam.code,
            title: catalogExam.title,
            questionCount: catalogExam.questionCount,
            providerId: catalogExam.providerId,
            providerTitle: catalogExam.providerTitle,
          },
          catalog: catalogExam,
          entitlement: {
            plan: ctx.entitlements.plan,
            accessibleQuestions: ctx.entitlements.unlimitedQuestions
              ? catalogExam.questionCount
              : Math.min(catalogExam.questionCount, ctx.entitlements.questionsPerExam ?? 0),
            totalQuestions: catalogExam.questionCount,
            lockedQuestions: 0,
            isLimited: !ctx.entitlements.unlimitedQuestions,
          },
        });
      }
      throw notFound('Exam not found');
    }
  });

  app.get('/:providerId/:examKey/questions', async (request, reply) => {
    const { providerId, examKey } = request.params as { providerId: string; examKey: string };
    const query = parseOrThrow(listQuestionsQuerySchema, request.query);
    const ctx = await resolveContext(request, env);

    const { provider, exam, questions } = await getDatasetClient(env).getExamQuestions(providerId, examKey);

    const isAssessment = query.mode === 'mock' || query.mode === 'timed';
    const includeAnswer = isAssessment ? false : (query.includeAnswer ?? true);

    let accessible = questions;
    let locked = 0;
    if (!ctx.entitlements.unlimitedQuestions) {
      const limit = ctx.entitlements.questionsPerExam ?? 0;
      // Free users can only ever see the first N questions. Offset/random are
      // ignored to make sure pagination or shuffling cannot bypass the limit.
      accessible = questions.slice(0, limit);
      locked = Math.max(0, questions.length - accessible.length);
    } else if (query.random) {
      accessible = [...questions].sort(() => Math.random() - 0.5);
    }

    const maxPerRequest = env.DATASET_MAX_QUESTIONS_PER_REQUEST;
    const offset = ctx.entitlements.unlimitedQuestions ? query.offset : 0;
    const requestedLimit = ctx.entitlements.unlimitedQuestions
      ? Math.min(query.limit ?? maxPerRequest, maxPerRequest)
      : accessible.length;

    const page = accessible.slice(offset, offset + requestedLimit);
    const clientQuestions = page.map((q) => toClientQuestion(q, includeAnswer));

    if (ctx.userId) {
      await incrementUsage(ctx.userId, 'questionsViewed', clientQuestions.length);
    }

    return reply.send({
      provider: { id: provider.id, title: provider.title, slug: provider.slug },
      exam: {
        key: exam.key,
        code: exam.code,
        title: exam.title,
        questionCount: questions.length,
        providerId: provider.id,
        providerTitle: provider.title,
      },
      questions: clientQuestions,
      entitlement: {
        plan: ctx.entitlements.plan,
        totalQuestions: questions.length,
        accessibleQuestions: accessible.length,
        returned: clientQuestions.length,
        lockedQuestions: locked,
        isLimited: !ctx.entitlements.unlimitedQuestions,
        offset,
        limit: requestedLimit,
      },
    });
  });

  app.get('/:providerId/:examKey/questions/:questionId', async (request, reply) => {
    const { providerId, examKey, questionId } = request.params as {
      providerId: string;
      examKey: string;
      questionId: string;
    };
    const ctx = await resolveContext(request, env);
    const { provider, exam, questions } = await getDatasetClient(env).getExamQuestions(providerId, examKey);

    const index = questions.findIndex((q) => q.id === questionId);
    if (index === -1) throw notFound('Question not found');

    if (!ctx.entitlements.unlimitedQuestions) {
      const limit = ctx.entitlements.questionsPerExam ?? 0;
      if (index >= limit) {
        throw quotaExceeded(
          `This question is part of the Premium set. Free accounts can access the first ${limit} questions of each exam.`,
          { limit, total: questions.length },
        );
      }
    }

    return reply.send({
      provider: { id: provider.id, title: provider.title, slug: provider.slug },
      exam: { key: exam.key, code: exam.code, title: exam.title },
      question: toClientQuestion(questions[index]!, true),
    });
  });

  // Authenticated helper used by the web app to know current limits.
  app.get('/entitlement/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const settings = await getSettings(env);
    return reply.send({ entitlements: getEntitlements(user, settings) });
  });
}