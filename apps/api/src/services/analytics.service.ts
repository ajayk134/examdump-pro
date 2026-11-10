import { and, asc, count, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  attempts,
  catalogExams,
  examProgress,
  questionResults,
  userStats,
  users,
} from '../db/schema/index.js';
import { todayKey } from './usage.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeNextStreak(
  lastActiveDate: string,
  currentStreak: number,
  today: string,
): { streak: number; isNewDay: boolean } {
  if (lastActiveDate === today) return { streak: Math.max(1, currentStreak), isNewDay: false };
  if (!lastActiveDate) return { streak: 1, isNewDay: true };
  const last = new Date(`${lastActiveDate}T00:00:00.000Z`).getTime();
  const now = new Date(`${today}T00:00:00.000Z`).getTime();
  const diffDays = Math.round((now - last) / DAY_MS);
  if (diffDays === 1) return { streak: currentStreak + 1, isNewDay: true };
  return { streak: 1, isNewDay: true };
}

export interface AttemptOutcome {
  userId: string;
  answered: number;
  correct: number;
  studyMs: number;
  isMock: boolean;
}

export async function recordUserStats(outcome: AttemptOutcome) {
  const db = getDb();
  const today = todayKey();
  const [existing] = await db.select().from(userStats).where(eq(userStats.userId, outcome.userId)).limit(1);
  const { streak } = computeNextStreak(existing?.lastActiveDate ?? '', existing?.currentStreak ?? 0, today);

  if (!existing) {
    const [created] = await db
      .insert(userStats)
      .values({
        userId: outcome.userId,
        totalQuestions: outcome.answered,
        totalCorrect: outcome.correct,
        totalStudyMs: outcome.studyMs,
        mockTests: outcome.isMock ? 1 : 0,
        currentStreak: streak,
        longestStreak: streak,
        lastActiveDate: today,
      })
      .returning();
    return created!;
  }

  const [updated] = await db
    .update(userStats)
    .set({
      totalQuestions: existing.totalQuestions + outcome.answered,
      totalCorrect: existing.totalCorrect + outcome.correct,
      totalStudyMs: existing.totalStudyMs + outcome.studyMs,
      mockTests: existing.mockTests + (outcome.isMock ? 1 : 0),
      currentStreak: streak,
      longestStreak: Math.max(existing.longestStreak, streak),
      lastActiveDate: today,
      updatedAt: new Date(),
    })
    .where(eq(userStats.userId, outcome.userId))
    .returning();
  return updated!;
}

export interface QuestionGrade {
  questionId: string;
  topic: string;
  correct: boolean;
}

