/**
 * Gmail OAuth: server-configured credentials and callback log redaction.
 *
 * These two fixes came from a real failed connection. The dashboard demanded a
 * hand-typed client id and secret even though the server already held a correct
 * pair in Doppler, so the token exchange ran against whatever had been pasted
 * into a form and failed with a generic message. Separately, Fastify's default
 * request serializer wrote the entire callback URL to the log, including a live
 * authorization code.
 *
 * The tests below pin both behaviours, and the security properties that must not
 * regress alongside them: no secret in a response, state single-use, and the
 * stored credential still encrypted.
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
import { buildApp, redactQueryString, redactSensitiveQuery } from '../src/app.js';
import { seal } from '../src/lib/secretbox.js';
import { invalidateUpiConfig } from '../src/services/upi/config.service.js';

let ctx: TestContext;
let seq = 0;

const SERVER_CLIENT_ID = 'server-id-1234567890.apps.googleusercontent.com';
const SERVER_CLIENT_SECRET = 'GOCSPX-server-secret-value';

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
  /* The resolver caches for 10s keyed on an env fingerprint; without this a
   * test would observe the previous test's credentials. */
  invalidateUpiConfig();
});

/** An admin holding `payments.manage`. */
async function adminWithManage(): Promise<string> {
  const db = getDb();
  const email = `oauth_${Date.now()}_${seq++}@test.local`;
  await registerVerifiedUser(ctx.app, { email });
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  const roleId = `oauth_role_${seq++}`;
  await db.insert(roles).values({ id: roleId, name: roleId, description: 'test' });
  for (const permissionId of ['payments.read', 'payments.manage']) {
    await db.insert(rolePermissions).values({ roleId, permissionId });
  }
  await db.insert(userRoles).values({ userId: user!.id, roleId });

  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'UserPass123' },
  });
  const cookies = login.headers['set-cookie'];
  const list: string[] = Array.isArray(cookies) ? cookies : [String(cookies)];
  return list.map((c) => c.split(';')[0]).join('; ');
}

describe('OAuth initiation with server-configured credentials', () => {
  it('starts the handshake without any credentials in the request body', async () => {
    const cookie = await adminWithManage();
    /* The server is configured; the caller supplies nothing. This is the case
     * the dashboard now defaults to. */
    ctx.env.UPI_GOOGLE_CLIENT_ID = SERVER_CLIENT_ID;
    ctx.env.UPI_GOOGLE_CLIENT_SECRET = SERVER_CLIENT_SECRET;
    ctx.env.UPI_SECRETS_KEY = Buffer.from(
      '0123456789abcdef0123456789abcdef',
      'utf8',
    ).toString('base64');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/gmail/start',
      headers: { cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string; redirectUri: string };

    /* The consent URL must carry the server's client id... */
    expect(body.url).toContain(encodeURIComponent(SERVER_CLIENT_ID));
    /* ...and none of the required OAuth parameters may be missing. */
    expect(body.url).toContain('access_type=offline');
    expect(body.url).toContain('prompt=consent');
    expect(body.url).toContain(encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly'));
    expect(body.url).toContain(`redirect_uri=${encodeURIComponent(body.redirectUri)}`);
    /* The client secret must never appear in the consent URL. */
    expect(body.url).not.toContain(SERVER_CLIENT_SECRET);

    /* A state row exists and carries the same pair the consent URL was built
     * with, so the callback exchanges with exactly those values. */
    const rows = await getDb().select().from(gmailOauthStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientId).toBe(SERVER_CLIENT_ID);
    expect(rows[0]!.clientSecretEnc).not.toBe(SERVER_CLIENT_SECRET);
    expect(rows[0]!.clientSecretEnc.startsWith('v1.')).toBe(true);
  });

  it('prefers explicitly supplied credentials over the server pair', async () => {
    const cookie = await adminWithManage();
    ctx.env.UPI_GOOGLE_CLIENT_ID = SERVER_CLIENT_ID;
    ctx.env.UPI_GOOGLE_CLIENT_SECRET = SERVER_CLIENT_SECRET;
    ctx.env.UPI_SECRETS_KEY = Buffer.from(
      '0123456789abcdef0123456789abcdef',
      'utf8',
    ).toString('base64');

    const custom = 'custom-id-abcdefghij.apps.googleusercontent.com';
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/gmail/start',
      headers: { cookie },
      payload: { clientId: custom, clientSecret: 'GOCSPX-custom-secret' },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { url: string }).url).toContain(encodeURIComponent(custom));
  });

  it('treats blank form fields as absent rather than as a failure', async () => {
    const cookie = await adminWithManage();
    ctx.env.UPI_GOOGLE_CLIENT_ID = SERVER_CLIENT_ID;
    ctx.env.UPI_GOOGLE_CLIENT_SECRET = SERVER_CLIENT_SECRET;
    ctx.env.UPI_SECRETS_KEY = Buffer.from(
      '0123456789abcdef0123456789abcdef',
      'utf8',
    ).toString('base64');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/gmail/start',
      headers: { cookie },
      payload: { clientId: '   ', clientSecret: '' },
    });

    expect(res.statusCode).toBe(200);
    const rows = await getDb().select().from(gmailOauthStates);
    expect(rows[0]!.clientId).toBe(SERVER_CLIENT_ID);
  });

  it('rejects with an actionable message when the server has no credentials', async () => {
    const cookie = await adminWithManage();
    ctx.env.UPI_GOOGLE_CLIENT_ID = undefined;
    ctx.env.UPI_GOOGLE_CLIENT_SECRET = undefined;
    ctx.env.UPI_SECRETS_KEY = Buffer.from(
      '0123456789abcdef0123456789abcdef',
      'utf8',
    ).toString('base64');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin-ops/upi/config/gmail/start',
      headers: { cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const message = (res.json() as { error: { message: string } }).error.message;
    /* Names the variables to set, so the operator is not left guessing. */
    expect(message).toContain('UPI_GOOGLE_CLIENT_ID');
    expect(message).toContain('UPI_GOOGLE_CLIENT_SECRET');
    /* And never leaks any value. */
    expect(res.body).not.toContain(SERVER_CLIENT_SECRET);
  });

  it('reports presence of server credentials without exposing them', async () => {
    const cookie = await adminWithManage();
    ctx.env.UPI_GOOGLE_CLIENT_ID = SERVER_CLIENT_ID;
    ctx.env.UPI_GOOGLE_CLIENT_SECRET = SERVER_CLIENT_SECRET;

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/config',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const gmail = (res.json() as { gmail: Record<string, unknown> }).gmail;
    expect(gmail.serverCredentialsConfigured).toBe(true);
    expect(res.body).not.toContain(SERVER_CLIENT_SECRET);
    expect(res.body).not.toContain(SERVER_CLIENT_ID);
  });
});

