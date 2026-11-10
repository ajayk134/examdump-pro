import type { FastifyRequest } from 'fastify';
import type { HydratedDocument } from 'mongoose';
import { COOKIE_NAMES } from '@examdump/shared';
import type { AccessTokenClaims } from './jwt.js';
import { verifyAccessToken } from './jwt.js';
import type { Env } from '../config/env.js';
import { forbidden, unauthorized } from './errors.js';
import { Session, User, type UserDoc } from '../db/models/index.js';

export interface AuthContext {
  user: HydratedDocument<UserDoc>;
  claims: AccessTokenClaims;
}

export function getAccessToken(request: FastifyRequest): string | undefined {
  const cookie = request.cookies?.[COOKIE_NAMES.access];
  if (cookie) return cookie;
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return undefined;
}

export function getRefreshToken(request: FastifyRequest): string | undefined {
  return request.cookies?.[COOKIE_NAMES.refresh];
}

export async function optionalAuth(request: FastifyRequest, env: Env): Promise<AuthContext | null> {
  const token = getAccessToken(request);
  if (!token) return null;
  try {
    return await resolveAuth(token, env, request);
  } catch {
    return null;
  }
}

export async function requireAuth(request: FastifyRequest, env: Env): Promise<AuthContext> {
  const token = getAccessToken(request);
  if (!token) throw unauthorized();
  return resolveAuth(token, env, request);
}

async function resolveAuth(token: string, env: Env, request: FastifyRequest): Promise<AuthContext> {
  const claims = await verifyAccessToken(token, env.JWT_ACCESS_SECRET);
  const [user, session] = await Promise.all([
    User.findById(claims.sub),
    Session.findById(claims.sid),
  ]);
  if (!user || user.suspended || user.deletedAt) {
    throw unauthorized('This account is no longer available.');
  }
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  void request;
  return { user, claims };
}

export async function requireAdmin(request: FastifyRequest, env: Env): Promise<AuthContext> {
  const auth = await requireAuth(request, env);
  if (auth.user.role !== 'admin') throw forbidden('Administrator access required.');
  return auth;
}

export async function requireVerified(request: FastifyRequest, env: Env): Promise<AuthContext> {
  const auth = await requireAuth(request, env);
  if (!auth.user.emailVerified) {
    throw forbidden('Please verify your email address to continue.');
  }
  return auth;
}