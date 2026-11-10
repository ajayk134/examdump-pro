import type { Types } from 'mongoose';
import {
  Attempt,
  CatalogExam,
  ExamProgress,
  QuestionResult,
  UserStats,
  type UserStatsDoc,
} from '../db/models/index.js';
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
  userId: Types.ObjectId | string;
  answered: number;
  correct: number;
  studyMs: number;
  isMock: boolean;
}

export async function recordUserStats(outcome: AttemptOutcome): Promise<UserStatsDoc> {
  const today = todayKey();
  let stats = await UserStats.findOne({ userId: outcome.userId });
  if (!stats) {
    stats = await UserStats.create({ userId: outcome.userId });
  }
  const { streak } = computeNextStreak(stats.lastActiveDate, stats.currentStreak, today);

  stats.totalQuestions += outcome.answered;
  stats.totalCorrect += outcome.correct;
  stats.totalStudyMs += outcome.studyMs;
  if (outcome.isMock) stats.mockTests += 1;
  stats.currentStreak = streak;
  stats.longestStreak = Math.max(stats.longestStreak, streak);
  stats.lastActiveDate = today;
  await stats.save();
  return stats;
}

export interface QuestionGrade {
  questionId: string;
  topic: string;
  correct: boolean;
}

export async function recordQuestionResults(
  userId: Types.ObjectId | string,
  providerId: string,
  examKey: string,
  grades: QuestionGrade[],
): Promise<void> {
  if (grades.length === 0) return;
  await QuestionResult.bulkWrite(
    grades.map((g) => ({
      updateOne: {
        filter: { userId, examKey, questionId: g.questionId },
        update: {
          $setOnInsert: { providerId, examKey, questionId: g.questionId },
          $inc: { attempts: 1, correct: g.correct ? 1 : 0 },
          $set: { lastCorrect: g.correct, lastAttemptAt: new Date(), topic: g.topic },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function recordExamProgress(
  userId: Types.ObjectId | string,
  providerId: string,
  examKey: string,
  examCode: string,
  answered: number,
  correct: number,
  scorePercent: number,
): Promise<void> {
  const existing = await ExamProgress.findOneAndUpdate(
    { userId, examKey },
    {
      $inc: { questionsSeen: answered, questionsCorrect: correct, attempts: 1 },
      $set: { providerId, examCode, lastStudiedAt: new Date() },
      $max: { bestScore: scorePercent },
      $setOnInsert: { questionsWrong: 0 },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  const wrong = Math.max(0, answered - correct);
  await ExamProgress.updateOne({ _id: existing._id }, { $inc: { questionsWrong: wrong } });
}

export async function getWeakTopics(userId: Types.ObjectId | string, limit = 8) {
  return QuestionResult.aggregate([
    { $match: { userId } },
    {
      $group: {
        _id: '$topic',
        attempts: { $sum: '$attempts' },
        correct: { $sum: '$correct' },
        questions: { $sum: 1 },
      },
    },
    {
      $project: {
        topic: '$_id',
        _id: 0,
        attempts: 1,
        correct: 1,
        questions: 1,
        accuracy: {
          $cond: [{ $gt: ['$attempts', 0] }, { $round: [{ $multiply: [{ $divide: ['$correct', '$attempts'] }, 100] }, 0] }, 0],
        },
      },
    },
    { $match: { attempts: { $gte: 1 } } },
    { $sort: { accuracy: 1, attempts: -1 } },
    { $limit: limit },
  ]);
}

export async function getPerformanceSeries(userId: Types.ObjectId | string, days = 30) {
  const since = new Date(Date.now() - days * DAY_MS);
  return Attempt.aggregate([
    { $match: { userId, status: 'completed', completedAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } },
        attempts: { $sum: 1 },
        questions: { $sum: '$answeredCount' },
        correct: { $sum: '$correctCount' },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id',
        attempts: 1,
        questions: 1,
        correct: 1,
        accuracy: {
          $cond: [{ $gt: ['$questions', 0] }, { $round: [{ $multiply: [{ $divide: ['$correct', '$questions'] }, 100] }, 0] }, 0],
        },
      },
    },
    { $sort: { date: 1 } },
  ]);
}

export async function getRecommendations(userId: Types.ObjectId | string, limit = 4) {
  const progress = await ExamProgress.find({ userId })
    .sort({ lastStudiedAt: -1 })
    .limit(20)
    .lean();

  const started = new Set(progress.map((p) => p.examKey));
  const weak = [...progress]
    .filter((p) => p.questionsSeen > 0)
    .sort((a, b) => {
      const accA = a.questionsSeen ? a.questionsCorrect / a.questionsSeen : 1;
      const accB = b.questionsSeen ? b.questionsCorrect / b.questionsSeen : 1;
      return accA - accB;
    })
    .slice(0, 2);

  const recommendations: Array<Record<string, unknown>> = [];

  for (const p of weak) {
    const exam = await CatalogExam.findOne({ key: p.examKey }).lean();
    if (exam) {
      recommendations.push({
        reason: 'Focus area - improve your weakest exam',
        exam: {
          key: exam.key,
          code: exam.code,
          title: exam.title,
          providerId: exam.providerId,
          providerTitle: exam.providerTitle,
          questionCount: exam.questionCount,
        },
      });
    }
  }

  if (recommendations.length < limit) {
    const providerIds = [...new Set(progress.map((p) => p.providerId))];
    const popular = await CatalogExam.find({
      key: { $nin: [...started] },
      ...(providerIds.length ? { providerId: { $in: providerIds } } : {}),
    })
      .sort({ questionCount: -1 })
      .limit(limit - recommendations.length)
      .lean();
    for (const exam of popular) {
      recommendations.push({
        reason: providerIds.length ? 'Continue in your favourite provider' : 'Popular with learners',
        exam: {
          key: exam.key,
          code: exam.code,
          title: exam.title,
          providerId: exam.providerId,
          providerTitle: exam.providerTitle,
          questionCount: exam.questionCount,
        },
      });
    }
  }

  if (recommendations.length === 0) {
    const popular = await CatalogExam.find().sort({ questionCount: -1 }).limit(limit).lean();
    for (const exam of popular) {
      recommendations.push({
        reason: 'Popular with learners',
        exam: {
          key: exam.key,
          code: exam.code,
          title: exam.title,
          providerId: exam.providerId,
          providerTitle: exam.providerTitle,
          questionCount: exam.questionCount,
        },
      });
    }
  }

  return recommendations.slice(0, limit);
}

export async function getDashboard(userId: Types.ObjectId | string) {
  const [stats, recentAttempts, progress, weakTopics, series, recommendations] = await Promise.all([
    UserStats.findOne({ userId }).lean(),
    Attempt.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
    ExamProgress.find({ userId }).sort({ lastStudiedAt: -1 }).limit(8).lean(),
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
  const match: Record<string, unknown> = {};
  if (period === 'month') {
    match.completedAt = { $gte: new Date(Date.now() - 30 * DAY_MS) };
  }
  const rows = await Attempt.aggregate([
    { $match: { status: 'completed', ...match } },
    {
      $group: {
        _id: '$userId',
        correct: { $sum: '$correctCount' },
        answered: { $sum: '$answeredCount' },
        attempts: { $sum: 1 },
      },
    },
    { $match: { answered: { $gt: 0 } } },
    { $sort: { correct: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
        pipeline: [{ $project: { name: 1, avatarUrl: 1, plan: 1 } }],
      },
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        name: '$user.name',
        avatarUrl: '$user.avatarUrl',
        plan: '$user.plan',
        correct: 1,
        answered: 1,
        attempts: 1,
        accuracy: { $round: [{ $multiply: [{ $divide: ['$correct', '$answered'] }, 100] }, 0] },
      },
    },
  ]);
  return rows;
}