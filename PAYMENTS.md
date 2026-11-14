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

> Historical: this describes the **removed** first-party UPI subsystem. The
> replacement is the [YouPI-PG](#youpi-pg-standalone-upi-gateway) integration
> below; the tables and constants referenced here remain but are unused.

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

## YouPI-PG (standalone UPI gateway)

[YouPI-PG](https://github.com/youpi-pg/YouPI-PG) is deployed as an **independent**
self-hosted gateway (own OS user, runtime, SQLite database and systemd units). It
is not an acquirer and has **no bank API and no scheduled pull**: its status is
driven by notification observers (Gmail / Android SMS) and by an operator
importing a bank-statement CSV.

Integration (all off by default, gated by `YOUPI_ENABLED`, independent of
`PAYMENTS_ENABLED`):

- `POST /api/payments/pay/youpi/checkout` — server-quoted amount, creates a YouPI
  `MANUAL_UPI` session, stores `provider='upi'` + the gateway id in
  `payments.provider_payment_id` / `metadata.youpiPaymentId`, returns the hosted
  checkout URL.
- `POST /api/payments/webhook/youpi` — HMAC-SHA256 over the **raw bytes**
  (`X-Gateway-Signature-V2`, timestamped), replay window
  (`YOUPI_WEBHOOK_TOLERANCE_SECONDS`), idempotency via
  `webhook_events (provider, event_id)`, amount/currency/order validation.

**Fulfilment rule (non-negotiable):** only a `RECONCILED` event with
`settlementState: RECONCILED` reaches `settlePayment`. `OBSERVED_SUCCESS` (a bank
alert was attributed) and `MANUAL_REVIEW` are recorded and ignored — a
notification is not proof that money settled. `SUCCESS` is COD/counter only.

Deployment record and rollback: `docs/deployment/YOUPI_PG_INTEGRATION.md`.
