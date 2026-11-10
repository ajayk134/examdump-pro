import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';
import { completeAttemptSchema, startAttemptSchema, toClientQuestion } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { getDatasetClient } from '../services/dataset.service.js';
import { canAccessExam, resolveEntitlements } from '../services/entitlement.service.js';
import { getSettings } from '../services/settings.service.js';
import { assertWithinQuota, incrementUsage } from '../services/usage.service.js';
import {
  recordExamProgress,
  recordQuestionResults,
  recordUserStats,
} from '../services/analytics.service.js';
import { createNotification } from '../services/notification.service.js';
import { getDb } from '../db/client.js';
import { attempts, type AttemptAnswer } from '../db/schema/index.js';
import { parsePage, paginate } from '../lib/pagination.js';

const MAX_MOCK_QUESTIONS = 60;

function topicFor(title: string | null, code: string): string {
  if (title) {
    const match = title.match(/topic\s+(\d+)/i);
    if (match?.[1]) return `Topic ${match[1]}`;
  }
  return code ? `${code} General` : 'General';
}

const attemptSummaryColumns = {
  id: attempts.id,
  userId: attempts.userId,
  providerId: attempts.providerId,
  providerTitle: attempts.providerTitle,
  examKey: attempts.examKey,
  examCode: attempts.examCode,
  mode: attempts.mode,
  status: attempts.status,
  totalQuestions: attempts.totalQuestions,
  answeredCount: attempts.answeredCount,
  correctCount: attempts.correctCount,
  scorePercent: attempts.scorePercent,
  timeLimitSeconds: attempts.timeLimitSeconds,
  timeSpentMs: attempts.timeSpentMs,
  startedAt: attempts.startedAt,
  completedAt: attempts.completedAt,
  createdAt: attempts.createdAt,
  updatedAt: attempts.updatedAt,
};

