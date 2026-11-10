import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AuditAction } from '@examdump/shared';
import { authTokenTypeEnum, userRoleEnum, planTierEnum } from './enums';

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  emailNotifications: boolean;
  productUpdates: boolean;
  weeklyReport: boolean;
}

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    googleId: text('google_id'),
    role: userRoleEnum('role').notNull().default('user'),
    plan: planTierEnum('plan').notNull().default('free'),
    emailVerified: boolean('email_verified').notNull().default(false),
    avatarUrl: text('avatar_url').notNull().default(''),
    bio: text('bio').notNull().default(''),
    timezone: text('timezone').notNull().default('UTC'),
    preferences: jsonb('preferences').$type<UserPreferences>().notNull().default({
      theme: 'system',
      emailNotifications: true,
      productUpdates: false,
      weeklyReport: true,
    }),
    referralCode: text('referral_code').notNull(),
    referredBy: uuid('referred_by'),
    suspended: boolean('suspended').notNull().default(false),
    premiumUntil: timestamp('premium_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('users_referral_code_unique').on(t.referralCode),
    uniqueIndex('users_google_id_unique').on(t.googleId),
    index('users_role_idx').on(t.role),
    index('users_plan_idx').on(t.plan),
    index('users_created_at_idx').on(t.createdAt),
  ],
);

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt,
  updatedAt,
});

export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  description: text('description').notNull().default(''),
  createdAt,
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index('user_roles_role_idx').on(t.roleId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent').notNull().default(''),
    ip: text('ip').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (t) => [
    uniqueIndex('sessions_token_unique').on(t.refreshTokenHash),
    index('sessions_user_idx').on(t.userId, t.revokedAt),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: authTokenTypeEnum('type').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_unique').on(t.tokenHash),
    index('auth_tokens_user_idx').on(t.userId, t.type),
    index('auth_tokens_expires_idx').on(t.expiresAt),
  ],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    email: text('email').notNull(),
    ip: text('ip').notNull().default(''),
    success: boolean('success').notNull().default(false),
    createdAt,
  },
  (t) => [
    index('login_attempts_email_idx').on(t.email, t.createdAt),
    index('login_attempts_created_idx').on(t.createdAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    action: text('action').$type<AuditAction | string>().notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_action_idx').on(t.action, t.createdAt),
    index('audit_logs_actor_idx').on(t.actorId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type AuthToken = typeof authTokens.$inferSelect;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
