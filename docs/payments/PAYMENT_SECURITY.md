# Payment security

The integrity of money and entitlement. This is the highest-risk subsystem in the
codebase, and the documentation says plainly where it is strong and where it is
not.

## Principle: the client decides nothing

No payment endpoint accepts "this payment succeeded" from the browser. Settlement
comes from exactly two sources:

1. A **cryptographically verified webhook** from the payment provider.
2. A **parsed bank notification** matched to a unique amount, reviewed by a human.

There is no third path. `POST /api/payments/*` creates orders; it never settles
them.

## Controls by threat

| Threat | Control | Strength |
| --- | --- | --- |
| Client marks own order paid | no such endpoint exists | strong |
| Forged webhook | HMAC signature + tolerance window | strong |
| Replayed webhook | `webhook_events` idempotency key | strong |
| Duplicate settlement | `upi_matches_order_settled_idx`, `invoices_payment_unique` | strong |
| Amount tampering | amount computed server-side from the plan, never accepted from client | strong |
| UPI amount collision | `upi_orders_active_amount_idx` partial unique index | strong |
| Notification replay | `upi_notifications_utr_idx`, dedupe key | strong |
| Forged UPI alert | parser + risk scoring + **human review** | **partial** |
| Double refund | refund amount arithmetic vs captured total | strong |
| Excess refund count | `PAYMENT_MAX_REFUNDS` **not enforced** | **gap** |
| Privilege escalation on refund | `payments.refund` permission + audit log | strong |

## Webhook verification

```
signature = HMAC(secret, rawBody)
reject if |now − timestamp| > PAYMENT_WEBHOOK_TOLERANCE_SECONDS
reject if signature mismatch (constant-time compare)
```

The raw body must be verified **before** JSON parsing — re-serialising changes
bytes and breaks the HMAC. `apps/api/src/app.ts:69` registers a custom
`application/json` content-type parser that stores the raw string on
`request.rawBody`, and the webhook handlers verify against that.

The handlers do **not** fall back to re-serialising the parsed body. When
`rawBody` is absent the request is rejected with a 400 by `requireRawBody`, because
a request with no captured bytes cannot be authenticated and re-serialisation is
not byte-identical. Keep the parser registration in `app.ts` so well-formed
webhooks continue to be accepted.

## UPI: an honest assessment

The UPI rail has **no bank-verified confirmation**. There is no signed callback
from a bank or PSP. Evidence of payment is a parsed email/SMS, which is a claim,
not proof.

Consequences:

- A convincing forged alert that parses correctly and matches an active order's
  unique amount would satisfy the matcher.
- Risk scoring (`services/upi/risk.ts`) reduces but cannot eliminate this.
- **`UPI_AUTO_APPROVE=false` is the actual control.** Every match is queued for a
  human to compare against the real bank statement.

Do not enable `UPI_AUTO_APPROVE=true` on the reasoning that matching "works" —
matching works for *honest* alerts. The failure mode is a deliberate forgery, which
matching alone cannot distinguish.

## Refunds

- Amount limited by `payments.amount_minor − payments.refunded_minor`.
- Full refund revokes entitlement; partial does not.
- UPI refunds are recorded only after a human pays out and supplies a reference.
- Every refund writes `audit_logs`.

Gap: `PAYMENT_MAX_REFUNDS` is defined but not read, so the *number* of partial
refunds is unbounded. Amount arithmetic still prevents over-refunding.

## Admin access

All `/api/admin-ops/*` payment routes are guarded. Two different guards are in
use and they are not equivalent:

| Route file | Guard | Granularity |
| --- | --- | --- |
| `routes/admin-ops.ts` | `requirePermission(...)` | fine-grained (`payments.manage`, `payments.refund`) |
| `routes/admin.ts` | `requirePermission(...)` | fine-grained |
| `routes/admin-upi.ts` | `requireAdmin` | coarse — any Administrator |

`payments.refund` is held by Administrator and Billing roles only. Every action
writes an `audit_logs` row with the actor id.

> **Known gap:** `routes/admin-upi.ts` guards with `requireAdmin` rather than
> `requirePermission`, so Support and Content roles are excluded only because they
> lack the admin role — not because of a payment-specific check. Tracked in
> [known issues](../../KNOWN_ISSUES.md).

## Data protection

- Full card data never touches this system — the provider hosts the payment page.
- Only provider references (`provider_payment_id`, `order_ref`) are stored.
- UPI alerts are stored in `upi_notifications` including a raw excerpt for audit.
  These can contain a payer name/VPA; treat the table as personal data.

## Pre-go-live checklist

- [ ] `PAYMENTS_ENABLED=false` until explicitly authorised
- [ ] `UPI_AUTO_APPROVE=false`
- [ ] `ALLOW_MOCK_PAYMENTS=false` in production
- [ ] Webhook secrets set and distinct per provider
- [ ] `COOKIE_SECURE=true`, HTTPS only
- [ ] `UPI_PAYEE_VPA` verified against the real bank account
- [ ] One real small payment tested end to end, reviewed manually
- [ ] `reconciliation_runs` cron registered and observed
- [ ] Refund exercised once and audited
- [ ] Alert source (Gmail or SMS bridge) proven to deliver

## Related

- [UPI](UPI.md)
- [Refunds](REFUNDS.md)
- [Reconciliation](RECONCILIATION.md)
- [Threat model](../security/THREAT_MODEL.md)
- [PAYMENTS.md](../../PAYMENTS.md)
