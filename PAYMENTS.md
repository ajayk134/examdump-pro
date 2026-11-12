# Payments

Two rails: a hosted provider adapter and first-party UPI. Both ship **disabled**.

```
PAYMENTS_ENABLED=false
UPI_AUTO_APPROVE=false
ALLOW_MOCK_PAYMENTS=false   # production
```

> **Detailed:** [UPI](docs/payments/UPI.md) ·
> [lifecycle](docs/payments/PAYMENT_LIFECYCLE.md) ·
> [refunds](docs/payments/REFUNDS.md) ·
> [reconciliation](docs/payments/RECONCILIATION.md) ·
> [security](docs/payments/PAYMENT_SECURITY.md)

## Core rule

The client cannot settle a payment. Settlement comes only from:

1. a signature-verified provider webhook, or
2. a parsed bank notification matched to a unique amount — reviewed by a human.

## Hosted provider

Adapter interface `services/payments/adapter.ts`; implementations Hyperswitch and
Razorpay. Selected by `registry.ts`. Webhooks are HMAC-verified over the raw body
with a replay window, and `webhook_events` provides idempotency. Reconciliation
(`PAYMENT_RECONCILE_CRON`) repairs missed webhooks by polling the gateway.

## UPI

No callback exists for a personal VPA, so the only signal is a bank alert. Every
order therefore requests a **unique amount**:

```
amount_paise = base_amount_paise + random(0..99)
```

Enforced by `upi_orders_active_amount_idx` (partial unique over active orders).
Creation retries on collision. An alert is matched by amount, then risk-scored,
then **held for human review** unless `UPI_AUTO_APPROVE=true`.

**Limitation, stated plainly:** matching is notification-based, not bank-verified.
There is no signed callback. A convincing forged alert could satisfy the matcher.
That is exactly why auto-approval is off by default and a human compares against the
real bank statement. See [ADR-003](docs/decisions/ADR-003.md).

## Money

Integer paise everywhere. Never floats. `services/upi/money.ts`.

## Going live

1. Set `UPI_PAYEE_VPA` / `UPI_PAYEE_NAME` and an alert source.
2. `PAYMENTS_ENABLED=true`, **keep `UPI_AUTO_APPROVE=false`**.
3. Restart, send one small real transfer.
4. Confirm it lands in the admin review queue.
5. Compare with the bank statement before approving.

## Known gaps

- `PAYMENT_MAX_REFUNDS` is defined but **not enforced**.
- `admin-upi.ts` guards with coarse `requireAdmin` rather than a payment-specific
  permission.

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
