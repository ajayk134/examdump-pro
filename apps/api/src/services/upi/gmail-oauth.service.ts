/**
 * Dashboard-driven Gmail OAuth handshake.
 *
 * This is the same handshake as `scripts/upi-gmail-oauth.ts`, but it runs inside
 * a browser session instead of a terminal, so two things change and nothing else:
 *
 *  - the redirect target must be a real URL on this API, not the OAuth
 *    playground, because Google has to redirect the operator's browser somewhere
 *    the dashboard can pick up;
 *  - `state` becomes load-bearing. In a terminal the operator is the only actor;
 *    in a browser an attacker can try to hand an admin a prepared consent URL
 *    and end up with their own mailbox connected to this account. The state value
 *    is generated server-side, bound to the admin, single-use and short-lived.
 *
 * Scope stays exactly `gmail.readonly`. The observer lists and reads messages and
 * never needs to modify the mailbox, so a leaked credential cannot delete, send
 * or label anything.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { gmailOauthStates } from '../../db/schema/index.js';
import { eq, lt } from 'drizzle-orm';
import { open, parseKey, seal } from '../../lib/secretbox.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** How long an operator has to complete consent before the state expires. */
const STATE_TTL_MS = 10 * 60 * 1000;

export class OAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
  }
}

/**
 * Origin the API is reachable on from a browser.
 *
 * `PUBLIC_WEB_URL` is the origin the *browser* uses. In this deployment the web
 * app and the API share one origin, so `<web>/api/...` resolves to the API. That
 * coincidence must not be relied on silently: if the API is ever given its own
 * host, deriving the redirect from the web origin produces a URI Google rejects
 * with `redirect_uri_mismatch` - and the operator only discovers that after they
 * have already approved consent in Google.
 *
 * `API_PUBLIC_URL` exists for that case. The dashboard shows the URI that will
 * actually be sent, so a mismatch is visible before the handshake, not after it.
 */
function apiOrigin(env: Env): string {
  return (env.API_PUBLIC_URL || env.PUBLIC_WEB_URL).replace(/\/$/, '');
}

/**
 * The redirect URI registered on the Google OAuth client.
 *
 * Must match byte-for-byte what Google has on file, so it is configuration
 * rather than something assembled from headers: deriving it from `Host` would
 * let a spoofed header redirect the code elsewhere.
 */
export function redirectUri(env: Env): string {
  if (env.UPI_OAUTH_REDIRECT_URI) return env.UPI_OAUTH_REDIRECT_URI;
  return `${apiOrigin(env)}/api/admin-ops/upi/config/gmail/callback`;
}

/**
 * Create a single-use, admin-bound state row and return its token.
 *
 * The client credentials are carried on the row because the OAuth callback only
 * receives a `code`. They are stored in clear here for at most ten minutes and
 * never leave the server; the durable, encrypted copy is written only once Google
 * has confirmed them.
 */