export async function attemptRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(startAttemptSchema, request.body);
    const settings = await getSettings(env);
    const entitlements = await resolveEntitlements(user, settings);

    const { provider, exam, questions } = await getDatasetClient(env).getExamQuestions(
      input.provider,
      input.exam,
    );

    const unlimited = canAccessExam(entitlements, exam.key, provider.id);
    const accessible = unlimited ? questions : questions.slice(0, entitlements.questionsPerExam ?? 0);

    if (accessible.length === 0) throw notFound('No questions available for this exam.');

    let selectedIds: string[];
    if (input.questionIds && input.questionIds.length > 0) {
      const allowed = new Set(accessible.map((q) => q.id));
      const invalid = input.questionIds.filter((id) => !allowed.has(id));
      if (invalid.length > 0) {
        throw forbidden(
          unlimited
            ? 'One or more questions do not belong to this exam.'
            : `Your current plan only unlocks the first ${entitlements.questionsPerExam} questions of this exam.`,
        );
      }
      selectedIds = [...new Set(input.questionIds)];
    } else {
      const pool = [...accessible];
      if (input.mode === 'random' || input.mode === 'mock' || input.mode === 'timed') {
        pool.sort(() => Math.random() - 0.5);
      }
      const count = input.mode === 'mock' || input.mode === 'timed' ? Math.min(pool.length, MAX_MOCK_QUESTIONS) : pool.length;
      selectedIds = pool.slice(0, count).map((q) => q.id);
    }

    if (selectedIds.length === 0) throw badRequest('No questions selected.');

    const byId = new Map(accessible.map((q) => [q.id, q]));
    const selectedQuestions = selectedIds
      .map((id) => byId.get(id))
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .map((q) => toClientQuestion(q, false));

    if (!unlimited && (input.mode === 'mock' || input.mode === 'timed')) {
      await assertWithinQuota(user.id, [
        { field: 'mockExams', limit: entitlements.mockExamsPerDay, label: 'mock exam' },
      ]);
    }

    const db = getDb();
    const [attempt] = await db
      .insert(attempts)
      .values({
        userId: user.id,
        providerId: provider.id,
        providerTitle: provider.title,
        examKey: exam.key,
        examCode: exam.code,
        mode: input.mode,
        status: 'in_progress',
        questionIds: selectedIds,
        totalQuestions: selectedIds.length,
        timeLimitSeconds: input.timeLimitSeconds ?? null,
        startedAt: new Date(),
      })
      .returning();

    if (!unlimited && (input.mode === 'mock' || input.mode === 'timed')) {
      await incrementUsage(user.id, 'mockExams', 1);
    }

    return reply.code(201).send({
      attempt: {
        id: attempt!.id,
        mode: attempt!.mode,
        status: attempt!.status,
        questionIds: attempt!.questionIds,
        totalQuestions: attempt!.totalQuestions,
        timeLimitSeconds: attempt!.timeLimitSeconds,
        startedAt: attempt!.startedAt,
      },
      exam: {
        key: exam.key,
        code: exam.code,
        title: exam.title,
        providerId: provider.id,
        providerTitle: provider.title,
      },
      questions: selectedQuestions,
      entitlement: {
        plan: unlimited ? 'premium' : 'free',
        accessibleQuestions: accessible.length,
        totalQuestions: questions.length,
        isLimited: !unlimited,
      },
    });
  });

  app.get('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const query = request.query as { page?: number; pageSize?: number; examKey?: string; status?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const conditions = [eq(attempts.userId, user.id)];
    if (query.examKey) conditions.push(eq(attempts.examKey, query.examKey));
    if (query.status) conditions.push(eq(attempts.status, query.status as never));

    const db = getDb();
    const [items, [totalRow]] = await Promise.all([
      db
        .select(attemptSummaryColumns)
        .from(attempts)
        .where(and(...conditions))
        .orderBy(desc(attempts.createdAt))
        .offset(page.skip)
        .limit(page.limit),
      db.select({ value: count() }).from(attempts).where(and(...conditions)),
    ]);
    return reply.send(paginate(items, Number(totalRow?.value ?? 0), page));
  });

  app.get('/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const [attempt] = await getDb()
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, id), eq(attempts.userId, user.id)))
      .limit(1);
    if (!attempt) throw notFound('Attempt not found');
    return reply.send({ attempt });
  });

  app.post('/:id/complete', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const input = parseOrThrow(completeAttemptSchema, request.body);
    const db = getDb();

    const [attempt] = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, id), eq(attempts.userId, user.id)))
      .limit(1);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.status === 'completed') throw badRequest('This attempt has already been submitted.');

    const { questions } = await getDatasetClient(env).getExamQuestions(attempt.providerId, attempt.examKey);
    const byId = new Map(questions.map((q) => [q.id, q]));
    const submitted = new Map(input.answers.map((a) => [a.questionId, a]));

    const gradedAnswers: AttemptAnswer[] = [];
    const detailed: Array<{
      questionId: string;
      selected: string[];
      correctAnswer: string;
      correct: boolean;
      explanation: string;
      topic: string;
    }> = [];

    let correctCount = 0;
    let answeredCount = 0;
    let timeSpent = 0;

    for (const questionId of attempt.questionIds) {
      const question = byId.get(questionId);
      const answer = submitted.get(questionId);
      const selected = (answer?.selected ?? []).map((s) => s.toUpperCase()).sort();
      const correctAnswer = question?.answer ?? '';
      const expected = correctAnswer.split('').sort().join('');
      const isCorrect = Boolean(question) && selected.join('') === expected && expected.length > 0;

      if (selected.length > 0) answeredCount += 1;
      if (isCorrect) correctCount += 1;
      timeSpent += answer?.timeSpentMs ?? 0;

      gradedAnswers.push({ questionId, selected, correct: isCorrect, timeSpentMs: answer?.timeSpentMs ?? 0 });
      detailed.push({
        questionId,
        selected,
        correctAnswer,
        correct: isCorrect,
        explanation: question?.explanation ?? '',
        topic: topicFor(question?.title ?? null, attempt.examCode),
      });
    }

    const total = attempt.questionIds.length;
    const scorePercent = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const finalTimeSpent = input.timeSpentMs ?? timeSpent;

    await db
      .update(attempts)
      .set({
        answers: gradedAnswers,
        status: 'completed',
        completedAt: new Date(),
        answeredCount,
        correctCount,
        scorePercent,
        timeSpentMs: finalTimeSpent,
        updatedAt: new Date(),
      })
      .where(eq(attempts.id, attempt.id));

    await recordQuestionResults(
      user.id,
      attempt.providerId,
      attempt.examKey,
      detailed.map((d) => ({ questionId: d.questionId, topic: d.topic, correct: d.correct })),
    );
    await recordExamProgress(
      user.id,
      attempt.providerId,
      attempt.examKey,
      attempt.examCode,
      answeredCount,
      correctCount,
      scorePercent,
    );
    const stats = await recordUserStats({
      userId: user.id,
      answered: answeredCount,
      correct: correctCount,
      studyMs: finalTimeSpent,
      isMock: attempt.mode === 'mock' || attempt.mode === 'timed',
    });

    if (scorePercent === 100 && answeredCount > 0) {
      await createNotification({
        userId: user.id,
        type: 'achievement',
        title: 'Perfect score!',
        body: `You scored 100% on ${attempt.examCode}. Outstanding work.`,
        link: '/dashboard',
      });
    } else if ([3, 7, 14, 30, 100].includes(stats.currentStreak)) {
      await createNotification({
        userId: user.id,
        type: 'streak',
        title: `${stats.currentStreak}-day streak!`,
        body: 'Keep the momentum going. Consistency is the fastest path to passing.',
        link: '/dashboard',
      });
    }

    return reply.send({
      attempt: {
        id: attempt.id,
        status: 'completed',
        totalQuestions: total,
        answeredCount,
        correctCount,
        scorePercent,
        timeSpentMs: finalTimeSpent,
        completedAt: new Date().toISOString(),
      },
      results: detailed,
      stats: {
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        totalQuestions: stats.totalQuestions,
        totalCorrect: stats.totalCorrect,
      },
    });
  });

  app.post('/:id/abandon', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const db = getDb();
    const [attempt] = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, id), eq(attempts.userId, user.id)))
      .limit(1);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.status === 'completed') throw badRequest('Completed attempts cannot be abandoned.');
    await db.update(attempts).set({ status: 'abandoned', updatedAt: new Date() }).where(eq(attempts.id, attempt.id));
    return reply.send({ success: true });
  });
}
