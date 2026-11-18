import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createTestContext,
  DATASET,
  registerVerifiedUser,
  subscribeUser,
  type RegisteredUser,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  const exams = DATASET['data/cisco/exams.json'] as Record<string, Record<string, number>>;
  exams.cisco!['big-250'] = 250;
  DATASET['data/cisco/big-250.json'] = {
    'big-250': Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => {
        const number = index + 1;
        return [
          `Question #: ${number}`,
          {
            Title: `Big bank topic ${Math.ceil(number / 50)} question ${number}`,
            Question: { content: [{ type: 'text', value: `Practice question number ${number}.` }] },
            Choices: {
              A: { content: [{ type: 'text', value: 'A. Correct option' }] },
              B: { content: [{ type: 'text', value: 'B. Distractor' }] },
            },
            Answer: { content: [{ type: 'text', value: 'Suggested Answer: A' }] },
            Explanation: { content: [{ type: 'text', value: 'Option A is correct because it is.' }] },
            Vote_count: [],
          },
        ];
      }),
    ),
  };

  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

interface Facets {
  focus: Array<{ id: string; count: number }>;
}

interface OptionsBody {
  facets: Facets;
  accessibleQuestions: number;
  totalQuestions: number;
  signedIn: boolean;
  entitlement: { isLimited: boolean };
}

interface QuestionsBody {
  questions: Array<{ id: string; type: string }>;
  entitlement: { accessibleQuestions: number; lockedQuestions: number };
}

function focusCount(body: OptionsBody, id: string): number {
  return body.facets.focus.find((entry) => entry.id === id)?.count ?? -1;
}

async function premiumUser(): Promise<RegisteredUser> {
  const user = await registerVerifiedUser(app);
  await subscribeUser(app, user.cookie, 'all-30');
  return user;
}

