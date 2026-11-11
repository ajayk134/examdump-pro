import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, extractCookies, loginAdmin, registerVerifiedUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('authentication', () => {
  it('registers, verifies and logs a user in', async () => {
    const email = `auth_${Date.now()}@test.local`;
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Alice', email, password: 'Str0ngPass', acceptTerms: true },
    });
    expect(register.statusCode).toBe(201);
    const body = register.json() as { user: { emailVerified: boolean }; devVerificationUrl: string };
    expect(body.user.emailVerified).toBe(false);
    expect(body.devVerificationUrl).toContain('token=');

    const token = new URL(body.devVerificationUrl).searchParams.get('token')!;
    const verify = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } });
    expect(verify.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'Str0ngPass' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = extractCookies(login);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string; emailVerified: boolean } }).user).toMatchObject({
      email,
      emailVerified: true,
    });
  });

  it('rejects duplicate emails', async () => {
    const user = await registerVerifiedUser(app);
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Copy', email: user.email, password: 'Str0ngPass', acceptTerms: true },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('rejects weak passwords', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Weak', email: `weak_${Date.now()}@test.local`, password: 'short', acceptTerms: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects invalid credentials', async () => {
    const user = await registerVerifiedUser(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'WrongPass123' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rotates the refresh token', async () => {
    const user = await registerVerifiedUser(app);
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: user.cookie },
    });
    expect(refresh.statusCode).toBe(200);
    expect(extractCookies(refresh)).toContain('ed_refresh=');
  });

  it('supports password reset', async () => {
    const user = await registerVerifiedUser(app);
    const forgot = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: user.email },
    });
    expect(forgot.statusCode).toBe(200);
    const devUrl = (forgot.json() as { devResetUrl?: string }).devResetUrl;
    expect(devUrl).toBeTruthy();
    const token = new URL(devUrl!).searchParams.get('token')!;

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'NewPass1234' },
    });
    expect(reset.statusCode).toBe(200);

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'NewPass1234' },
    });
    expect(relogin.statusCode).toBe(200);
  });

  it('forbids admin endpoints to non-admins and allows admins', async () => {
    const user = await registerVerifiedUser(app);
    const denied = await app.inject({ method: 'GET', url: '/api/admin/stats', headers: { cookie: user.cookie } });
    expect(denied.statusCode).toBe(403);

    const adminCookie = await loginAdmin(app);
    const allowed = await app.inject({ method: 'GET', url: '/api/admin/stats', headers: { cookie: adminCookie } });
    expect(allowed.statusCode).toBe(200);
  });

  it('requires authentication for /auth/me', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('logs out and invalidates the session', async () => {
    const user = await registerVerifiedUser(app);
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: user.cookie } });
    expect(logout.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: user.cookie } });
    expect(me.statusCode).toBe(401);
  });

  // Regression: /register used to return a user but never set the session
  // cookies, so the browser stayed anonymous and the next navigation bounced
  // the brand-new account to /login.
  it('registers with a live session so the dashboard is reachable immediately', async () => {
    const email = `newsession_${Date.now()}@test.local`;
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'New Session', email, password: 'Str0ngPass', acceptTerms: true },
    });
    expect(register.statusCode).toBe(201);

    const cookie = extractCookies(register);
    expect(cookie).toContain('ed_access=');
    expect(cookie).toContain('ed_refresh=');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe(email);
  });

  // Regression: the access cookie expires after 15 minutes. A valid refresh
  // cookie must be able to mint a fresh access token without a password.
  it('refreshes an expired access cookie using only the refresh cookie', async () => {
    const user = await registerVerifiedUser(app);
    const refreshCookie = user.cookie
      .split('; ')
      .filter((part) => part.startsWith('ed_refresh='))
      .join('; ');
    expect(refreshCookie).toContain('ed_refresh=');

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: refreshCookie },
    });
    expect(refreshed.statusCode).toBe(200);

    const newCookie = extractCookies(refreshed);
    expect(newCookie).toContain('ed_access=');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: newCookie } });
    expect(me.statusCode).toBe(200);
  });

  it('rejects a refresh without a refresh cookie', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
    expect(response.statusCode).toBe(401);
  });
});