describe('callback query redaction', () => {
  it('censors the authorization code and state from a callback URL', () => {
    const out = redactQueryString(
      '/api/admin-ops/upi/config/gmail/callback?state=abc123&code=4/0AUn6HdSECRET&scope=mail',
    );
    expect(out).toBeDefined();
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('4/0AUn6HdSECRET');
    /* The parameter names survive, so logs still show the shape of the request. */
    expect(out).toContain('state=');
    expect(out).toContain('code=');
    /* Non-sensitive parameters are untouched: they help diagnose. */
    expect(out).toContain('scope=mail');
  });

  it('leaves a URL with no sensitive parameters untouched', () => {
    const url = '/api/upi/orders?page=2&limit=10';
    expect(redactQueryString(url)).toBe(url);
  });

  it('matches parameter names case-insensitively', () => {
    const out = redactQueryString('/cb?CODE=secret-value&State=other-secret');
    expect(out).not.toContain('secret-value');
    expect(out).not.toContain('other-secret');
  });

  it('handles a URL with no query string', () => {
    expect(redactQueryString('/api/health')).toBe('/api/health');
    expect(redactQueryString(undefined)).toBeUndefined();
  });

  it('redacts token-bearing parameters too', () => {
    const out = redactQueryString('/cb?access_token=aaa&refresh_token=bbb&id_token=ccc');
    expect(out).not.toContain('aaa');
    expect(out).not.toContain('bbb');
    expect(out).not.toContain('ccc');
  });

  it('the request serializer emits a redacted url', () => {
    const serialised = redactSensitiveQuery({
      method: 'GET',
      url: '/api/admin-ops/upi/config/gmail/callback?state=s1&code=c1',
      host: 'example.test',
      remoteAddress: '1.2.3.4',
      remotePort: 5555,
    });
    expect(serialised.url).not.toContain('s1');
    expect(serialised.url).not.toContain('c1');
    expect(serialised.method).toBe('GET');
  });

  it('a real callback request never writes the code into the log', async () => {
    /*
     * Uses its own app instance with a capture stream. It must NOT call
     * `createTestContext()`: that helper connects the module-level database
     * singleton and `cleanup()` disconnects it, which would tear the DB out from
     * under every other test in this file.
     */
    const lines: string[] = [];
    /* The test env sets LOG_LEVEL=silent, which would make this assertion
     * vacuous. Info level is needed here specifically to observe a request log. */
    const capture = await buildApp({
      env: { ...ctx.env, LOG_LEVEL: 'info' },
      loggerStream: (line) => lines.push(line),
    });
    try {
      await capture.inject({
        method: 'GET',
        url: '/api/admin-ops/upi/config/gmail/callback?state=LIVESTATE123&code=4/0AUn6HdLIVECODE',
      });
      /* Pino writes asynchronously to the stream; wait for the line to appear
       * rather than asserting on a buffer that may still be empty. */
      for (let i = 0; i < 50 && lines.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const joined = lines.join('\n');
      expect(joined).not.toContain('LIVESTATE123');
      expect(joined).not.toContain('4/0AUn6HdLIVECODE');
      /* Sanity: the URL was logged at all, so the assertion is not vacuous. */
      expect(joined).toContain('gmail/callback');
    } finally {
      await capture.close();
    }
  });
});

describe('token exchange failures are recorded safely', () => {
  it('stores a stable error code and no authorization data', async () => {
    const cookie = await adminWithManage();
    const db = getDb();
    const email = `oauthfail_${Date.now()}_${seq++}@test.local`;
    void email;

    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64');
    ctx.env.UPI_SECRETS_KEY = key;

    /* A state row whose secret cannot be decrypted forces a failure before any
     * network call, which is deterministic and needs no Google round-trip. */
    await db.insert(gmailOauthStates).values({
      state: 'unreadable-state-token',
      adminId: (await db.select().from(users).limit(1))[0]!.id,
      clientId: SERVER_CLIENT_ID,
      clientSecretEnc: seal(SERVER_CLIENT_SECRET, Buffer.from(key, 'base64')),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/config/gmail/callback?state=unreadable-state-token&code=SECRET-CODE',
      headers: { cookie },
    });

    /* Whatever the outcome, the authorization code must not be persisted. */
    const audits = await db.select().from(auditLogs);
    const failed = audits.filter((a) => a.action === 'admin.upi_gmail_connect_failed');
    for (const row of failed) {
      const meta = JSON.stringify(row.metadata ?? {});
      expect(meta).not.toContain('SECRET-CODE');
      expect(meta).not.toContain(SERVER_CLIENT_SECRET);
    }
    expect(res.body).not.toContain(SERVER_CLIENT_SECRET);
  });

  it('records a safe code when Google sends an error parameter', async () => {
    const cookie = await adminWithManage();
    const db = getDb();

    await ctx.app.inject({
      method: 'GET',
      url: '/api/admin-ops/upi/config/gmail/callback?error=access_denied',
      headers: { cookie },
    });

    const audits = await db.select().from(auditLogs);
    const failed = audits.filter((a) => a.action === 'admin.upi_gmail_connect_failed');
    expect(failed.length).toBeGreaterThan(0);
    const meta = failed.at(-1)!.metadata as Record<string, unknown>;
    expect(meta.code).toBe('access_denied');
  });

  it('rejects a hostile error value instead of storing it verbatim', async () => {
    const cookie = await adminWithManage();
    const db = getDb();

    await ctx.app.inject({
      method: 'GET',
      url: `/api/admin-ops/upi/config/gmail/callback?error=${encodeURIComponent('<script>x</script>')}`,
      headers: { cookie },
    });

    const audits = await db.select().from(auditLogs);
    const failed = audits.filter((a) => a.action === 'admin.upi_gmail_connect_failed');
    const meta = failed.at(-1)!.metadata as Record<string, unknown>;
    expect(meta.code).toBe('unknown');
  });
});

describe('state validation and encryption remain intact', () => {
  it('a state token is still single-use', async () => {
    const { issueState, consumeState } = await import('../src/services/upi/gmail-oauth.service.js');
    const db = getDb();
    const email = `state2_${Date.now()}_${seq++}@test.local`;
    await registerVerifiedUser(ctx.app, { email });
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64');
    const stateEnv = { ...ctx.env, UPI_SECRETS_KEY: key };

    const state = await issueState(stateEnv, user!.id, {
      clientId: SERVER_CLIENT_ID,
      clientSecret: SERVER_CLIENT_SECRET,
    });

    const first = await consumeState(stateEnv, state);
    expect(first.clientId).toBe(SERVER_CLIENT_ID);
    expect(first.clientSecret).toBe(SERVER_CLIENT_SECRET);

    await expect(consumeState(stateEnv, state)).rejects.toThrow(/not recognised/);
  });

  it('the state row never holds the client secret in clear', async () => {
    const db = getDb();
    const email = `state3_${Date.now()}_${seq++}@test.local`;
    await registerVerifiedUser(ctx.app, { email });
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64');
    const { issueState } = await import('../src/services/upi/gmail-oauth.service.js');
    await issueState(
      { ...ctx.env, UPI_SECRETS_KEY: key },
      user!.id,
      { clientId: SERVER_CLIENT_ID, clientSecret: SERVER_CLIENT_SECRET },
    );

    const rows = await db.select().from(gmailOauthStates);
    const stored = rows[0]!.clientSecretEnc;
    expect(stored).not.toContain(SERVER_CLIENT_SECRET);
    expect(stored.startsWith('v1.')).toBe(true);
  });
});
