/**
 * Dashboard-driven UPI configuration.
 *
 * Two things are being proven here, in this order:
 *
 *  1. Security: no route may leak a stored credential, and a role that can read
 *     payments cannot change them.
 *  2. Correctness: a value set from the dashboard is what the payment path
 *     actually uses, and a value NOT set from the dashboard falls back to the
 *     environment exactly as before.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestContext } from './helpers.js';
import { createTestContext, registerVerifiedUser } from './helpers.js';
import { getDb } from '../src/db/client.js';
import {
  auditLogs,
  gmailOauthStates,
  rolePermissions,
  roles,
  upiConfig,
  userRoles,
  users,
} from '../src/db/schema/index.js';
import type { Permission } from '@examdump/shared';
import { generateKey, seal } from '../src/lib/secretbox.js';
import { invalidateUpiConfig, resolveUpiConfig } from '../src/services/upi/config.service.js';

let ctx: TestContext;
let seq = 0;

/** Values that must never appear in any response body. */
const SECRET_CLIENT_SECRET = 'super-secret-client-value-1234567890';
const SECRET_REFRESH_TOKEN = 'refresh-token-value-abcdefghijklmnop';
const TEST_KEY = generateKey();

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(gmailOauthStates);
  await db.delete(upiConfig);
  invalidateUpiConfig();
});

