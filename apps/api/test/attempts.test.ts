import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, registerVerifiedUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

interface StartBody {
  attempt: { id: string; questionIds: string[]; totalQuestions: number };
  questions: Array<{ id: string; answer: string | null }>;
}

interface CompleteBody {
  attempt: { correctCount: number; totalQuestions: number; scorePercent: number; answeredCount: number };
  results: Array<{ questionId: string; correct: boolean; correctAnswer: string }>;
  stats: { currentStreak: number; totalQuestions: number; totalCorrect: number };
}

describe('attempts, grading and analytics', () => {
  it('starts a practice attempt with only accessible questions', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: { provider: 'cisco', exam: '200-301', mode: 'practice' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as StartBody;
    expect(body.attempt.questionIds).toHaveLength(5);
    expect(body.questions).toHaveLength(5);
    expect(body.questions.every((q) => q.answer === null)).toBe(true);
  });

  it('refuses attempts that include locked questions', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: {
        provider: 'cisco',
        exam: '200-301',
        mode: 'practice',
        questionIds: ['Question #: 1', 'Question #: 9'],
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('grades server-side, updates stats and streak', async () => {
    const user = await registerVerifiedUser(app);
    const start = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: { provider: 'cisco', exam: '200-301', mode: 'practice' },
    });
    const started = start.json() as StartBody;

    const complete = await app.inject({
      method: 'POST',
      url: `/api/attempts/${started.attempt.id}/complete`,
      headers: { cookie: user.cookie },
      payload: {
        answers: started.attempt.questionIds.slice(0, 3).map((questionId) => ({ questionId, selected: ['A'] })),
        timeSpentMs: 12_000,
      },
    });
    expect(complete.statusCode).toBe(200);
    const body = complete.json() as CompleteBody;
    expect(body.attempt.correctCount).toBe(3);
    expect(body.attempt.answeredCount).toBe(3);
    expect(body.attempt.totalQuestions).toBe(5);
    expect(body.attempt.scorePercent).toBe(60);
    expect(body.results.filter((r) => r.correct)).toHaveLength(3);
    expect(body.results[0]?.correctAnswer).toBe('A');
    expect(body.stats.currentStreak).toBe(1);

    const dashboard = await app.inject({
      method: 'GET',
      url: '/api/analytics/dashboard',
      headers: { cookie: user.cookie },
    });
    expect(dashboard.statusCode).toBe(200);
    const data = dashboard.json() as {
      stats: { totalQuestions: number; totalCorrect: number; accuracy: number; currentStreak: number };
      weakTopics: Array<{ topic: string }>;
    };
    expect(data.stats.totalQuestions).toBe(3);
    expect(data.stats.totalCorrect).toBe(3);
    expect(data.stats.accuracy).toBe(100);
    expect(data.stats.currentStreak).toBe(1);
    expect(data.weakTopics.length).toBeGreaterThan(0);
  });

  it('enforces the free mock-exam daily quota', async () => {
    const user = await registerVerifiedUser(app);
    const first = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: { provider: 'cisco', exam: '200-301', mode: 'mock' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: { provider: 'cisco', exam: '200-301', mode: 'mock' },
    });
    expect(second.statusCode).toBe(403);
    expect((second.json() as { error: { code: string } }).error.code).toBe('QUOTA_EXCEEDED');
  });

  it('gives premium users unlimited mock exams', async () => {
    const user = await registerVerifiedUser(app);
    await app.inject({
      method: 'POST',
      url: '/api/subscriptions',
      headers: { cookie: user.cookie },
      payload: { planId: 'premium-monthly', billingCycle: 'monthly' },
    });
    for (let i = 0; i < 2; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: { cookie: user.cookie },
        payload: { provider: 'cisco', exam: '200-301', mode: 'mock' },
      });
      expect(response.statusCode).toBe(201);
    }
  });
});