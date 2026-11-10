import type { FastifyInstance } from 'fastify';
import { completeAttemptSchema, startAttemptSchema, toClientQuestion } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { getDatasetClient } from '../services/dataset.service.js';
import { getEntitlements } from '../services/entitlement.service.js';
import { getSettings } from '../services/settings.service.js';
import { assertWithinQuota, incrementUsage } from '../services/usage.service.js';
import {
  recordExamProgress,
  recordQuestionResults,
  recordUserStats,
} from '../services/analytics.service.js';
import { createNotification } from '../services/notification.service.js';
import { Attempt, type AttemptAnswer } from '../db/models/index.js';
import { parsePage, paginate } from '../lib/pagination.js';

const MAX_MOCK_QUESTIONS = 60;

function topicFor(title: string | null, code: string): string {
  if (title) {
    const match = title.match(/topic\s+(\d+)/i);
    if (match?.[1]) return `Topic ${match[1]}`;
  }
  return code ? `${code} General` : 'General';
}

export async function attemptRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(startAttemptSchema, request.body);
    const settings = await getSettings(env);
    const entitlements = getEntitlements(user, settings);

    const { provider, exam, questions } = await getDatasetClient(env).getExamQuestions(
      input.provider,
      input.exam,
    );

    const accessible = entitlements.unlimitedQuestions
      ? questions
      : questions.slice(0, entitlements.questionsPerExam ?? 0);

    if (accessible.length === 0) throw notFound('No questions available for this exam.');

    let selectedIds: string[];
    if (input.questionIds && input.questionIds.length > 0) {
      const allowed = new Set(accessible.map((q) => q.id));
      const invalid = input.questionIds.filter((id) => !allowed.has(id));
      if (invalid.length > 0) {
        throw forbidden(
          entitlements.unlimitedQuestions
            ? 'One or more questions do not belong to this exam.'
            : `Free accounts can only practise the first ${entitlements.questionsPerExam} questions of this exam. Upgrade to Premium for the full set.`,
        );
      }
      selectedIds = [...new Set(input.questionIds)];
    } else {
      const pool = [...accessible];
      if (input.mode === 'random' || input.mode === 'mock' || input.mode === 'timed') {
        pool.sort(() => Math.random() - 0.5);
      }
      const count =
        input.mode === 'mock' || input.mode === 'timed'
          ? Math.min(pool.length, MAX_MOCK_QUESTIONS)
          : pool.length;
      selectedIds = pool.slice(0, count).map((q) => q.id);
    }

    if (selectedIds.length === 0) throw badRequest('No questions selected.');

    const byId = new Map(accessible.map((q) => [q.id, q]));
    const selectedQuestions = selectedIds
      .map((id) => byId.get(id))
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .map((q) => toClientQuestion(q, false));

    if (!entitlements.unlimitedQuestions && (input.mode === 'mock' || input.mode === 'timed')) {
      await assertWithinQuota(user._id, [
        { field: 'mockExams', limit: entitlements.mockExamsPerDay, label: 'mock exam' },
      ]);
    }

    const attempt = await Attempt.create({
      userId: user._id,
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
    });

    if (!entitlements.unlimitedQuestions && (input.mode === 'mock' || input.mode === 'timed')) {
      await incrementUsage(user._id, 'mockExams', 1);
    }

    return reply.code(201).send({
      attempt: {
        id: attempt._id.toString(),
        mode: attempt.mode,
        status: attempt.status,
        questionIds: attempt.questionIds,
        totalQuestions: attempt.totalQuestions,
        timeLimitSeconds: attempt.timeLimitSeconds,
        startedAt: attempt.startedAt,
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
        plan: entitlements.plan,
        accessibleQuestions: accessible.length,
        totalQuestions: questions.length,
        isLimited: !entitlements.unlimitedQuestions,
      },
    });
  });

  app.get('/', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const query = request.query as { page?: number; pageSize?: number; examKey?: string; status?: string };
    const page = parsePage(Number(query.page), Number(query.pageSize));
    const filter: Record<string, unknown> = { userId: user._id };
    if (query.examKey) filter.examKey = query.examKey;
    if (query.status) filter.status = query.status;

    const [items, total] = await Promise.all([
      Attempt.find(filter)
        .select('-answers')
        .sort({ createdAt: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean(),
      Attempt.countDocuments(filter),
    ]);
    return reply.send(paginate(items, total, page));
  });

  app.get('/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const attempt = await Attempt.findOne({ _id: id, userId: user._id }).lean();
    if (!attempt) throw notFound('Attempt not found');
    return reply.send({ attempt: { ...attempt, id: attempt._id.toString() } });
  });

  app.post('/:id/complete', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    const input = parseOrThrow(completeAttemptSchema, request.body);

    const attempt = await Attempt.findOne({ _id: id, userId: user._id });
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

      const graded: AttemptAnswer = {
        questionId,
        selected,
        correct: isCorrect,
        timeSpentMs: answer?.timeSpentMs ?? 0,
      };
      gradedAnswers.push(graded);
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

    attempt.answers = gradedAnswers;
    attempt.status = 'completed';
    attempt.completedAt = new Date();
    attempt.answeredCount = answeredCount;
    attempt.correctCount = correctCount;
    attempt.scorePercent = scorePercent;
    attempt.timeSpentMs = input.timeSpentMs ?? timeSpent;
    await attempt.save();

    await recordQuestionResults(
      user._id,
      attempt.providerId,
      attempt.examKey,
      detailed.map((d) => ({ questionId: d.questionId, topic: d.topic, correct: d.correct })),
    );
    await recordExamProgress(
      user._id,
      attempt.providerId,
      attempt.examKey,
      attempt.examCode,
      answeredCount,
      correctCount,
      scorePercent,
    );
    const stats = await recordUserStats({
      userId: user._id,
      answered: answeredCount,
      correct: correctCount,
      studyMs: attempt.timeSpentMs,
      isMock: attempt.mode === 'mock' || attempt.mode === 'timed',
    });

    if (scorePercent === 100 && answeredCount > 0) {
      await createNotification({
        userId: user._id,
        type: 'achievement',
        title: 'Perfect score!',
        body: `You scored 100% on ${attempt.examCode}. Outstanding work.`,
        link: '/dashboard',
      });
    } else if ([3, 7, 14, 30, 100].includes(stats.currentStreak)) {
      await createNotification({
        userId: user._id,
        type: 'streak',
        title: `${stats.currentStreak}-day streak!`,
        body: 'Keep the momentum going. Consistency is the fastest path to passing.',
        link: '/dashboard',
      });
    }

    return reply.send({
      attempt: {
        id: attempt._id.toString(),
        status: attempt.status,
        totalQuestions: total,
        answeredCount,
        correctCount,
        scorePercent,
        timeSpentMs: attempt.timeSpentMs,
        completedAt: attempt.completedAt,
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
    const attempt = await Attempt.findOne({ _id: id, userId: user._id });
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.status === 'completed') throw badRequest('Completed attempts cannot be abandoned.');
    attempt.status = 'abandoned';
    await attempt.save();
    return reply.send({ success: true });
  });
}