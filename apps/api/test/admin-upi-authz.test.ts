import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestContext } from './helpers.js';
import { createTestContext, loginAdmin, registerVerifiedUser } from './helpers.js';
import { getDb } from '../src/db/client.js';
import { rolePermissions, roles, userRoles, users } from '../src/db/schema/index.js';
import type { Permission } from '@examdump/shared';

let ctx: TestContext;
let seq = 0;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

/**
 * Create a staff user whose only staff role carries exactly `perms`.
 * Used to prove that read-level access cannot move money.
 */
async function userWithPermissions(perms: Permission[]): Promise<string> {
  const db = getDb();
  const email = `staff_${Date.now()}_${seq++}@test.local`;
  await registerVerifiedUser(ctx.app, { email });
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error('staff user not created');

  const roleId = `test_role_${seq}_${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(roles).values({ id: roleId, name: roleId, description: 'test role' });
  for (const p of perms) {
    await db.insert(rolePermissions).values({ roleId, permissionId: p });
  }
  await db.insert(userRoles).values({ userId: user.id, roleId });

  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'UserPass123' },
  });
  if (login.statusCode !== 200) throw new Error(`staff login failed: ${login.body}`);
  return login.headers['set-cookie'] as unknown as string;
}

describe('admin UPI authorization is granular', () => {
  it('lets a read-only role read the overview', async () => {
    const cookie = await userWithPermissions(['payments.read']);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/overview',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('denies a refund to a role that can only read payments', async () => {
    const cookie = await userWithPermissions(['payments.read']);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/orders/00000000-0000-0000-0000-000000000000/refund',
      headers: { cookie },
      payload: { amountPaise: 100, reason: 'should not be allowed' },
    });
    // 403 from the permission guard, not 404 from the handler: the guard runs first.
    expect(res.statusCode).toBe(403);
  });

  it('denies completing a refund to a read-only role', async () => {
    const cookie = await userWithPermissions(['payments.read']);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/refunds/00000000-0000-0000-0000-000000000000/complete',
      headers: { cookie },
      payload: { payoutReference: 'UTR123456' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies a manual match to a role without payments.manage', async () => {
    const cookie = await userWithPermissions(['payments.read']);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/notifications/00000000-0000-0000-0000-000000000000/match',
      headers: { cookie },
      payload: { orderId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies a manual poll to a role without payments.manage', async () => {
    const cookie = await userWithPermissions(['payments.read']);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/observer/poll',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies a user with no permissions at all', async () => {
    const cookie = await userWithPermissions([]);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/overview',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('still allows an administrator to read', async () => {
    const cookie = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/overview',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});
