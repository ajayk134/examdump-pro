# UPI collection

A first-party UPI flow. **Notification-based**, not bank-verified — read the
limitations section before enabling anything.

Source: `apps/api/src/services/upi/`, routes `apps/api/src/routes/upi.ts`,
`upi-ingest.ts`, `admin-upi.ts`, schema `apps/api/src/db/schema/upi.ts`.

## Status

Ships **disabled**:

```
PAYMENTS_ENABLED=false
UPI_AUTO_APPROVE=false
```

`GET /api/upi/status` reflects this and returns `available:false`.

## The core idea: unique payable amounts

UPI has no callback API for a personal VPA. The only signal that money arrived is
a **bank alert** — an email or SMS saying "₹499.37 credited". To match an alert to
an order unambiguously, every order must ask for a **different amount**.

```
base_amount_paise  = plan price, e.g. 49900  (₹499.00)
suffix_paise       = random 0..99
amount_paise       = 49937                   (₹499.37)
```

Uniqueness is enforced by a partial unique index over *active* orders only:

```sql
CREATE UNIQUE INDEX upi_orders_active_amount_idx ON upi_orders (amount_paise)
  WHERE status IN ('pending', 'under_review');
```

`createUpiOrder()` retries on unique violation until it finds a free amount.
Completed and cancelled orders fall outside the predicate, so their amounts
become reusable.

`upi_orders_amount_suffix_ck` constrains the suffix to 0–99, and
`base_amount_paise` is `NOT NULL` so the original price is always recoverable for
invoicing and refunds.

## Order lifecycle

```
        create
          │
          ▼
      pending ──────────────▶ expired (TTL, sweeper)
          │
          │ bank alert matched
          ▼
   ┌──────────────┐
   │ UPI_AUTO_APPROVE=false │──▶ under_review ──▶ admin approves ──▶ approved
   │ UPI_AUTO_APPROVE=true  │──▶ approved (immediate)
   └──────────────┘
                                   │
                                   ▼
                              subscription granted
```

| Status | Meaning |
| --- | --- |
| `pending` | QR issued, awaiting a bank alert |
| `under_review` | alert matched, waiting for a human |
| `approved` | settled; entitlement granted |
| `expired` | TTL passed without payment |
| `cancelled` | user abandoned it |

`UPI_ORDER_TTL_MINUTES` (default 15) bounds how long an amount is reserved.

## Ingestion

Two sources feed the same `ingestNotification()` function:

1. **Gmail observer** (`gmail-observer.ts`) — OAuth refresh token, polls a label
   every `UPI_GMAIL_POLL_SECONDS`, parses bank alert emails.
2. **SMS/HTTP ingest** — `POST /api/upi/ingest` authenticated with
   `UPI_SMS_INGEST_SECRET` (constant-time comparison), for a phone-forwarding
   bridge.

Parsing (`parser.ts`):

- Rejects non-credit messages (`isCreditNotification`).
- Extracts the credited amount, preferring a currency-marked figure so a message
  mentioning both a credit and a running balance yields the credit.
- Extracts a UTR/RRN reference with a narrow character class.

Deduplication:

- `upi_notifications_dedupe_idx` — the same observed message cannot insert twice.
- `upi_notifications_utr_idx` — the same bank UTR cannot insert twice.

## Risk scoring

`risk.ts` returns `approve` / `review` / `reject` plus reasons. It is explicitly a
scoring function, not proof. Inputs include amount match, uniqueness of the
candidate order, reference agreement and timing. `UPI_NOTIFICATION_MAX_PAISE`
discards implausibly large alerts as noise.

Every decision is written to `upi_risk_events` so a later reviewer can see why a
match was made. Comments in that file state the limitation directly: a
notification is a *claim* that a bank sent something, not evidence that money
settled.

## Settlement

`manuallyApprove()` (admin route) and auto-approval share one code path guarded by:

```sql
CREATE UNIQUE INDEX upi_matches_order_settled_idx ON upi_matches (order_id)
  WHERE decision IN ('auto_approved', 'manual_approved');
```

This makes double settlement impossible even if two admins approve concurrently
or a notification is replayed.

Refunds are recorded in `upi_refunds` with an offline payout reference — the
system does not initiate a UPI refund; a human sends it and records the reference.

## Limitations (read this)

1. **No bank verification.** There is no signed callback from a bank or PSP. A
   sufficiently convincing forged alert that parses and matches an amount would
   be accepted by the matcher.
2. **Therefore automatic approval is dangerous.** `UPI_AUTO_APPROVE=false` exists
   so a human compares each match against the real bank statement.
3. **Email delivery is not guaranteed.** If a bank alert is never delivered, a real
   payment goes unmatched. The order expires and must be reconciled manually.
4. **Amount collisions are mitigated, not impossible.** The unique index guarantees
   uniqueness among *active* orders only. A historic amount reused after an order
   expired is still matched by reference and timing, which is why risk scoring
   considers both.

Do not describe this as "confirmed payment". It is a notification match under
human review.

## Going live

1. Set `UPI_PAYEE_VPA` and `UPI_PAYEE_NAME`.
2. Configure **one** alert source: Gmail OAuth (`UPI_GMAIL_*`, `UPI_GOOGLE_*`) or
   the SMS ingest secret.
3. Set `PAYMENTS_ENABLED=true`. **Leave `UPI_AUTO_APPROVE=false`.**
4. Restart the API.
5. Send one small real transfer.
6. Confirm it appears in the admin review queue — not as settled.
7. Compare against the actual bank statement before approving.
8. Only consider auto-approval after many manual matches have proven reliable.

## Related

- [Payment lifecycle](PAYMENT_LIFECYCLE.md)
- [Refunds](REFUNDS.md)
- [Reconciliation](RECONCILIATION.md)
- [Payment security](PAYMENT_SECURITY.md)
- [Original design note](../infrastructure/upi-collection.md)
