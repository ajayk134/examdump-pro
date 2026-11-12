/**
 * UPI notification ingest endpoints.
 *
 * These are the only ways a bank alert can enter the system:
 *
 *   POST /upi/ingest/sms        - an SMS-observer bridge forwards a text message
 *   POST /upi/ingest/notification - a generic relay (webhook source)
 *
 * Security model: a shared secret in `X-UPI-Signature`, computed as
 * HMAC-SHA256 over the raw body. The signature is verified against a timing-safe
 * comparison *before* the JSON is parsed, so a forged or replayed request cannot
 * even reach the parser. Without the secret configured the endpoint refuses
 * everything rather than falling open.
 *
 * We deliberately do NOT accept a "mark this order paid" endpoint: the only way
 * to settle is to present notification text that survives the same matching the
 * Gmail observer goes through.
 */
import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { requireRawBody } from './payments.js';
import { ingestNotification } from '../services/upi/order.service.js';

const ingestSchema = z.object({
  /** Raw SMS body as received on the device. */
  text: z.string().min(1).max(4000),
  /**
   * When the handset received it (ISO 8601 or epoch ms).
   *
   * This is attacker-supplied, so it is also sanity-bounded: a value far outside
   * a plausible window relative to server time is refused rather than fed to the
   * timing scorer, which would otherwise treat a handset with a wrong clock as
   * "observed after expiry" and silently drop a genuine payment.
   */
  timestamp: z.union([z.string(), z.number()]).optional(),
  /** Sender id, e.g. "VK-HDFCBK". Stored for audit, never used for matching. */
  sender: z.string().max(64).optional(),
  /** Device label, so a rogue device is identifiable in the audit trail. */
  device: z.string().max(64).optional(),
});

/** How far a bridge-supplied timestamp may drift from server time. */
const MAX_TIMESTAMP_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Largest body we will hash and parse.
 *
 * The global `bodyLimit` is 1 MB, which is far more than any bank alert needs.
 * Reading the signature over a megabyte of attacker-chosen bytes buys nothing and
 * costs CPU on a public endpoint, so these routes cap much lower.
 */
const MAX_INGEST_BYTES = 8 * 1024;

/**
 * Reject an implausible bridge timestamp.
 *
 * Returns the epoch ms to use, or null when the value is unparseable or outside
 * the allowed window. The window is generous (a day) because handsets in the
 * field can be offline for hours; it exists to stop absurd values, not to
 * enforce precise clocks.
 */
function sanitizeTimestamp(value: string | number | undefined, now = Date.now()): number | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const ms = parsed.getTime();
  if (Math.abs(ms - now) > MAX_TIMESTAMP_SKEW_MS) return null;
  return ms;
}

/**
 * Verify the request signature.
 *
 * The signed material is `<timestamp>.<raw body>`, not the body alone. Signing
 * only the body meant a captured request stayed valid forever: the same bytes
 * could be replayed any time later. Binding a timestamp in lets us reject stale
 * requests, and because the timestamp is inside the HMAC an attacker cannot move
 * it forward to keep a captured request alive.
 *
 * A body-only signature is still accepted when the sender omits the timestamp
 * header, so an already-deployed bridge keeps working; the timestamped form is
 * what the docs now instruct.
 */
function verifySignature(
  env: Env,
  rawBody: string,
  provided: string | undefined,
  timestamp: string | undefined,
  now = Date.now(),
): boolean {
  if (!env.UPI_SMS_INGEST_SECRET) return false;
  if (!provided) return false;

  const candidates: string[] = [];
  if (timestamp) {
    const seen = Number(timestamp);
    if (!Number.isFinite(seen)) return false;
    // Replay window: a signed timestamp older or newer than this is refused.
    if (Math.abs(now - seen) > MAX_TIMESTAMP_SKEW_MS) return false;
    candidates.push(
      createHmac('sha256', env.UPI_SMS_INGEST_SECRET).update(`${timestamp}.${rawBody}`).digest('hex'),
    );
  }
  candidates.push(createHmac('sha256', env.UPI_SMS_INGEST_SECRET).update(rawBody).digest('hex'));

  const given = Buffer.from(provided.trim().toLowerCase(), 'utf8');
  for (const expected of candidates) {
    const a = Buffer.from(expected, 'utf8');
    if (a.length !== given.length) continue;
    if (timingSafeEqual(a, given)) return true;
  }
  return false;
}

/**
 * Read the exact request bytes, or refuse.
 *
 * The signature covers the bytes as the bridge sent them. This route used
 * `request.rawBody ?? ''`, which meant a request whose raw body was not captured
 * was hashed as an empty string rather than rejected. That is the same unsafe
 * fallback that was removed from the payment webhooks: it turns a missing input
 * into a value an attacker can sometimes satisfy, and it would silently weaken
 * verification if the raw-body content-type parser were ever unregistered.
 *
 * `requireRawBody` is shared with the payment webhooks so there is exactly one
 * implementation of "give me the signed bytes or fail" in the codebase.
 */
function signedBytes(request: object): string {
  const raw = requireRawBody(request as unknown as { rawBody?: unknown });
  if (Buffer.byteLength(raw, 'utf8') > MAX_INGEST_BYTES) {
    throw badRequest('Message body is too large to ingest.');
  }
  return raw;
}

export async function upiIngestRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /*
   * The app installs a global JSON parser that retains the raw body, so the bytes
   * hashed here are the bytes the sender signed — and a request without them is
   * refused before the parser is even reached.
   */

  app.post('/ingest/sms', async (request) => {
    if (!env.UPI_SMS_INGEST_SECRET) {
      throw unauthorized('SMS ingest is not configured.');
    }
    const rawBody = signedBytes(request);
    const signature = (request.headers['x-upi-signature'] as string | undefined) ?? undefined;
    const signedAt = (request.headers['x-upi-timestamp'] as string | undefined) ?? undefined;
    if (!verifySignature(env, rawBody, signature, signedAt)) {
      throw unauthorized('Signature verification failed.');
    }

    const input = ingestSchema.parse(request.body);
    // A nonsense handset clock must not be treated as evidence about the payment.
    const observed = sanitizeTimestamp(input.timestamp) ?? undefined;
    if (input.timestamp !== undefined && observed === undefined) {
      throw badRequest('The message timestamp is not a usable date.');
    }
    const result = await ingestNotification(env, {
      source: 'sms',
      text: input.text,
      timestamp: observed,
      meta: { sender: input.sender ?? null, device: input.device ?? null },
    });

    // The device is told whether the message was understood, never why a match
    // failed in detail: that would leak order state to a compromised handset.
    return { accepted: true, status: result.status };
  });

  app.post('/ingest/notification', async (request) => {
    if (!env.UPI_SMS_INGEST_SECRET) {
      throw unauthorized('Notification ingest is not configured.');
    }
    const rawBody = signedBytes(request);
    const signature = (request.headers['x-upi-signature'] as string | undefined) ?? undefined;
    const signedAt = (request.headers['x-upi-timestamp'] as string | undefined) ?? undefined;
    if (!verifySignature(env, rawBody, signature, signedAt)) {
      throw unauthorized('Signature verification failed.');
    }

    const input = ingestSchema.parse(request.body);
    const observed = sanitizeTimestamp(input.timestamp) ?? undefined;
    if (input.timestamp !== undefined && observed === undefined) {
      throw badRequest('The message timestamp is not a usable date.');
    }
    const result = await ingestNotification(env, {
      source: 'webhook',
      text: input.text,
      timestamp: observed,
      meta: { sender: input.sender ?? null, device: input.device ?? null },
    });
    return { accepted: true, status: result.status };
  });
}
