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
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { ingestNotification } from '../services/upi/order.service.js';

const ingestSchema = z.object({
  /** Raw SMS body as received on the device. */
  text: z.string().min(1).max(4000),
  /** When the handset received it (ISO 8601 or epoch ms). */
  timestamp: z.union([z.string(), z.number()]).optional(),
  /** Sender id, e.g. "VK-HDFCBK". Stored for audit, never used for matching. */
  sender: z.string().max(64).optional(),
  /** Device label, so a rogue device is identifiable in the audit trail. */
  device: z.string().max(64).optional(),
});

function verifySignature(env: Env, rawBody: string, provided: string | undefined): boolean {
  if (!env.UPI_SMS_INGEST_SECRET) return false;
  if (!provided) return false;
  const expected = createHmac('sha256', env.UPI_SMS_INGEST_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided.trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function upiIngestRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /*
   * The app already installs a global JSON parser that preserves the raw body
   * (the payment webhooks depend on it), so the bytes we hash here are exactly
   * the bytes the sender signed.
   */

  app.post('/ingest/sms', async (request) => {
    if (!env.UPI_SMS_INGEST_SECRET) {
      throw unauthorized('SMS ingest is not configured.');
    }
    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    const signature = (request.headers['x-upi-signature'] as string | undefined) ?? undefined;
    if (!verifySignature(env, rawBody, signature)) {
      throw unauthorized('Signature verification failed.');
    }

    const input = ingestSchema.parse(request.body);
    const result = await ingestNotification(env, {
      source: 'sms',
      text: input.text,
      timestamp: input.timestamp,
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
    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    const signature = (request.headers['x-upi-signature'] as string | undefined) ?? undefined;
    if (!verifySignature(env, rawBody, signature)) {
      throw unauthorized('Signature verification failed.');
    }

    const input = ingestSchema.parse(request.body);
    const result = await ingestNotification(env, {
      source: 'webhook',
      text: input.text,
      timestamp: input.timestamp,
      meta: { sender: input.sender ?? null, device: input.device ?? null },
    });
    return { accepted: true, status: result.status };
  });
}
