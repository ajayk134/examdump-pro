import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createTestContext,
  loginAdmin,
  registerVerifiedUser,
  subscribeUser,
  type RegisteredUser,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;
let adminCookie: string;
let user: RegisteredUser;

const examUrl = '/api/exams/cisco/200-301';
const otherExamUrl = '/api/exams/cisco/100-890';

async function setProvider(enabled: boolean, providerId = 'cisco') {
  return app.inject({
    method: 'PATCH',
    url: `/api/admin/catalog/providers/${providerId}`,
    headers: { cookie: adminCookie },
    payload: { enabled },
  });
}

async function setExam(enabled: boolean, examKey = '200-301') {
  return app.inject({
    method: 'PATCH',
    url: `/api/admin/catalog/exams/cisco/${examKey}`,
    headers: { cookie: adminCookie },
    payload: { enabled },
  });
}

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
  adminCookie = await loginAdmin(app);
  user = await registerVerifiedUser(app);
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('admin exam visibility', () => {
  it('requires the exams.manage permission to change visibility', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/catalog/providers/cisco',
      headers: { cookie: user.cookie },
      payload: { enabled: false },
    });
    expect(response.statusCode).toBe(403);
  });

  it('defaults every provider and exam to visible for regular users', async () => {
    const providers = await app.inject({ method: 'GET', url: '/api/exams/providers' });
    expect(providers.statusCode).toBe(200);
    expect(providers.json().providers.map((p: { providerId: string }) => p.providerId)).toContain('cisco');

    const exam = await app.inject({ method: 'GET', url: examUrl });
    expect(exam.statusCode).toBe(200);
  });

  it('hides a disabled exam but keeps its siblings, and still allows admins', async () => {
    expect((await setExam(false)).statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: examUrl })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${examUrl}/questions` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${examUrl}/practice-options` })).statusCode).toBe(404);

    // The sibling exam is unaffected.
    expect((await app.inject({ method: 'GET', url: otherExamUrl })).statusCode).toBe(200);

    // Search no longer surfaces it.
    const search = await app.inject({ method: 'GET', url: '/api/exams/search?q=200-301' });
    expect(search.json().items).toHaveLength(0);

    // The provider listing only shows the remaining exam.
    const provider = await app.inject({ method: 'GET', url: '/api/exams/cisco' });
    expect(provider.json().exams.map((e: { key: string }) => e.key)).toEqual(['100-890']);

    // Admins can still preview the hidden exam.
    const adminView = await app.inject({ method: 'GET', url: examUrl, headers: { cookie: adminCookie } });
    expect(adminView.statusCode).toBe(200);

    // A mock attempt cannot be started against a hidden exam.
    const attempt = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: { cookie: user.cookie },
      payload: { provider: 'cisco', exam: '200-301', mode: 'mock' },
    });
    expect(attempt.statusCode).toBe(404);

    expect((await setExam(true)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: examUrl })).statusCode).toBe(200);
  });

  it('hides an entire provider and every exam under it', async () => {
    // Recommendations are a discovery surface too.
    const beforeRecs = await app.inject({
      method: 'GET',
      url: '/api/analytics/recommendations',
      headers: { cookie: user.cookie },
    });
    expect(beforeRecs.json().recommendations.length).toBeGreaterThan(0);

    expect((await setProvider(false)).statusCode).toBe(200);

    const providers = await app.inject({ method: 'GET', url: '/api/exams/providers' });
    expect(providers.json().providers).toHaveLength(0);

    const recs = await app.inject({
      method: 'GET',
      url: '/api/analytics/recommendations',
      headers: { cookie: user.cookie },
    });
    expect(recs.json().recommendations).toHaveLength(0);

    expect((await app.inject({ method: 'GET', url: '/api/exams/cisco' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: examUrl })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: otherExamUrl })).statusCode).toBe(404);

    const search = await app.inject({ method: 'GET', url: '/api/exams/search?q=cisco' });
    expect(search.json().items).toHaveLength(0);

    // Admin still sees the hidden provider and its exams.
    const adminProvider = await app.inject({
      method: 'GET',
      url: '/api/exams/cisco',
      headers: { cookie: adminCookie },
    });
    expect(adminProvider.statusCode).toBe(200);

    expect((await setProvider(true)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: examUrl })).statusCode).toBe(200);
  });

  it('never revokes an existing subscription or entitlement when hiding', async () => {
    await subscribeUser(app, user.cookie, 'all-30');
    const before = await app.inject({ method: 'GET', url: '/api/subscriptions/me', headers: { cookie: user.cookie } });
    expect(before.json().subscription).not.toBeNull();

    expect((await setExam(false)).statusCode).toBe(200);

    // The hidden exam is inaccessible, but the subscription and entitlement remain.
    expect((await app.inject({ method: 'GET', url: examUrl })).statusCode).toBe(404);
    const after = await app.inject({ method: 'GET', url: '/api/subscriptions/me', headers: { cookie: user.cookie } });
    expect(after.statusCode).toBe(200);
    expect(after.json().subscription).not.toBeNull();
    expect(after.json().entitlements).toBeTruthy();

    expect((await setExam(true)).statusCode).toBe(200);
    // Access is restored without re-purchasing anything.
    expect((await app.inject({ method: 'GET', url: examUrl })).statusCode).toBe(200);
  });

  it('lists providers and exams for the admin console', async () => {
    const providers = await app.inject({
      method: 'GET',
      url: '/api/admin/catalog/providers',
      headers: { cookie: adminCookie },
    });
    expect(providers.statusCode).toBe(200);
    const cisco = providers.json().providers.find((p: { providerId: string }) => p.providerId === 'cisco');
    expect(cisco).toMatchObject({ enabled: true });
    expect(cisco.enabledExamCount).toBe(2);

    const exams = await app.inject({
      method: 'GET',
      url: '/api/admin/catalog/providers/cisco/exams',
      headers: { cookie: adminCookie },
    });
    expect(exams.statusCode).toBe(200);
    expect(exams.json().exams.map((e: { key: string }) => e.key).sort()).toEqual(['100-890', '200-301']);
  });

  it('records an audit entry for each visibility change', async () => {
    const audit = await app.inject({
      method: 'GET',
      url: '/api/admin/audit?pageSize=50',
      headers: { cookie: adminCookie },
    });
    const actions = (audit.json().items as Array<{ action: string }>).map((row) => row.action);
    expect(actions).toContain('admin.provider_disabled');
    expect(actions).toContain('admin.exam_disabled');
  });
});