export async function issueState(
  env: Env,
  adminId: string,
  client: { clientId: string; clientSecret: string },
): Promise<string> {
  const db = getDb();
  const state = randomBytes(32).toString('base64url');

  /* Opportunistic cleanup: expired rows are useless and would otherwise
   * accumulate on every Connect click. */
  await db.delete(gmailOauthStates).where(lt(gmailOauthStates.expiresAt, new Date()));

  /*
   * The client secret is encrypted here too, not just once it reaches
   * `upi_config`. It sits on this row for up to ten minutes, and those ten
   * minutes are the window in which a database read (a backup, a replica, a
   * support query) would otherwise hand out a working OAuth client secret. The
   * key is already required for this flow, so there is no reason to hold it in
   * clear.
   */
  const key = requireSecretsKey(env);

  await db.insert(gmailOauthStates).values({
    state,
    adminId,
    clientId: client.clientId,
    clientSecretEnc: seal(client.clientSecret, key),
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return state;
}

/** The key that encrypts credentials. Required for the dashboard flow. */
function requireSecretsKey(env: Env): Buffer {
  if (!env.UPI_SECRETS_KEY) {
    throw new OAuthError(
      'secrets_key_missing',
      'UPI_SECRETS_KEY is not configured, so credentials cannot be stored securely.',
    );
  }
  try {
    return parseKey(env.UPI_SECRETS_KEY);
  } catch {
    throw new OAuthError(
      'secrets_key_invalid',
      'UPI_SECRETS_KEY is not a valid 32-byte base64 key.',
    );
  }
}

export interface ConsumedState {
  adminId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Consume a state token, returning the admin and client credentials it was
 * issued with.
 *
 * Deleted inside the same statement that reads it, so a concurrent replay finds
 * nothing rather than two callers both succeeding.
 */
export async function consumeState(env: Env, state: string): Promise<ConsumedState> {
  const db = getDb();
  const [row] = await db.delete(gmailOauthStates).where(eq(gmailOauthStates.state, state)).returning();

  if (!row) {
    throw new OAuthError(
      'invalid_state',
      'This sign-in link is not recognised. Start again from the dashboard.',
    );
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new OAuthError(
      'expired_state',
      'This sign-in link has expired. Start again from the dashboard.',
    );
  }

  let clientSecret: string;
  try {
    clientSecret = open(row.clientSecretEnc, requireSecretsKey(env));
  } catch {
    /* A key that changed between Connect and callback is not recoverable here;
     * the operator simply starts again. */
    throw new OAuthError(
      'credentials_unreadable',
      'The stored credentials for this sign-in could not be read. Start again from the dashboard.',
    );
  }

  return { adminId: row.adminId, clientId: row.clientId, clientSecret };
}

export function consentUrl(env: Env, state: string, clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    // Both are required for Google to return a refresh token, and to return a
    // new one even when this client was authorised before.
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface ExchangeResult {
  refreshToken: string;
  accessToken: string;
  scope: string;
}

/**
 * Exchange an authorization code for tokens.
 *
 * A code is single-use and short-lived; every failure here is reported as a
 * precise operator-facing message because the operator can act on all of them.
 */
export async function exchangeCode(
  env: Env,
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<ExchangeResult> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(env),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    /* Never echo the body: a failed token exchange can reflect submitted values. */
    const text = await response.text();
    const errorCode = /"error"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? 'unknown';

    if (errorCode === 'invalid_grant') {
      throw new OAuthError(
        'code_rejected',
        'Google rejected the authorization code. It may have expired or been used already - start the connection again.',
      );
    }
    if (errorCode === 'redirect_uri_mismatch') {
      throw new OAuthError(
        'redirect_mismatch',
        'The redirect URI does not match the one registered on the Google OAuth client. Add the exact URL from the dashboard to Authorised redirect URIs.',
      );
    }
    throw new OAuthError('exchange_failed', `Google rejected the token exchange (${errorCode}).`);
  }

  const json = (await response.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
  };

  if (!json.refresh_token) {
    /* Google omits it when the account already granted consent to this client. */
    throw new OAuthError(
      'no_refresh_token',
      'Google did not return a refresh token. Remove this app under myaccount.google.com/permissions and connect again.',
    );
  }

  const granted = json.scope ?? SCOPE;
  /* Accept only the read-only scope. An extra scope means the consent screen was
   * configured too broadly, and we would be storing a token with more power than
   * the observer needs. */
  const extra = granted
    .split(' ')
    .filter((s) => s && s !== SCOPE && s !== 'openid' && s !== 'email' && s !== 'profile');
  if (extra.length > 0) {
    throw new OAuthError(
      'scope_too_broad',
      `Google granted additional access (${extra.join(', ')}). Remove this app from your Google account permissions, then connect again with only Gmail read access.`,
    );
  }

  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token ?? '',
    scope: SCOPE,
  };
}

/** The address the token actually belongs to, straight from Google. */
export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Mint an access token from a refresh token and confirm the mailbox is readable.
 *
 * Used by "Test connection" and by the callback before storing anything, so a
 * connection is never recorded as working without having been used once.
 */
export async function verifyCredentials(
  env: Env,
  creds: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<{ ok: boolean; email?: string | null; message: string }> {
  let accessToken: string;
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const errorCode = /"error"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? 'unknown';
      if (errorCode === 'invalid_grant') {
        return {
          ok: false,
          message:
            'Google no longer accepts the stored refresh token. This usually means access was revoked, or the OAuth consent screen is in testing mode and the token expired after 7 days. Reconnect the account.',
        };
      }
      return { ok: false, message: `Google refused to issue an access token (${errorCode}).` };
    }
    const json = (await response.json()) as { access_token?: string };
    if (!json.access_token) return { ok: false, message: 'Google returned no access token.' };
    accessToken = json.access_token;
  } catch {
    return { ok: false, message: 'Could not reach Google. Check the server\'s outbound network access.' };
  }

  /* Reading one message proves the scope is sufficient, which a bare token
   * request does not: a token can be valid while lacking Gmail access. */
  try {
    const list = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (list.status === 401 || list.status === 403) {
      return {
        ok: false,
        message: 'The token works but cannot read Gmail. Reconnect and approve read access to the mailbox.',
      };
    }
    if (!list.ok) {
      return { ok: false, message: `Gmail returned ${list.status} when listing messages.` };
    }
  } catch {
    return { ok: false, message: 'Could not reach the Gmail API.' };
  }

  return { ok: true, email: await fetchAccountEmail(accessToken), message: 'Connection verified.' };
}

/**
 * Ask Google to revoke the refresh token.
 *
 * Best effort: if this fails the local credentials are still cleared, because an
 * operator who pressed Disconnect must not be told the mailbox is still attached.
 * The returned flag says whether Google confirmed, so the UI can be honest.
 */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Constant-time compare, used where a state token is compared by hand. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}