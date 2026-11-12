# Concurrency testing

The UPI and payment subsystems are the only areas where two requests can race in a
way that costs money. These cases are covered in `apps/api/test/upi.test.ts` and
`payments.test.ts` by driving concurrent operations against a real database.

## Why this matters here

Two classes of bug are invisible to sequential tests:

1. **Amount collision** — two users checking out simultaneously get the same
   payable amount, making bank-alert matching ambiguous.
2. **Double settlement** — a replayed notification or two admins approving at once
   grants entitlement twice.

Both are enforced by **database constraints**, not application logic, so the tests
must run against real PostgreSQL.

## Invariants under test

| Invariant | Enforced by |
| --- | --- |
| No two active orders share `amount_paise` | `upi_orders_active_amount_idx` (partial unique) |
| One settlement per order | `upi_matches_order_settled_idx` (partial unique) |
| One notification per UTR | `upi_notifications_utr_idx` (partial unique) |
| One invoice per payment | `invoices_payment_unique` |
| One webhook effect per event | `webhook_events` idempotency key |
| Mail sent once per queue row | `FOR UPDATE SKIP LOCKED` claim |

## Testing approach

Drive the racing operations with `Promise.all` and assert on **outcomes**, not on
which call won:

```ts
// amount collision: both orders must succeed with different amounts
const results = await Promise.all([
  createUpiOrder(env, { userId: userA, planId }),
  createUpiOrder(env, { userId: userB, planId }),
]);
expect(new Set(results.map(r => r.amountPaise)).size).toBe(2);

// double settlement: only one approval may take effect
const outcomes = await Promise.allSettled([
  manuallyApprove(env, orderId, adminA),
  manuallyApprove(env, orderId, adminB),
]);
expect(outcomes.filter(o => o.status === 'fulfilled').length).toBe(1);
```

Assertions must tolerate either ordering — the point is that exactly one winner
emerges, not which one.

## Determinism

Concurrency tests can be flaky if they depend on real timing. Mitigations used
here:

- **Determinism by construction.** The invariant is enforced by a unique index, so
  the result is deterministic regardless of interleaving.
- **Injected randomness.** `setSuffixRandom()` pins the suffix so a collision can
  be forced deliberately rather than waited for.
- **No sleeps.** Never `await new Promise(r => setTimeout(r, N))` to "let things
  settle" — it makes the suite slow and still racy.

A genuinely timing-dependent test should be rewritten to force the condition
instead of hoping for it.

## What is not covered

- Multi-instance scheduling contention across separate API processes. The mail
  worker's `FOR UPDATE SKIP LOCKED` is tested logically, not with two real
  processes.
- Load-induced races (pool exhaustion, lock waits under high concurrency). See
  [LOAD_TESTING.md](../../LOAD_TESTING.md).

## Related

- [Integration testing](INTEGRATION_TESTING.md)
- [UPI design](../payments/UPI.md)
- [Indexes](../database/INDEXES.md)
- [Testing overview](README.md)
