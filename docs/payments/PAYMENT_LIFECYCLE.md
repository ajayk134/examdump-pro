# Payment lifecycle

Two independent rails (hosted provider, and UPI) that converge on the same
outcome: a subscription and an `access_grants` row.

## Hosted provider (card / netbanking / wallet)

Adapter interface: `apps/api/src/services/payments/adapter.ts`. Implementations:
`hyperswitch.client.ts`, `razorpay.adapter.ts`. Selected by
`services/payments/registry.ts` from `PAYMENT_PROVIDER` / `PAYMENT_ADAPTER`.

```
POST /api/payments/checkout
   ├─ PAYMENTS_ENABLED=false → 503, nothing created
   ├─ resolvePaymentAdapter(env) → availability
   ├─ adapter.createOrder({ amount_minor, currency, ... })
   ├─ insert payments (status=pending, order_ref)
   └─ return { redirectUrl }

provider ──▶ POST /api/payments/webhook
   ├─ verify HMAC signature (PAYMENT_WEBHOOK_TOLERANCE_SECONDS window)
   ├─ insert webhook_events (unique idempotency key) — duplicate ⇒ no-op
   ├─ load payments by order_ref
   ├─ adapter.verifyWebhook() → VerifiedWebhook
   ├─ validate transition (pending → captured | failed)
   ├─ subscription.activate() → subscriptions, access_grants
   ├─ invoice_sequences + invoices (one per payment)
   ├─ enqueue receipt mail
   └─ audit_logs
```

### Status transitions

| From | To | Trigger |
| --- | --- | --- |
| `pending` | `captured` | verified webhook |
| `pending` | `failed` | verified webhook |
| `pending` | `captured` | reconciliation poll (missed webhook) |
| `captured` | `refunded` | refund flow |
| `captured` | `partially_refunded` | partial refund |

A payment can never move backwards. Any unexpected transition is logged, not
applied.

### Idempotency

Three layers, all necessary:

1. `webhook_events` unique key — a replayed callback is detected and skipped.
2. `invoices_payment_unique` — one invoice per payment, enforced by the database.
3. `access_grants` is derived from the subscription; re-running activation does
   not double-grant.

## UPI rail

See [UPI.md](UPI.md). Key difference: there is no provider and no webhook. An
order is settled only after a parsed bank notification matches it, and by default
a **human** approves that match.

## Convergence

Both rails end in `subscription.service.activate()`:

```
activate(userId, planId, source)
   ├─ insert subscriptions (active, current_period_end)
   ├─ insert access_grants  (per exam_key, or all)
   ├─ build invoice (+ invoice_sequences counter)
   └─ enqueue confirmation mail
```

This is the only place entitlement is created. Any new payment rail must call it
rather than writing `access_grants` directly.

## Subscription expiry

Daily cron `15 2 * * *` → `expireSubscriptions()`:

- marks `subscriptions` past `current_period_end` as expired,
- revokes the matching `access_grants`.

Entitlement checks also compare `current_period_end` at read time, so a missed
cron run does not leave a stale grant active.

## Failure modes

| Failure | Recovery |
| --- | --- |
| User closes the tab mid-checkout | `payments` stays `pending`; reconciliation resolves it |
| Webhook never delivered | reconciliation poll (`PAYMENT_RECONCILE_CRON`) repairs |
| Webhook delivered twice | idempotency key makes the second a no-op |
| Process crash after gateway success, before DB write | reconciliation finds the captured payment and completes it |
| Bank alert never arrives (UPI) | order expires; manual reconciliation required |

## Related

- [UPI](UPI.md)
- [Refunds](REFUNDS.md)
- [Reconciliation](RECONCILIATION.md)
- [Payment security](PAYMENT_SECURITY.md)
- [Data flow](../architecture/DATA_FLOW.md)
