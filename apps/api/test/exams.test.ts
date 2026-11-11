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

interface QuestionsBody {
  questions: Array<{ id: string; answer: string | null; choices: unknown[] }>;
  entitlement: { plan: string; accessibleQuestions: number; returned: number; lockedQuestions: number; isLimited: boolean };
}

describe('exam catalogue and entitlement enforcement', () => {
  it('lists providers and search results from the catalogue', async () => {
    const providers = await app.inject({ method: 'GET', url: '/api/exams/providers' });
    expect(providers.statusCode).toBe(200);
    expect((providers.json() as { providers: Array<{ providerId: string }> }).providers[0]?.providerId).toBe('cisco');

    const search = await app.inject({ method: 'GET', url: '/api/exams/search?q=200-301' });
    expect(search.statusCode).toBe(200);
    expect((search.json() as { items: Array<{ code: string }> }).items[0]?.code).toBe('200-301');
  });

  it('returns provider detail with exams', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/exams/cisco' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { provider: { title: string }; exams: unknown[] };
    expect(body.provider.title).toBe('Cisco');
    expect(body.exams).toHaveLength(2);
  });

  it('limits anonymous/free access to 5 questions per exam', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?limit=50',
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as QuestionsBody;
    expect(body.questions).toHaveLength(5);
    expect(body.entitlement).toMatchObject({ plan: 'free', isLimited: true, lockedQuestions: 5 });
    expect(body.questions.map((q) => q.id)).toEqual([
      'Question #: 1',
      'Question #: 2',
      'Question #: 3',
      'Question #: 4',
      'Question #: 5',
    ]);
  });

  it('ignores offset/random attempts to bypass the free limit', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?limit=50&offset=5&random=true',
      headers: { cookie: user.cookie },
    });
    const body = response.json() as QuestionsBody;
    expect(body.questions).toHaveLength(5);
    expect(body.entitlement.lockedQuestions).toBe(5);
  });

  it('blocks direct access to locked questions', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions/Question%20%23%3A%206',
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('QUOTA_EXCEEDED');
  });

  it('unlocks the full question set for all-exam plans', async () => {
    const user = await registerVerifiedUser(app);
    const subscribe = await app.inject({
      method: 'POST',
      url: '/api/payments/mock-activate',
      headers: { cookie: user.cookie },
      payload: { planId: 'all-30' },
    });
    expect(subscribe.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?limit=50',
      headers: { cookie: user.cookie },
    });
    const body = response.json() as QuestionsBody;
    expect(body.entitlement.plan).toBe('premium');
    expect(body.entitlement.isLimited).toBe(false);
    expect(body.questions).toHaveLength(10);
    expect(body.entitlement.lockedQuestions).toBe(0);
  });

  it('scopes a single-exam plan to only that exam', async () => {
    const user = await registerVerifiedUser(app);
    const subscribe = await app.inject({
      method: 'POST',
      url: '/api/payments/mock-activate',
      headers: { cookie: user.cookie },
      payload: { planId: 'single-30', examKey: '100-890' },
    });
    expect(subscribe.statusCode).toBe(201);

    const owned = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/100-890/questions?limit=50',
      headers: { cookie: user.cookie },
    });
    expect((owned.json() as QuestionsBody).entitlement.isLimited).toBe(false);

    const other = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?limit=50',
      headers: { cookie: user.cookie },
    });
    const otherBody = other.json() as QuestionsBody;
    expect(otherBody.entitlement.plan).toBe('free');
    expect(otherBody.entitlement.isLimited).toBe(true);
    expect(otherBody.questions).toHaveLength(5);
  });

  it('hides answers for assessment modes', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?mode=mock&limit=50',
      headers: { cookie: user.cookie },
    });
    const body = response.json() as QuestionsBody;
    expect(body.questions.every((q) => q.answer === null)).toBe(true);
  });

  it('returns 404 for an unknown exam', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/exams/cisco/999-999/questions' });
    expect(response.statusCode).toBe(404);
  });
});