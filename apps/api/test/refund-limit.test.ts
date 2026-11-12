import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TestContext } from './helpers.js';
import { createTestContext, registerVerifiedUser } from './helpers.js';
import { getDb } from '../src/db/client.js';
import { payments, refunds, users } from '../src/db/schema/index.js';
import { refundPayment } from '../src/services/subscription.service.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
  await ensureActor();
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

let seq = 0;

/** A captured local (mock) payment that never touched a real gateway. */
async function seedCapturedPayment(amountMinor = 10_000): Promise<{ paymentId: string; userId: string }> {
  const db = getDb();
  const email = `refund_${Date.now()}_${seq++}@test.local`;
  await registerVerifiedUser(ctx.app, { email });
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error('user not created');

  const [payment] = await db
    .insert(payments)
    .values({
      userId: user.id,
      amountMinor,
      currency: 'INR',
      status: 'succeeded',
      provider: 'mock',
      description: 'Refund limit test',
    })
    .returning();
  if (!payment) throw new Error('payment not created');
  return { paymentId: payment.id, userId: user.id };
}

/** The actor must be a real user row: `refunds.created_by` is a foreign key. */
let actor: { id: string; email: string };

async function ensureActor(): Promise<{ id: string; email: string }> {
  if (actor) return actor;
  const db = getDb();
  const email = `refund_actor_${Date.now()}@test.local`;
  await registerVerifiedUser(ctx.app, { email });
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error('actor not created');
  actor = { id: row.id, email: row.email };
  return actor;
}

describe('PAYMENT_MAX_REFUNDS enforcement', () => {
  it('allows refunds up to the configured ceiling', async () => {
    const env = { ...ctx.env, PAYMENT_MAX_REFUNDS: 2 };
    const { paymentId } = await seedCapturedPayment();

    const first = await refundPayment(env, paymentId, 1_000, 'first', actor);
    expect(first.processed).toBe(true);

    const second = await refundPayment(env, paymentId, 1_000, 'second', actor);
    expect(second.processed).toBe(true);
  });

  it('rejects a refund once the ceiling is reached', async () => {
    const env = { ...ctx.env, PAYMENT_MAX_REFUNDS: 2 };
    const { paymentId } = await seedCapturedPayment();

    await refundPayment(env, paymentId, 1_000, 'first', actor);
    await refundPayment(env, paymentId, 1_000, 'second', actor);

    await expect(refundPayment(env, paymentId, 1_000, 'third', actor)).rejects.toThrow(
      /limit of 2 refunds/i,
    );

    const db = getDb();
    const rows = await db.select().from(refunds).where(eq(refunds.paymentId, paymentId));
    expect(rows).toHaveLength(2);
  });

  it('does not count failed refunds against the ceiling', async () => {
    const env = { ...ctx.env, PAYMENT_MAX_REFUNDS: 2 };
    const db = getDb();
    const { paymentId, userId } = await seedCapturedPayment();

    // Pre-existing failed attempts must not block legitimate refunds.
    await db.insert(refunds).values([
      { paymentId, userId, amountMinor: 1_000, reason: 'failed attempt', status: 'failed', createdBy: actor.id },
      { paymentId, userId, amountMinor: 1_000, reason: 'failed attempt', status: 'failed', createdBy: actor.id },
    ]);

    const ok = await refundPayment(env, paymentId, 1_000, 'legitimate', actor);
    expect(ok.processed).toBe(true);
  });

  it('enforces the ceiling under concurrent refunds', async () => {
    const env = { ...ctx.env, PAYMENT_MAX_REFUNDS: 1 };
    const { paymentId } = await seedCapturedPayment();

    // Two refunds race for a single allowed slot. Exactly one must win, which a
    // read-then-write check would not guarantee.
    const results = await Promise.allSettled([
      refundPayment(env, paymentId, 1_000, 'concurrent a', actor),
      refundPayment(env, paymentId, 1_000, 'concurrent b', actor),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const db = getDb();
    const rows = await db.select().from(refunds).where(eq(refunds.paymentId, paymentId));
    expect(rows).toHaveLength(1);
  });

  it('still refuses refunds that exceed the remaining amount', async () => {
    const env = { ...ctx.env, PAYMENT_MAX_REFUNDS: 5 };
    const { paymentId } = await seedCapturedPayment(5_000);
    await refundPayment(env, paymentId, 4_000, 'most of it', actor);

    await expect(refundPayment(env, paymentId, 2_000, 'too much', actor)).rejects.toThrow(
      /refund up to/i,
    );
  });
});