export async function recordQuestionResults(
  userId: string,
  providerId: string,
  examKey: string,
  grades: QuestionGrade[],
): Promise<void> {
  if (grades.length === 0) return;
  const db = getDb();
  const now = new Date();
  await db
    .insert(questionResults)
    .values(
      grades.map((g) => ({
        userId,
        providerId,
        examKey,
        questionId: g.questionId,
        topic: g.topic,
        attempts: 1,
        correct: g.correct ? 1 : 0,
        lastCorrect: g.correct,
        lastAttemptAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [questionResults.userId, questionResults.examKey, questionResults.questionId],
      set: {
        attempts: sql`${questionResults.attempts} + 1`,
        correct: sql`${questionResults.correct} + excluded.correct`,
        lastCorrect: sql`excluded.last_correct`,
        lastAttemptAt: sql`excluded.last_attempt_at`,
        topic: sql`excluded.topic`,
      },
    });
}

export async function recordExamProgress(
  userId: string,
  providerId: string,
  examKey: string,
  examCode: string,
  answered: number,
  correct: number,
  scorePercent: number,
): Promise<void> {
  const db = getDb();
  const wrong = Math.max(0, answered - correct);
  const now = new Date();
  await db
    .insert(examProgress)
    .values({
      userId,
      providerId,
      examKey,
      examCode,
      questionsSeen: answered,
      questionsCorrect: correct,
      questionsWrong: wrong,
      attempts: 1,
      bestScore: scorePercent,
      lastStudiedAt: now,
    })
    .onConflictDoUpdate({
      target: [examProgress.userId, examProgress.examKey],
      set: {
        questionsSeen: sql`${examProgress.questionsSeen} + excluded.questions_seen`,
        questionsCorrect: sql`${examProgress.questionsCorrect} + excluded.questions_correct`,
        questionsWrong: sql`${examProgress.questionsWrong} + excluded.questions_wrong`,
        attempts: sql`${examProgress.attempts} + 1`,
        bestScore: sql`greatest(${examProgress.bestScore}, excluded.best_score)`,
        examCode: sql`excluded.exam_code`,
        lastStudiedAt: sql`excluded.last_studied_at`,
        updatedAt: now,
      },
    });
}

export async function getWeakTopics(userId: string, limit = 8) {
  const db = getDb();
  const rows = await db
    .select({
      topic: questionResults.topic,
      attempts: sql<number>`sum(${questionResults.attempts})::int`,
      correct: sql<number>`sum(${questionResults.correct})::int`,
      questions: sql<number>`count(*)::int`,
    })
    .from(questionResults)
    .where(eq(questionResults.userId, userId))
    .groupBy(questionResults.topic)
    .having(sql`sum(${questionResults.attempts}) >= 1`)
    .orderBy(
      asc(sql`case when sum(${questionResults.attempts}) > 0 then (sum(${questionResults.correct})::numeric / sum(${questionResults.attempts})) else 0 end`),
      desc(sql`sum(${questionResults.attempts})`),
    )
    .limit(limit);

  return rows.map((r) => ({
    topic: r.topic,
    attempts: Number(r.attempts),
    correct: Number(r.correct),
    questions: Number(r.questions),
    accuracy: Number(r.attempts) > 0 ? Math.round((Number(r.correct) / Number(r.attempts)) * 100) : 0,
  }));
}

export async function getPerformanceSeries(userId: string, days = 30) {
  const db = getDb();
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await db
    .select({
      date: sql<string>`to_char(${attempts.completedAt}, 'YYYY-MM-DD')`,
      attempts: sql<number>`count(*)::int`,
      questions: sql<number>`coalesce(sum(${attempts.answeredCount}), 0)::int`,
      correct: sql<number>`coalesce(sum(${attempts.correctCount}), 0)::int`,
    })
    .from(attempts)
    .where(and(eq(attempts.userId, userId), eq(attempts.status, 'completed'), gte(attempts.completedAt, since)))
    .groupBy(sql`to_char(${attempts.completedAt}, 'YYYY-MM-DD')`)
    .orderBy(asc(sql`to_char(${attempts.completedAt}, 'YYYY-MM-DD')`));

  return rows.map((r) => ({
    date: r.date,
    attempts: Number(r.attempts),
    questions: Number(r.questions),
    correct: Number(r.correct),
    accuracy: Number(r.questions) > 0 ? Math.round((Number(r.correct) / Number(r.questions)) * 100) : 0,
  }));
}

function examView(exam: typeof catalogExams.$inferSelect) {
  return {
    key: exam.key,
    code: exam.code,
    title: exam.title,
    providerId: exam.providerId,
    providerTitle: exam.providerTitle,
    questionCount: exam.questionCount,
  };
}

export async function getRecommendations(userId: string, limit = 4) {
  const db = getDb();
  const progress = await db
    .select()
    .from(examProgress)
    .where(eq(examProgress.userId, userId))
    .orderBy(desc(examProgress.lastStudiedAt))
    .limit(20);

  const started = new Set(progress.map((p) => p.examKey));
  const weak = [...progress]
    .filter((p) => p.questionsSeen > 0)
    .sort((a, b) => {
      const accA = a.questionsSeen ? a.questionsCorrect / a.questionsSeen : 1;
      const accB = b.questionsSeen ? b.questionsCorrect / b.questionsSeen : 1;
      return accA - accB;
    })
    .slice(0, 2);

  const recommendations: Array<{ reason: string; exam: ReturnType<typeof examView> }> = [];
  for (const p of weak) {
    const [exam] = await db.select().from(catalogExams).where(eq(catalogExams.key, p.examKey)).limit(1);
    if (exam) recommendations.push({ reason: 'Focus area - improve your weakest exam', exam: examView(exam) });
  }

  const providerIds = [...new Set(progress.map((p) => p.providerId))];
  if (recommendations.length < limit) {
    const startedKeys = [...started];
    const conditions = startedKeys.length ? [notInArray(catalogExams.key, startedKeys)] : [];
    if (providerIds.length) conditions.push(inArray(catalogExams.providerId, providerIds));
    const popular = await db
      .select()
      .from(catalogExams)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(catalogExams.questionCount))
      .limit(limit - recommendations.length);
    for (const exam of popular) {
      recommendations.push({
        reason: providerIds.length ? 'Continue in your favourite provider' : 'Popular with learners',
        exam: examView(exam),
      });
    }
  }

  if (recommendations.length === 0) {
    const popular = await db.select().from(catalogExams).orderBy(desc(catalogExams.questionCount)).limit(limit);
    for (const exam of popular) {
      recommendations.push({ reason: 'Popular with learners', exam: examView(exam) });
    }
  }

  return recommendations.slice(0, limit);
}

export async function getDashboard(userId: string) {
  const db = getDb();
  const [[stats], recentAttempts, progress, weakTopics, series, recommendations] = await Promise.all([
    db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    db.select().from(attempts).where(eq(attempts.userId, userId)).orderBy(desc(attempts.createdAt)).limit(8),
    db.select().from(examProgress).where(eq(examProgress.userId, userId)).orderBy(desc(examProgress.lastStudiedAt)).limit(8),
    getWeakTopics(userId, 6),
    getPerformanceSeries(userId, 30),
    getRecommendations(userId, 4),
  ]);

  const totalAnswered = stats?.totalQuestions ?? 0;
  const accuracy = totalAnswered > 0 ? Math.round(((stats?.totalCorrect ?? 0) / totalAnswered) * 100) : 0;

  return {
    stats: {
      totalQuestions: totalAnswered,
      totalCorrect: stats?.totalCorrect ?? 0,
      accuracy,
      currentStreak: stats?.currentStreak ?? 0,
      longestStreak: stats?.longestStreak ?? 0,
      totalStudyMs: stats?.totalStudyMs ?? 0,
      mockTests: stats?.mockTests ?? 0,
    },
    recentAttempts,
    progress,
    weakTopics,
    performance: series,
    recommendations,
  };
}

export async function getLeaderboard(period: 'all' | 'month' = 'all', limit = 20) {
  const db = getDb();
  const conditions = [eq(attempts.status, 'completed')];
  if (period === 'month') conditions.push(gte(attempts.completedAt, new Date(Date.now() - 30 * DAY_MS)));

  const rows = await db
    .select({
      userId: attempts.userId,
      name: users.name,
      avatarUrl: users.avatarUrl,
      plan: users.plan,
      correct: sql<number>`sum(${attempts.correctCount})::int`,
      answered: sql<number>`sum(${attempts.answeredCount})::int`,
      attempts: sql<number>`count(*)::int`,
    })
    .from(attempts)
    .innerJoin(users, eq(users.id, attempts.userId))
    .where(and(...conditions))
    .groupBy(attempts.userId, users.name, users.avatarUrl, users.plan)
    .having(sql`sum(${attempts.answeredCount}) > 0`)
    .orderBy(desc(sql`sum(${attempts.correctCount})`))
    .limit(limit);

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    avatarUrl: r.avatarUrl,
    plan: r.plan,
    correct: Number(r.correct),
    answered: Number(r.answered),
    attempts: Number(r.attempts),
    accuracy: Number(r.answered) > 0 ? Math.round((Number(r.correct) / Number(r.answered)) * 100) : 0,
  }));
}

export { count };
