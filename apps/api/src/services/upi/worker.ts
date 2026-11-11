/**
 * UPI background worker.
 *
 * Three responsibilities, all of which must be safe to run more than once:
 *
 *  1. poll the payment mailbox for new bank alerts (Gmail observer);
 *  2. expire orders whose payment window has closed;
 *  3. (pages are driven by the client; no long-poll state is kept here).
 *
 * Each run is guarded so a slow poll cannot overlap itself, and every failure is
 * recorded in `upi_observer_state` so the admin dashboard can show staleness
 * instead of silently going quiet.
 */

import type { Env } from '../../config/env.js';
import { expireStaleOrders } from './order.service.js';
import { gmailObserverConfigured, pollGmailOnce } from './gmail-observer.js';

let pollTimer: NodeJS.Timeout | null = null;
let expiryTimer: NodeJS.Timeout | null = null;

/** Guards against overlapping polls if one cycle runs long. */
let polling = false;
let expiring = false;

export const upiWorkerState = {
  started: false,
  lastPollAt: null as Date | null,
  lastPollResult: null as { scanned: number; ingested: number; matched: number } | null,
  lastError: null as string | null,
};

async function runPoll(env: Env): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const result = await pollGmailOnce(env);
    upiWorkerState.lastPollAt = new Date();
    upiWorkerState.lastPollResult = {
      scanned: result.scanned,
      ingested: result.ingested,
      matched: result.matched,
    };
    if (result.error) {
      upiWorkerState.lastError = result.error;
      // Loud, but not fatal: the next tick retries.
      console.error(JSON.stringify({ level: 40, msg: 'upi.gmail_poll_failed', error: result.error }));
    } else {
      upiWorkerState.lastError = null;
      if (result.ingested > 0) {
        console.log(
          JSON.stringify({
            level: 30,
            msg: 'upi.gmail_poll',
            scanned: result.scanned,
            ingested: result.ingested,
            matched: result.matched,
          }),
        );
      }
    }
  } catch (err) {
    upiWorkerState.lastError = (err as Error).message.slice(0, 300);
    console.error(JSON.stringify({ level: 50, msg: 'upi.poll_crashed', error: upiWorkerState.lastError }));
  } finally {
    polling = false;
  }
}

async function runExpiry(): Promise<void> {
  if (expiring) return;
  expiring = true;
  try {
    const count = await expireStaleOrders();
    if (count > 0) {
      console.log(JSON.stringify({ level: 30, msg: 'upi.orders_expired', count }));
    }
  } catch (err) {
    // Expiry is best-effort; the checkout also treats a past `expiresAt` as
    // expired, so a missed sweep never lets a stale order settle.
    console.error(JSON.stringify({ level: 40, msg: 'upi.expiry_failed', error: (err as Error).message }));
  } finally {
    expiring = false;
  }
}

/**
 * Start the worker. Idempotent: calling twice does not double the timers.
 */
export function startUpiWorker(env: Env): void {
  if (upiWorkerState.started) return;
  upiWorkerState.started = true;

  // Expiry runs regardless of observer configuration: it keeps the order table
  // honest even when notifications come in over SMS only.
  expiryTimer = setInterval(() => void runExpiry(), 60_000);
  expiryTimer.unref?.();

  if (gmailObserverConfigured(env) && env.UPI_GMAIL_POLL_SECONDS > 0) {
    pollTimer = setInterval(() => void runPoll(env), env.UPI_GMAIL_POLL_SECONDS * 1000);
    pollTimer.unref?.();
    // First poll shortly after boot so a restart does not wait a full interval.
    setTimeout(() => void runPoll(env), 5_000).unref?.();
    console.log(
      JSON.stringify({
        level: 30,
        msg: 'upi.worker_started',
        pollSeconds: env.UPI_GMAIL_POLL_SECONDS,
        autoApprove: env.UPI_AUTO_APPROVE,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        level: 30,
        msg: 'upi.worker_started',
        observer: 'disabled',
        reason: gmailObserverConfigured(env) ? 'poll_interval_zero' : 'not_configured',
      }),
    );
  }
}

export function stopUpiWorker(): void {
  if (pollTimer) clearInterval(pollTimer);
  if (expiryTimer) clearInterval(expiryTimer);
  pollTimer = null;
  expiryTimer = null;
  upiWorkerState.started = false;
}
