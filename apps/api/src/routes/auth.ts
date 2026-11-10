import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@examdump/shared';
import type { Env } from '../config/env.js';
import { parseOrThrow } from '../lib/validation.js';
import { requireAuth, getRefreshToken } from '../lib/guards.js';
import { clearAuthCookies, setAuthCookies } from '../lib/cookies.js';
import { serializeUser } from '../lib/serializers.js';
import { unauthorized } from '../lib/errors.js';
import * as authService from '../services/auth.service.js';
import type { RequestMeta } from '../services/auth.service.js';
import { recordAudit } from '../services/audit.service.js';

function meta(request: { ip: string; headers: Record<string, unknown> }): RequestMeta {
  return { ip: request.ip, userAgent: String(request.headers['user-agent'] ?? '') };
}

const authRateLimit = { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } };
const sensitiveRateLimit = { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post('/register', authRateLimit, async (request, reply) => {
    const input = parseOrThrow(registerSchema, request.body);
    const result = await authService.register(env, input, meta(request));
    return reply.code(201).send({
      user: serializeUser(result.user),
      devVerificationUrl: result.devVerificationUrl,
    });
  });

  app.post('/login', authRateLimit, async (request, reply) => {
    const input = parseOrThrow(loginSchema, request.body);
    const result = await authService.login(env, input, meta(request));
    setAuthCookies(reply, env, result);
    return reply.send({ user: serializeUser(result.user), accessToken: result.accessToken });
  });

  app.post('/google', authRateLimit, async (request, reply) => {
    const input = parseOrThrow(googleLoginSchema, request.body);
    const result = await authService.googleLogin(env, input.idToken, meta(request));
    setAuthCookies(reply, env, result);
    return reply.send({ user: serializeUser(result.user), accessToken: result.accessToken });
  });

  app.post('/refresh', async (request, reply) => {
    const token = getRefreshToken(request) ?? (request.body as { refreshToken?: string } | undefined)?.refreshToken;
    if (!token) throw unauthorized('No refresh token provided.');
    const result = await authService.refreshSession(env, token, meta(request));
    setAuthCookies(reply, env, result);
    return reply.send({ user: serializeUser(result.user), accessToken: result.accessToken });
  });

  app.post('/logout', async (request, reply) => {
    await authService.logout(getRefreshToken(request), (request as { authSessionId?: string }).authSessionId);
    clearAuthCookies(reply, env);
    return reply.send({ success: true });
  });

  app.get('/me', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    return reply.send({ user: serializeUser(user) });
  });

  app.post('/verify-email', sensitiveRateLimit, async (request, reply) => {
    const { token } = parseOrThrow(verifyEmailSchema, request.body);
    const user = await authService.verifyEmail(env, token, meta(request));
    return reply.send({ user: serializeUser(user), verified: true });
  });

  app.post('/resend-verification', sensitiveRateLimit, async (request, reply) => {
    const { email } = parseOrThrow(resendVerificationSchema, request.body);
    const result = await authService.resendVerification(env, email, meta(request));
    return reply.send({ success: true, ...result });
  });

  app.post('/forgot-password', sensitiveRateLimit, async (request, reply) => {
    const { email } = parseOrThrow(forgotPasswordSchema, request.body);
    const result = await authService.forgotPassword(env, email, meta(request));
    return reply.send({
      success: true,
      message: 'If an account exists for that email, a reset link has been sent.',
      ...result,
    });
  });

  app.post('/reset-password', sensitiveRateLimit, async (request, reply) => {
    const { token, password } = parseOrThrow(resetPasswordSchema, request.body);
    await authService.resetPassword(env, token, password, meta(request));
    clearAuthCookies(reply, env);
    return reply.send({ success: true });
  });

  app.post('/change-password', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { currentPassword, newPassword } = parseOrThrow(changePasswordSchema, request.body);
    await authService.changePassword(env, user.id, currentPassword, newPassword, meta(request));
    clearAuthCookies(reply, env);
    return reply.send({ success: true });
  });

  app.get('/sessions', async (request, reply) => {
    const { claims } = await requireAuth(request, env);
    const sessions = await authService.listSessions(claims.sub, claims.sid);
    return reply.send({ sessions });
  });

  app.delete('/sessions/:id', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    const { id } = request.params as { id: string };
    await authService.revokeSession(user.id, id);
    return reply.send({ success: true });
  });

  app.post('/logout-all', async (request, reply) => {
    const { user } = await requireAuth(request, env);
    await authService.revokeAllSessions(user.id);
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'user.logout',
      metadata: { all: true },
      ip: request.ip,
      userAgent: String(request.headers['user-agent'] ?? ''),
    });
    clearAuthCookies(reply, env);
    return reply.send({ success: true });
  });
}