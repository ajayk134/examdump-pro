import type { FastifyReply } from 'fastify';
import { ACCESS_COOKIE_PATH, COOKIE_NAMES, REFRESH_COOKIE_PATH } from '@examdump/shared';
import type { Env } from '../config/env.js';

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge?: number;
  domain?: string;
}

function baseOptions(env: Env): Omit<CookieOptions, 'path' | 'maxAge'> {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.NODE_ENV === 'production',
    sameSite: 'lax',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(
  reply: FastifyReply,
  env: Env,
  tokens: { accessToken: string; refreshToken: string },
): void {
  reply.setCookie(COOKIE_NAMES.access, tokens.accessToken, {
    ...baseOptions(env),
    path: ACCESS_COOKIE_PATH,
    maxAge: 60 * 15,
  });
  reply.setCookie(COOKIE_NAMES.refresh, tokens.refreshToken, {
    ...baseOptions(env),
    path: REFRESH_COOKIE_PATH,
    maxAge: 60 * 60 * 24 * env.REFRESH_TOKEN_TTL_DAYS,
  });
}

export function clearAuthCookies(reply: FastifyReply, env: Env): void {
  reply.clearCookie(COOKIE_NAMES.access, { path: ACCESS_COOKIE_PATH, ...baseOptions(env) });
  reply.clearCookie(COOKIE_NAMES.refresh, { path: REFRESH_COOKIE_PATH, ...baseOptions(env) });
}