describe('practice targeting', () => {
  it('reports facets over only what the plan unlocks', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/practice-options',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as OptionsBody;
    expect(body.totalQuestions).toBe(10);
    expect(body.accessibleQuestions).toBe(5);
    expect(body.signedIn).toBe(true);
    expect(body.entitlement.isLimited).toBe(true);
    expect(focusCount(body, 'all')).toBe(5);
    expect(focusCount(body, 'unseen')).toBe(5);
    expect(focusCount(body, 'missed')).toBe(0);
  });

  it('exposes the full bank for an all-access learner', async () => {
    const user = await premiumUser();
    const response = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/practice-options',
      headers: { cookie: user.cookie },
    });

    const body = response.json() as OptionsBody;
    expect(body.accessibleQuestions).toBe(10);
    expect(body.entitlement.isLimited).toBe(false);
    expect(focusCount(body, 'all')).toBe(10);
  });

  it('ignores legacy topic and question-type filters', async () => {
    const user = await premiumUser();

    const byTopic = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?topic=Topic%205&types=multiple&limit=50&mode=practice&includeAnswer=true',
      headers: { cookie: user.cookie },
    });
    const body = byTopic.json() as QuestionsBody;
    expect(body.questions.map((question) => question.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Question #: ${index + 1}`),
    );
  });

  it('keeps the free limit even when legacy filters are supplied', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?topic=Topic%205&types=multiple&limit=10&mode=practice&includeAnswer=true',
      headers: { cookie: user.cookie },
    });

    const body = response.json() as QuestionsBody;
    expect(body.questions.map((question) => question.id)).toEqual([
      'Question #: 1',
      'Question #: 2',
      'Question #: 3',
      'Question #: 4',
      'Question #: 5',
    ]);
    expect(body.entitlement.lockedQuestions).toBe(5);
  });

  it('returns every question beyond 200 in backend order for full access', async () => {
    const user = await premiumUser();

    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/big-250/questions?limit=200&offset=0&mode=practice&includeAnswer=true',
      headers: { cookie: user.cookie },
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json() as QuestionsBody;
    expect(firstBody.questions).toHaveLength(200);
    expect(firstBody.questions[0]?.id).toBe('Question #: 1');
    expect(firstBody.questions[199]?.id).toBe('Question #: 200');

    const secondPage = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/big-250/questions?limit=200&offset=200&mode=practice&includeAnswer=true',
      headers: { cookie: user.cookie },
    });
    const secondBody = secondPage.json() as QuestionsBody;
    expect(secondBody.questions).toHaveLength(50);
    expect(secondBody.questions[0]?.id).toBe('Question #: 201');
    expect(secondBody.questions[49]?.id).toBe('Question #: 250');

    const allAtOnce = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/big-250/questions?limit=5000&mode=practice&includeAnswer=true',
      headers: { cookie: user.cookie },
    });
    const allBody = allAtOnce.json() as QuestionsBody;
    expect(allBody.questions).toHaveLength(250);
    expect(allBody.questions.map((question) => question.id)).toEqual(
      Array.from({ length: 250 }, (_, index) => `Question #: ${index + 1}`),
    );
  });

  it('requires authentication to record practice answers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/analytics/practice',
      payload: { provider: 'cisco', exam: '200-301', answers: [{ questionId: 'Question #: 1', selected: ['A'] }] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('grades practice answers on the server and feeds the focus buckets', async () => {
    const user = await premiumUser();

    const recorded = await app.inject({
      method: 'POST',
      url: '/api/analytics/practice',
      headers: { cookie: user.cookie },
      payload: {
        provider: 'cisco',
        exam: '200-301',
        answers: [
          // Fixture questions all have "A" as the answer.
          { questionId: 'Question #: 1', selected: ['A'], timeSpentMs: 3000 },
          { questionId: 'Question #: 2', selected: ['B'], timeSpentMs: 4000 },
        ],
      },
    });
    expect(recorded.statusCode).toBe(200);
    const recordedBody = recorded.json() as { recorded: number; correct: number };
    expect(recordedBody.recorded).toBe(2);
    expect(recordedBody.correct).toBe(1);

    const options = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/practice-options',
      headers: { cookie: user.cookie },
    });
    const body = options.json() as OptionsBody;
    expect(focusCount(body, 'mastered')).toBe(1);
    expect(focusCount(body, 'missed')).toBe(1);
    expect(focusCount(body, 'unseen')).toBe(8);

    const missed = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?focus=missed&limit=10&mode=practice&includeAnswer=true',
      headers: { cookie: user.cookie },
    });
    expect((missed.json() as QuestionsBody).questions.map((question) => question.id)).toEqual(['Question #: 2']);
  });

  it('cannot inflate progress with answers outside the unlocked bank', async () => {
    const user = await registerVerifiedUser(app);
    const recorded = await app.inject({
      method: 'POST',
      url: '/api/analytics/practice',
      headers: { cookie: user.cookie },
      payload: {
        provider: 'cisco',
        exam: '200-301',
        answers: [{ questionId: 'Question #: 9', selected: ['A'], timeSpentMs: 1000 }],
      },
    });
    expect(recorded.statusCode).toBe(200);
    expect((recorded.json() as { recorded: number }).recorded).toBe(0);
  });

  it('starts a mock with an explicit count and timer', async () => {
    const user = await premiumUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: {
        provider: 'cisco',
        exam: '200-301',
        mode: 'timed',
        count: 3,
        timeLimitSeconds: 600,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      attempt: { totalQuestions: number; timeLimitSeconds: number; mode: string; questionIds: string[] };
      questions: unknown[];
    };
    expect(body.attempt.totalQuestions).toBe(3);
    expect(body.attempt.questionIds).toHaveLength(3);
    expect(body.attempt.timeLimitSeconds).toBe(600);
    expect(body.attempt.mode).toBe('timed');
    expect(body.questions).toHaveLength(3);
  });

  it('caps a mock at the questions the free plan unlocks', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: { provider: 'cisco', exam: '200-301', mode: 'timed', count: 10, timeLimitSeconds: 600 },
    });

    expect(response.statusCode).toBe(201);
    expect((response.json() as { attempt: { totalQuestions: number } }).attempt.totalQuestions).toBe(5);
  });

  it('ignores legacy attempt type filters instead of starting an empty attempt', async () => {
    const user = await premiumUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: { provider: 'cisco', exam: '200-301', mode: 'mock', types: ['multiple'], count: 10 },
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as { attempt: { totalQuestions: number } }).attempt.totalQuestions).toBe(10);
  });
});