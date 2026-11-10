import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, loginAdmin, registerVerifiedUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;
let adminCookie: string;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
  adminCookie = await loginAdmin(app);
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('admin console', () => {
  it('returns platform statistics', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/stats', headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { users: { total: number }; catalog: { providers: number } };
    expect(body.users.total).toBeGreaterThanOrEqual(1);
    expect(body.catalog.providers).toBe(1);
  });

  it('lists and updates users', async () => {
    const user = await registerVerifiedUser(app, { name: 'Managed User' });
    const list = await app.inject({ method: 'GET', url: '/api/admin/users?q=Managed', headers: { cookie: adminCookie } });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    const suspend = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.userId}`,
      headers: { cookie: adminCookie },
      payload: { suspended: true },
    });
    expect(suspend.statusCode).toBe(200);
    expect((suspend.json() as { user: { suspended: boolean } }).user.suspended).toBe(true);

    const blockedLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: user.password },
    });
    expect(blockedLogin.statusCode).toBe(401);
  });

  it('updates entitlement settings which apply immediately', async () => {
    const update = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: { cookie: adminCookie },
      payload: { freeQuestionsPerExam: 3 },
    });
    expect(update.statusCode).toBe(200);

    const user = await registerVerifiedUser(app);
    const questions = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco/200-301/questions?limit=50',
      headers: { cookie: user.cookie },
    });
    expect((questions.json() as { questions: unknown[] }).questions).toHaveLength(3);

    await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: { cookie: adminCookie },
      payload: { freeQuestionsPerExam: 5 },
    });
  });

  it('records audit events', async () => {
    await registerVerifiedUser(app);
    const response = await app.inject({ method: 'GET', url: '/api/admin/audit?pageSize=50', headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ action: string }> };
    expect(body.items.some((item) => item.action === 'user.register')).toBe(true);
  });

  it('syncs the dataset catalogue from the injected client', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/dataset/sync',
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { result: { providers: number; exams: number } };
    expect(body.result.providers).toBe(2);
    expect(body.result.exams).toBeGreaterThanOrEqual(2);

    const status = await app.inject({ method: 'GET', url: '/api/admin/dataset/status', headers: { cookie: adminCookie } });
    expect((status.json() as { exams: number }).exams).toBeGreaterThanOrEqual(2);
  });
});