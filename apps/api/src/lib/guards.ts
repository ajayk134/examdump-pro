import type { FastifyRequest } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { COOKIE_NAMES, type Permission } from '@examdump/shared';
import type { AccessTokenClaims } from './jwt.js';
import { verifyAccessToken } from './jwt.js';
import type { Env } from '../config/env.js';
import { forbidden, unauthorized } from './errors.js';
import { getDb } from '../db/client.js';
import { rolePermissions, sessions, userRoles, users, type User } from '../db/schema/index.js';

export interface AuthContext {
  user: User;
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
    return await resolveAuth(token, env);
  } catch {
    return null;
  }
}

export async function requireAuth(request: FastifyRequest, env: Env): Promise<AuthContext> {
  const token = getAccessToken(request);
  if (!token) throw unauthorized();
  return resolveAuth(token, env);
}

async function resolveAuth(token: string, env: Env): Promise<AuthContext> {
  const claims = await verifyAccessToken(token, env.JWT_ACCESS_SECRET);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  const [session] = await db.select().from(sessions).where(eq(sessions.id, claims.sid)).limit(1);

  if (!user || user.suspended || user.deletedAt) {
    throw unauthorized('This account is no longer available.');
  }
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  return { user, claims };
}

export async function requireAdmin(request: FastifyRequest, env: Env): Promise<AuthContext> {
  const auth = await requireAuth(request, env);
  if (auth.user.role !== 'admin') throw forbidden('Administrator access required.');
  return auth;
}

/** Resolve every permission granted to a user via their primary role + extra roles. */
export async function getUserPermissions(user: Pick<User, 'id' | 'role'>): Promise<Set<Permission>> {
  const db = getDb();
  const extra = await db
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));

  const ids = [...new Set<string>([user.role, ...extra.map((r) => r.roleId)])];
  const rows = await db
    .select({ permissionId: rolePermissions.permissionId })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, ids));
  return new Set(rows.map((r) => r.permissionId as Permission));
}

export async function hasPermission(
  user: Pick<User, 'id' | 'role'>,
  permission: Permission,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const perms = await getUserPermissions(user);
  return perms.has(permission);
}

export async function requirePermission(
  request: FastifyRequest,
  env: Env,
  permission: Permission,
): Promise<AuthContext> {
  const auth = await requireAuth(request, env);
  if (!(await hasPermission(auth.user, permission))) {
    throw forbidden('You do not have permission to perform this action.');
  }
  return auth;
}

export async function requireVerified(request: FastifyRequest, env: Env): Promise<AuthContext> {
  const auth = await requireAuth(request, env);
  if (!auth.user.emailVerified) {
    throw forbidden('Please verify your email address to continue.');
  }
  return auth;
}

