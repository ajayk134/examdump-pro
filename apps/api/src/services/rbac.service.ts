import { asc, eq, inArray } from 'drizzle-orm';
import { PERMISSIONS, ROLE_DEFINITIONS, type Permission } from '@examdump/shared';
import { getDb } from '../db/client.js';
import { permissions, rolePermissions, roles, userRoles } from '../db/schema/index.js';
import { conflict, notFound } from '../lib/errors.js';

/** Seed the built-in permission catalogue and roles (idempotent). */
export async function ensureRbac(): Promise<void> {
  const db = getDb();

  for (const permission of PERMISSIONS) {
    await db
      .insert(permissions)
      .values({ id: permission, description: permission })
      .onConflictDoNothing();
  }

  for (const role of ROLE_DEFINITIONS) {
    await db
      .insert(roles)
      .values({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
      })
      .onConflictDoNothing();

    for (const permission of role.permissions) {
      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: permission })
        .onConflictDoNothing();
    }
  }
}

export async function listRoles() {
  const db = getDb();
  const allRoles = await db.select().from(roles).orderBy(asc(roles.name));
  const perms = await db.select().from(rolePermissions);
  return allRoles.map((role) => ({
    ...role,
    permissions: perms.filter((p) => p.roleId === role.id).map((p) => p.permissionId as Permission),
  }));
}

export async function listPermissions() {
  const db = getDb();
  return db.select().from(permissions).orderBy(asc(permissions.id));
}

export interface CreateRoleInput {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export async function createRole(input: CreateRoleInput) {
  const db = getDb();
  const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, input.id)).limit(1);
  if (existing) throw conflict('A role with this id already exists.');

  const [role] = await db
    .insert(roles)
    .values({ id: input.id, name: input.name, description: input.description, isSystem: false })
    .returning();
  for (const permission of input.permissions) {
    await db.insert(rolePermissions).values({ roleId: input.id, permissionId: permission }).onConflictDoNothing();
  }
  return role!;
}

export async function updateRolePermissions(roleId: string, perms: Permission[]) {
  const db = getDb();
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw notFound('Role not found.');
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  for (const permission of perms) {
    await db.insert(rolePermissions).values({ roleId, permissionId: permission }).onConflictDoNothing();
  }
  return { ...role, permissions: perms };
}

export async function getUserRoleIds(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.roleId);
}

export async function assignUserRoles(userId: string, roleIds: string[], grantedBy?: string): Promise<void> {
  const db = getDb();
  if (roleIds.length > 0) {
    const valid = await db.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds));
    const validIds = new Set(valid.map((r) => r.id));
    roleIds = roleIds.filter((id) => validIds.has(id));
  }
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  for (const roleId of roleIds) {
    await db.insert(userRoles).values({ userId, roleId, grantedBy: grantedBy ?? null }).onConflictDoNothing();
  }
}
