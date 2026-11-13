/**
 * Gmail payment-notification observer.
 *
 * Reads a DEDICATED mailbox that receives only bank alerts, using the
 * `gmail.readonly` scope. It never touches the primary support mailbox, never
 * sends mail, and never marks anything as read (we only list and get).
 *
 * Token handling: the refresh token lives in the environment (sourced from
 * Doppler at deploy time). An access token is minted on demand and kept in
 * memory only — it is never written to the database, a log, or the admin API.
 *
 * Scope choice is deliberate. `gmail.modify` or `gmail.metadata` would work but
 * grant more than we need; with `readonly` a leak of this service's credentials
 * cannot delete, send or label anything.
 */

import type { Env } from '../../config/env.js';
import { parseBankEmail } from './parser.js';
import { ingestNotification, recordObserverPoll, type IngestResult } from './order.service.js';
import {
  isGmailObserverConfigured,
  resolveUpiConfig,
  type EffectiveUpiConfig,
} from './config.service.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const OBSERVER_ID = 'gmail';

interface AccessToken {
  value: string;
  expiresAt: number;
}

let cachedToken: AccessToken | null = null;

/**
 * Whether the observer can poll.
 *
 * Credentials may now come from the dashboard (encrypted in `upi_config`) or
 * from the environment, so the check belongs to the config resolver rather than
 * to `env`. Kept as a function here so existing callers and tests are unchanged.
 */
export async function gmailObserverConfigured(env: Env): Promise<boolean> {
  return isGmailObserverConfigured(await resolveUpiConfig(env));
}

/**
 * Mint (or reuse) an access token.
 *
 * Refresh tokens are long-lived; access tokens last an hour. Caching with a
 * safety margin avoids a token request on every poll.
 */
async function getAccessToken(config: EffectiveUpiConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    client_id: config.gmailClientId as string,
    client_secret: config.gmailClientSecret as string,
    refresh_token: config.gmailRefreshToken as string,
    grant_type: 'refresh_token',
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    // Never echo the response body: it can contain token material.
    throw new Error(`oauth_token_failed:${response.status}`);
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('oauth_token_missing');

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/** Reset the cached token. Used when Gmail answers 401. */
export function invalidateAccessToken(): void {
  cachedToken = null;
}

interface GmailMessageRef {
  id: string;
  threadId?: string;
}

/** Gmail MIME parts nest arbitrarily, so the type is recursive. */
interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
  snippet?: string;
}

function headerValue(message: GmailMessage, name: string): string {
  const header = message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}

