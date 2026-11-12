/**
 * Gmail observer OAuth handshake — one-time operator step.
 *
 * The payment mailbox needs a long-lived refresh token so the observer can read
 * bank alerts without a human present. Obtaining one is a manual dance that used
 * to be described in prose only, which made it easy to get wrong (wrong scope,
 * missing `access_type=offline`, refresh token never issued).
 *
 * This script does exactly two things:
 *
 *   npm run upi:gmail-oauth -- print-url
 *       Print the Google consent URL for the configured client + redirect URI.
 *
 *   npm run upi:gmail-oauth -- exchange <authorization-code>
 *       Exchange the code Google redirected back with for a refresh token, and
 *       print instructions for storing it. The token is printed to **stdout
 *       only** and is never written to a file, the database or a log.
 *
 * Scope is `gmail.readonly` and nothing else: the observer must not be able to
 * send, delete or label mail.
 *
 * Usage:
 *   doppler run --project examdump-pro --config prd -- \
 *     npm run upi:gmail-oauth -w @examdump/api -- print-url
 */
import { getEnv } from '../config/env.js';

/** Must match the redirect URI registered on the OAuth client exactly. */
const DEFAULT_REDIRECT_URI = 'https://developers.google.com/oauthplayground';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function fail(message: string): never {
  // stderr, so a shell redirect of the success path cannot swallow an error.
  console.error(`error: ${message}`);
  process.exit(1);
}

function redirectUri(): string {
  return process.env.UPI_OAUTH_REDIRECT_URI || DEFAULT_REDIRECT_URI;
}

function requireClient(): { id: string; secret: string } {
  const env = getEnv();
  if (!env.UPI_GOOGLE_CLIENT_ID || !env.UPI_GOOGLE_CLIENT_SECRET) {
    fail(
      'UPI_GOOGLE_CLIENT_ID and UPI_GOOGLE_CLIENT_SECRET must be set ' +
        '(doppler run --project examdump-pro --config prd -- ...)',
    );
  }
  return { id: env.UPI_GOOGLE_CLIENT_ID as string, secret: env.UPI_GOOGLE_CLIENT_SECRET as string };
}

async function printUrl(): Promise<void> {
  const { id } = requireClient();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    // Both are required for Google to return a refresh token, and to return a
    // new one even if this client was authorised before.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  console.log('1. Sign in as the DEDICATED payment mailbox, not your own account.');
  console.log('2. Approve read-only Gmail access.');
  console.log(`3. Redirect URI for this handshake: ${redirectUri()}`);
  console.log('4. Copy the `code` query parameter Google returns, then run:');
  console.log('     npm run upi:gmail-oauth -w @examdump/api -- exchange <code>');
  console.log('');
  console.log(url);
}

async function exchange(code: string): Promise<void> {
  const { id, secret } = requireClient();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    /*
     * The response body from a failed token exchange can echo the submitted
     * secret in diagnostics. Only the status and a short error code are surfaced,
     * never the payload.
     */
    const text = await response.text();
    const errorCode = /"error"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? 'unknown';
    fail(
      `token exchange failed with HTTP ${response.status} (${errorCode}). ` +
        'A code is single-use and expires in minutes; request a fresh one.',
    );
  }

  const json = (await response.json()) as { refresh_token?: string; scope?: string };
  if (!json.refresh_token) {
    /*
     * Google omits the refresh token when the account has already granted this
     * client consent. Re-running with prompt=consent from `print-url` is the fix.
     */
    fail(
      'Google returned no refresh_token. Re-run `print-url`, sign in, and approve ' +
        'again — a refresh token is only issued on a fresh consent.',
    );
  }
  if (json.scope && !json.scope.split(' ').every((s) => s === SCOPE)) {
    fail(
      `granted scope was "${json.scope}", expected only ${SCOPE}. Revoke the app's ` +
        'access in the Google account and repeat the handshake.',
    );
  }

  console.log('Refresh token obtained. Store it, then delete it from your shell history.');
  console.log('');
  console.log(`  doppler secrets set UPI_GOOGLE_REFRESH_TOKEN --project examdump-pro --config prd`);
  console.log('');
  console.log('The value to paste (printed once, never written to disk):');
  console.log('');
  console.log(json.refresh_token);
  console.log('');
  console.log('Then verify: GET /api/admin-ops/upi/overview should report observerConfigured: true.');
}

async function main(): Promise<void> {
  const [, , command, argument] = process.argv;

  if (command === 'print-url') {
    await printUrl();
    return;
  }
  if (command === 'exchange') {
    if (!argument) fail('usage: upi-gmail-oauth exchange <authorization-code>');
    await exchange(argument);
    return;
  }

  console.log('Usage:');
  console.log('  npm run upi:gmail-oauth -w @examdump/api -- print-url');
  console.log('  npm run upi:gmail-oauth -w @examdump/api -- exchange <code>');
  process.exit(1);
}

main().catch((err) => fail((err as Error).message));
