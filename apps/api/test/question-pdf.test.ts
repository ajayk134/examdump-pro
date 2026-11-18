import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createTestContext,
  registerVerifiedUser,
  subscribeUser,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

const pdfUrl = '/api/exams/cisco/200-301/questions.pdf';

describe('question bank PDF', () => {
  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: pdfUrl })).statusCode).toBe(401);
  });

  it('refuses users without full exam access', async () => {
    const { cookie } = await registerVerifiedUser(app);
    const response = await app.inject({ method: 'GET', url: pdfUrl, headers: { cookie } });
    expect(response.statusCode).toBe(403);
  });

  it('streams the complete bank as a PDF and allows repeated downloads', async () => {
    const user = await registerVerifiedUser(app);
    await subscribeUser(app, user.cookie, 'all-30');

    await app.inject({
      method: 'POST',
      url: '/api/community/votes',
      headers: { cookie: user.cookie },
      payload: {
        provider: 'cisco',
        exam: '200-301',
        questionId: 'Question #: 1',
        choice: 'A',
      },
    });

    const first = await app.inject({ method: 'GET', url: pdfUrl, headers: { cookie: user.cookie } });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('application/pdf');
    expect(first.headers['content-disposition']).toContain('200-301-question-bank.pdf');
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(first.rawPayload.length).toBeGreaterThan(5_000);

    const second = await app.inject({ method: 'GET', url: pdfUrl, headers: { cookie: user.cookie } });
    expect(second.statusCode).toBe(200);
    expect(second.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});