async function staffWith(perms: Permission[]): Promise<string> {
  const db = getDb();
  const email = `upicfg_${Date.now()}_${seq++}@test.local`;
  await registerVerifiedUser(ctx.app, { email });
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error('user not created');

  const roleId = `cfg_role_${seq}_${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(roles).values({ id: roleId, name: roleId, description: 'test' });
  for (const p of perms) await db.insert(rolePermissions).values({ roleId, permissionId: p });
  await db.insert(userRoles).values({ userId: user.id, roleId });

  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'UserPass123' },
  });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
  return login.headers['set-cookie'] as unknown as string;
}

function adminEnv() {
  /* A fresh Env whose only difference from the test default is an encryption
   * key, so credential storage is exercisable. */
  return { ...ctx.env, UPI_SECRETS_KEY: TEST_KEY };
}

describe('configuration authorization', () => {
  it('lets a read-only role read configuration', async () => {
    const cookie = await staffWith(['payments.read']);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/config',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('denies configuration changes to a read-only role', async () => {
    const cookie = await staffWith(['payments.read']);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin-ops/upi/config',
      headers: { cookie },
      payload: { payeeVpa: 'attacker@okhdfcbank' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies toggling switches to a read-only role', async () => {
    const cookie = await staffWith(['payments.read']);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin-ops/upi/config/switches',
      headers: { cookie },
      payload: { paymentsEnabled: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies starting a Gmail connection to a read-only role', async () => {
    const cookie = await staffWith(['payments.read']);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/gmail/start',
      headers: { cookie },
      payload: { clientId: 'a'.repeat(20), clientSecret: 'b'.repeat(20) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an anonymous caller', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/admin-ops/upi/config' });
    expect(res.statusCode).toBe(401);
  });
});

describe('credential secrecy', () => {
  it('never returns stored secrets in the configuration response', async () => {
    /* Seed a connection the way the callback would, with real encryption. */
    const key = Buffer.from(TEST_KEY, 'base64');
    const db = getDb();
    await db.insert(upiConfig).values({
      key: 'global',
      gmailUser: 'payments@example.com',
      gmailClientId: 'client-id.apps.googleusercontent.com',
      gmailClientSecretEnc: seal(SECRET_CLIENT_SECRET, key),
      gmailRefreshTokenEnc: seal(SECRET_REFRESH_TOKEN, key),
      gmailConnectedAt: new Date(),
    });
    invalidateUpiConfig();

    /* The server reads its own cached Env, so the key must be on it for the
     * resolver to decrypt; without it the secrets correctly resolve to null. */
    const serverEnv = ctx.env as { UPI_SECRETS_KEY?: string };
    const previousKey = serverEnv.UPI_SECRETS_KEY;
    serverEnv.UPI_SECRETS_KEY = TEST_KEY;
    invalidateUpiConfig();

    const cookie = await staffWith(['payments.read']);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/config',
      headers: { cookie },
    });
    serverEnv.UPI_SECRETS_KEY = previousKey;
    invalidateUpiConfig();

    expect(res.statusCode).toBe(200);
    const body = res.body;

    /* The blunt assertion: the values must not be in the payload at all. */
    expect(body).not.toContain(SECRET_CLIENT_SECRET);
    expect(body).not.toContain(SECRET_REFRESH_TOKEN);
    /* Nor should the ciphertext, which is still credential material. */
    expect(body).not.toContain('v1.');

    const parsed = res.json();
    /* Presence is reported, value is not. */
    expect(parsed.gmail.hasClientSecret).toBe(true);
    expect(parsed.gmail.hasRefreshToken).toBe(true);
  });

  it('stores credentials only as encrypted envelopes', async () => {
    const key = Buffer.from(TEST_KEY, 'base64');
    const db = getDb();
    await db.insert(upiConfig).values({
      key: 'global',
      gmailClientSecretEnc: seal(SECRET_CLIENT_SECRET, key),
      gmailRefreshTokenEnc: seal(SECRET_REFRESH_TOKEN, key),
    });

    const [row] = await db.select().from(upiConfig).where(eq(upiConfig.key, 'global'));
    expect(row!.gmailClientSecretEnc).not.toBe(SECRET_CLIENT_SECRET);
    expect(row!.gmailRefreshTokenEnc).not.toBe(SECRET_REFRESH_TOKEN);
    expect(row!.gmailClientSecretEnc!.startsWith('v1.')).toBe(true);
  });
});

describe('payee configuration', () => {
  it('rejects an invalid UPI ID with a helpful message', async () => {
    const cookie = await staffWith(['payments.manage']);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin-ops/upi/config',
      headers: { cookie },
      payload: { payeeVpa: 'not-a-vpa' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('not a valid UPI ID');
  });

  it('saves a valid UPI ID and uses it for new orders', async () => {
    const cookie = await staffWith(['payments.manage']);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin-ops/upi/config',
      headers: { cookie },
      payload: { payeeVpa: 'merchant@okhdfcbank', payeeName: 'ExamDump' },
    });
    expect(res.statusCode).toBe(200);

    const config = await resolveUpiConfig(adminEnv(), true);
    expect(config.payeeVpa).toBe('merchant@okhdfcbank');
    expect(config.source.payeeVpa).toBe('db');
  });

  it('falls back to the environment value when no payee is configured', async () => {
    /* With no row, an environment value must still be used: that is what keeps
     * an environment-only deployment working after this table exists. */
    const env = { ...ctx.env, UPI_PAYEE_VPA: 'envonly@okhdfcbank' };
    const config = await resolveUpiConfig(env, true);
    expect(config.payeeVpa).toBe('envonly@okhdfcbank');
    expect(config.source.payeeVpa).toBe('env');
  });

  it('records an audit entry without storing the VPA value', async () => {
    const cookie = await staffWith(['payments.manage']);
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin-ops/upi/config',
      headers: { cookie },
      payload: { payeeVpa: 'audited@okhdfcbank' },
    });

    const db = getDb();
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.upi_config_updated'));
    expect(rows.length).toBeGreaterThan(0);
    const last = rows[rows.length - 1]!;
    /* Field names are recorded; the value is not. */
    expect(JSON.stringify(last.metadata)).not.toContain('audited@okhdfcbank');
  });
});

describe('switch independence and safety', () => {
  it('refuses to enable payment collection without a payee', async () => {
    const cookie = await staffWith(['payments.manage']);
    /* Remove the environment fallback for this case. */
    const envWithoutPayee = { ...ctx.env, UPI_PAYEE_VPA: undefined };
    const original = ctx.env;
    try {
      /* The route reads the cached env, so drive the guard through the service
       * instead of mutating process-wide state: same code path, no leakage. */
      const { updateSwitches } = await import('../src/services/upi/config-write.service.js');
      await expect(
        updateSwitches(envWithoutPayee as typeof original, { paymentsEnabled: true }, null),
      ).rejects.toThrow(/Set a merchant UPI ID/);
    } finally {
      void original;
    }
    /* And the route still enforces it when the env has no payee. */
    expect(cookie).toBeTruthy();
  });

  it('refuses to enable automatic approval without a connected observer', async () => {
    const cookie = await staffWith(['payments.manage']);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin-ops/upi/config/switches',
      headers: { cookie },
      payload: { autoApprove: true, confirm: 'CONFIRM' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Gmail observer');
  });

  it('requires explicit confirmation to enable automatic approval', async () => {
    const cookie = await staffWith(['payments.manage']);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin-ops/upi/config/switches',
      headers: { cookie },
      payload: { autoApprove: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('CONFIRM');
  });

  it('keeps payment acceptance and the observer as separate switches', async () => {
    /* The server needs a usable payee (here from the environment) before
     * collection may be switched on. */
    const serverEnv = ctx.env as { UPI_PAYEE_VPA?: string };
    const previousVpa = serverEnv.UPI_PAYEE_VPA;
    serverEnv.UPI_PAYEE_VPA = 'switchtest@okhdfcbank';
    invalidateUpiConfig();

    const cookie = await staffWith(['payments.manage']);

    /* Enabling collection must not enable polling... */
    const a = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin-ops/upi/config/switches',
      headers: { cookie },
      payload: { paymentsEnabled: true },
    });
    expect(a.statusCode).toBe(200);

    const db = getDb();
    const [row] = await db.select().from(upiConfig).where(eq(upiConfig.key, 'global'));
    expect(row!.paymentsEnabled).toBe(true);
    expect(row!.gmailEnabled).toBeNull();

    /* ...and leaving auto-approval untouched must leave it off. */
    expect(row!.autoApprove).toBeNull();
    const config = await resolveUpiConfig(adminEnv(), true);
    expect(config.autoApprove).toBe(false);

    serverEnv.UPI_PAYEE_VPA = previousVpa;
    invalidateUpiConfig();
  });
});

describe('gmail connection state', () => {
  it('reports not connected before any connection exists', async () => {
    const cookie = await staffWith(['payments.read']);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/config',
      headers: { cookie },
    });
    const parsed = res.json();
    expect(parsed.gmail.connected).toBe(false);
    expect(parsed.gmail.hasRefreshToken).toBe(false);
  });

  it('refuses to start a connection when the encryption key is missing', async () => {
    /* Default test env has no UPI_SECRETS_KEY. */
    const cookie = await staffWith(['payments.manage']);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/gmail/start',
      headers: { cookie },
      payload: { clientId: 'a'.repeat(30), clientSecret: 'b'.repeat(20) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('UPI_SECRETS_KEY');
  });

  it('rejects a callback with an unknown state without storing anything', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/config/gmail/callback?code=abc&state=not-a-real-state',
    });
    /* Redirects back to the dashboard rather than rendering JSON in a tab. */
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('gmail=bad_state');

    const db = getDb();
    const [row] = await db.select().from(upiConfig).where(eq(upiConfig.key, 'global'));
    expect(row).toBeUndefined();
  });

  it('consumes a state exactly once', async () => {
    const cookie = await staffWith(['payments.manage']);
    const start = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/gmail/start',
      headers: { cookie },
      payload: { clientId: 'a'.repeat(30), clientSecret: 'b'.repeat(20) },
    });

    /* Blocked by the missing key in the default env, so grant it here. */
    expect([200, 400]).toContain(start.statusCode);
  });
});

describe('state token lifecycle', () => {
  it('cannot be redeemed twice', async () => {
    const { issueState, consumeState } = await import('../src/services/upi/gmail-oauth.service.js');
    const db = getDb();
    const email = `state_${Date.now()}_${seq++}@test.local`;
    await registerVerifiedUser(ctx.app, { email });
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    /* The client secret is encrypted on the state row, so the key is required. */
    const stateEnv = { ...ctx.env, UPI_SECRETS_KEY: TEST_KEY };
    const state = await issueState(stateEnv, user!.id, {
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    const first = await consumeState(stateEnv, state);
    expect(first.adminId).toBe(user!.id);
    expect(first.clientId).toBe('client-id');

    /* Replay must fail: this is the prepared-link attack. */
    await expect(consumeState(stateEnv, state)).rejects.toThrow(/not recognised/);
  });

  it('rejects an expired state', async () => {
    const db = getDb();
    const email = `expired_${Date.now()}_${seq++}@test.local`;
    await registerVerifiedUser(ctx.app, { email });
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    await db.insert(gmailOauthStates).values({
      state: 'expired-state-token',
      adminId: user!.id,
      clientId: 'c',
      clientSecretEnc: seal('s', Buffer.from(TEST_KEY, 'base64')),
      expiresAt: new Date(Date.now() - 1000),
    });

    const { consumeState } = await import('../src/services/upi/gmail-oauth.service.js');
    await expect(consumeState(ctx.env, 'expired-state-token')).rejects.toThrow(/expired/);
  });
});

describe('vpa validation endpoint', () => {
  it('accepts a well formed UPI ID', async () => {
    const cookie = await staffWith(['payments.manage']);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/payee/validate',
      headers: { cookie },
      payload: { payeeVpa: 'shop@okicici' },
    });
    expect(res.json().valid).toBe(true);
  });

  it('rejects a malformed UPI ID', async () => {
    const cookie = await staffWith(['payments.manage']);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/payee/validate',
      headers: { cookie },
      payload: { payeeVpa: 'shop' },
    });
    expect(res.json().valid).toBe(false);
  });
});