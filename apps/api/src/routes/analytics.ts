import type { FastifyInstance } from 'fastify';
import { practiceAnswersSchema } from '@examdump/shared';
import type { Env } from '../config/env.js';
import { requireAuth } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { getDb } from '../db/client.js';
import { examProgress, userStats } from '../db/schema/index.js';
import { eq, desc } from 'drizzle-orm';
import {
  getDashboard,
  getPerformanceSeries,
  getRecommendations,
  getWeakTopics,
  recordPracticeProgress,
  recordQuestionResults,
} from '../services/analytics.service.js';
import { getDatasetClient } from '../services/dataset.service.js';
import { canAccessExam, resolveEntitlements } from '../services/entitlement.service.js';
import { getSettings } from '../services/settings.service.js';
import { topicForQuestion } from '../lib/question-scope.js';

export async function analyticsRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.get('/dashboard', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const data = await getDashboard(user.id);
    return reply.send(data);
  });

  app.get('/weak-topics', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { limit } = request.query as { limit?: string };
    const topics = await getWeakTopics(user.id, Math.min(50, Number(limit) || 8));
    return reply.send({ topics });
  });

  app.get('/performance', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { days } = request.query as { days?: string };
    const series = await getPerformanceSeries(user.id, Math.min(365, Number(days) || 30));
    return reply.send({ series });
  });

  app.get('/progress', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const db = getDb();
    const [progress, [stats]] = await Promise.all([
      db.select().from(examProgress).where(eq(examProgress.userId, user.id)).orderBy(desc(examProgress.lastStudiedAt)),
      db.select().from(userStats).where(eq(userStats.userId, user.id)).limit(1),
    ]);
    return reply.send({ progress, stats: stats ?? null });
  });

  app.get('/recommendations', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const recommendations = await getRecommendations(user.id, 6);
    return reply.send({ recommendations });
  });

  /**
   * Record practice answers.
   *
   * Grading happens here, against the dataset, so a client can never submit its
   * own `correct` flag. Answers outside what the plan unlocks are ignored rather
   * than trusted, which keeps a free user from inflating their history.
   */
  app.post('/practice', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const input = parseOrThrow(practiceAnswersSchema, request.body);

    const [settings, dataset] = await Promise.all([
      getSettings(env),
      getDatasetClient(env).getExamQuestions(input.provider, input.exam),
    ]);
    const { provider, exam, questions } = dataset;
    const entitlements = await resolveEntitlements(user, settings);
    const unlimited = canAccessExam(entitlements, exam.key, provider.id);
    const accessible = unlimited ? questions : questions.slice(0, entitlements.questionsPerExam ?? 0);
    const byId = new Map(accessible.map((question) => [question.id, question]));

    const grades: Array<{ questionId: string; topic: string; correct: boolean }> = [];
    let correct = 0;
    let answered = 0;
    let studyMs = 0;

    for (const answer of input.answers) {
      const question = byId.get(answer.questionId);
      if (!question) continue;
      const selected = answer.selected.map((value) => value.toUpperCase()).sort();
      const expected = (question.answer ?? '').split('').sort().join('');
      const isCorrect = selected.length > 0 && expected.length > 0 && selected.join('') === expected;

      grades.push({
        questionId: question.id,
        topic: topicForQuestion(question, exam.code),
        correct: isCorrect,
      });
      if (selected.length > 0) answered += 1;
      if (isCorrect) correct += 1;
      studyMs += answer.timeSpentMs ?? 0;
    }

    if (grades.length === 0) return reply.send({ recorded: 0, correct: 0 });

    await recordQuestionResults(user.id, provider.id, exam.key, grades);
    const stats = await recordPracticeProgress({
      userId: user.id,
      providerId: provider.id,
      examKey: exam.key,
      examCode: exam.code,
      answered,
      correct,
      studyMs,
    });

    return reply.send({
      recorded: grades.length,
      correct,
      stats: {
        currentStreak: stats.currentStreak,
        totalQuestions: stats.totalQuestions,
        totalCorrect: stats.totalCorrect,
      },
    });
  });
}