/** Decode Gmail's base64url body payload. */
function decodeBody(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Walk the MIME tree for the first text/plain part.
 *
 * Plain text is preferred because the parser only needs the wording, and it
 * avoids pulling apart HTML we would then have to strip.
 */
function extractPlainText(message: GmailMessage): string {
  const walk = (part: GmailPart): string => {
    if (part.mimeType === 'text/plain' && part.body?.data) return decodeBody(part.body.data);
    for (const child of part.parts ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return '';
  };
  const plain = walk(message.payload ?? {});
  if (plain) return plain;
  if (message.payload?.body?.data) {
    // Fall back to the top-level body, stripping tags so the parser sees text.
    return decodeBody(message.payload.body.data).replace(/<[^>]+>/g, ' ');
  }
  return message.snippet ?? '';
}

export interface ObserverRunResult {
  configured: boolean;
  scanned: number;
  ingested: number;
  matched: number;
  /** Messages whose query only matched because they were unread. */
  widened: number;
  error?: string;
}

/**
 * Gmail search that returns everything still in the mailbox, ignoring read state.
 *
 * The observer never marks mail read (readonly scope), so a query that filters on
 * `is:unread` selects **all** bank alerts ever received in the mailbox, oldest
 * page first (`maxResults=25` with no page token). Once a mailbox has more than 25
 * such messages, a new payment never appears in the result set at all, and it is
 * dropped silently - the payer's money arrives and the order expires.
 *
 * The observer therefore always searches the whole mailbox. Re-reading recent
 * messages costs one API call each and is harmless: `dedupeKey` and the `bank_reference`
 * unique index make re-ingestion a no-op, so there is no benefit to filtering for
 * "new" mail and a real risk in doing so.
 */
const MAILBOX_WIDE_QUERY = 'in:anywhere';

/**
 * Turn a configured query into one that cannot miss newer mail.
 *
 * Gmail's `newer_than:` is a date bound, which is safe. `is:unread` is not, because
 * this account never marks anything read, so it degenerates into "everything".
 * Dropping it is enough: the wall-clock `newer_than:` bound, if the operator set
 * one, still applies, and dedupe handles the overlap on every poll.
 */
export function normalizeObserverQuery(query: string | undefined): { query: string; widened: boolean } {
  const raw = (query ?? '').trim();
  if (!raw) return { query: MAILBOX_WIDE_QUERY, widened: false };

  /*
   * Remove unread-state terms wherever they appear: `is:unread`, `is:unread ` at
   * the start, inside parentheses, and Gmail's `-is:read` equivalent. Written as
   * a token filter rather than a broad replace so a sender address that happens
   * to contain the word is left alone.
   */
  const tokens = raw.split(/\s+/);
  const kept = tokens.filter((token) => {
    // Strip grouping punctuation before comparing, so `(is:unread)` is recognised
    // as the unread term rather than treated as an unknown safe token.
    const bare = token.replace(/^[(]+/, '').replace(/[)]+$/, '').toLowerCase();
    return bare !== 'is:unread' && bare !== '-is:read';
  });
  const normalized = kept.join(' ').trim();
  if (normalized === raw.trim()) return { query: raw, widened: false };
  return { query: normalized || MAILBOX_WIDE_QUERY, widened: true };
}

/**
 * Poll the payment mailbox once.
 *
 * `query` is a Gmail search expression; the default limits to unread bank mail
 * from well-known alert senders so we do not scan the whole mailbox every minute.
 */
export async function pollGmailOnce(env: Env): Promise<ObserverRunResult> {
  const config = await resolveUpiConfig(env);
  if (!isGmailObserverConfigured(config)) {
    return { configured: false, scanned: 0, ingested: 0, matched: 0, widened: 0 };
  }

  let scanned = 0;
  let ingested = 0;
  let matched = 0;
  let widened = 0;

  try {
    const token = await getAccessToken(config);
    const authHeaders = { Authorization: `Bearer ${token}` };

    const normalized = normalizeObserverQuery(env.UPI_GMAIL_QUERY);
    const query = normalized.query;
    const listUrl = `${GMAIL_API}/messages?maxResults=25&q=${encodeURIComponent(query)}`;
    const listResponse = await fetch(listUrl, { headers: authHeaders });

    if (listResponse.status === 401) {
      invalidateAccessToken();
      throw new Error('gmail_unauthorized');
    }
    if (!listResponse.ok) throw new Error(`gmail_list_failed:${listResponse.status}`);
    if (normalized.widened) {
      widened = 1;
      /*
       * Recorded as a warning rather than silently corrected. An operator who
       * wrote `is:unread` believes new mail is what gets read, and should know
       * that this account never marks anything read.
       */
      console.warn(
        JSON.stringify({
          level: 40,
          msg: 'upi.gmail_query_widened',
          configured: env.UPI_GMAIL_QUERY,
          effective: query,
          reason: 'unread_state_is_not_a_new_message_filter',
        }),
      );
    }

    const list = (await listResponse.json()) as { messages?: GmailMessageRef[] };
    const refs = list.messages ?? [];
    scanned = refs.length;

    for (const ref of refs) {
      const detailUrl = `${GMAIL_API}/messages/${ref.id}?format=full`;
      const detailResponse = await fetch(detailUrl, { headers: authHeaders });
      if (!detailResponse.ok) {
        // One bad message should not abort the whole poll.
        continue;
      }
      const message = (await detailResponse.json()) as GmailMessage;

      const subject = headerValue(message, 'Subject');
      const from = headerValue(message, 'From');
      const dateHeader = headerValue(message, 'Date');
      const body = extractPlainText(message);

      // Only bank-alert shaped mail reaches the parser; everything else is
      // ignored without being stored, keeping the inbox noise out of the DB.
      const parsed = parseBankEmail({ subject, body, date: dateHeader || undefined });
      if (!parsed) continue;

      const result: IngestResult = await ingestNotification(env, {
        source: 'gmail',
        text: `${subject} ${body}`,
        timestamp: parsed.observedAt,
        meta: {
          messageId: message.id,
          from: from.slice(0, 200),
          subject: subject.slice(0, 200),
          internalDate: message.internalDate ?? null,
        },
      });

      ingested += 1;
      if (result.status === 'matched') matched += 1;
    }

    await recordObserverPoll(OBSERVER_ID, { ok: true, cursor: String(Date.now()) });
    return { configured: true, scanned, ingested, matched, widened };
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await recordObserverPoll(OBSERVER_ID, { ok: false, error: message });
    return { configured: true, scanned, ingested, matched, widened, error: message };
  }
}

/**
 * Build the Google consent URL for the payment mailbox.
 *
 * `gmail.readonly` only. `access_type=offline` + `prompt=consent` are what make
 * Google return a refresh token, which the operator stores in Doppler.
 */
export function buildGmailConsentUrl(env: Env, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.UPI_GOOGLE_CLIENT_ID as string,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
