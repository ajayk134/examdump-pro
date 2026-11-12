# Refunds

Two refund rails matching the two payment rails. Both are **recorded**, not
initiated automatically — a human moves the money and the system records it.

## Hosted provider refunds

Table `refunds`, adapter method `adapter.refund()`.

```
POST /api/admin/payments/:id/refund   (permission: payments.refund)
  ├─ load payment; must be captured / partially_refunded
  ├─ count existing refunds ≤ PAYMENT_MAX_REFUNDS
  ├─ validate amount ≤ captured − already refunded
  ├─ adapter.refund() → provider reference
  ├─ insert refunds (status=completed|pending, provider_refund_id)
  ├─ update payments.status → refunded | partially_refunded
  ├─ if fully refunded: revoke access_grants, expire subscription
  └─ audit_logs
```

Full refund revokes entitlement; partial refund does not.

## UPI refunds

Table `upi_refunds`. There is **no API to send money back via UPI** in this
system. The flow is deliberately manual:

```
POST /api/admin/upi/orders/:id/refund  (permission: payments.refund)
  ├─ order must be approved (settled)
  ├─ insert upi_refunds (status=pending, payout_reference=NULL)
  └─ admin pays the user with their own UPI app, then:
       completeRefund(refundId, payoutReference)
         ├─ status=completed, payout_reference recorded
         └─ audit_logs
```

`requestRefund()` then `completeRefund()` are separate steps because the money
moves outside the system. Collapsing them would create a record claiming a payout
that never happened.

## Guards against double refund

- Refund amounts are validated against `payments.refunded_minor` and the captured
  total inside a transaction; `refundableFor()` computes the remaining
  refundable amount as `amount_minor − refunded_minor`.
- The unique settled-match index means a UPI order cannot be settled twice, so it
  cannot be refunded for more than it collected.

> **Known gap — count cap is not enforced.** `PAYMENT_MAX_REFUNDS` is defined in
> `apps/api/src/config/env.ts` (default 5) but is **not read anywhere else**. The
> amount arithmetic prevents over-refunding, but nothing limits the *number* of
> partial refunds. Treat this variable as inert until it is wired up; see
> [known issues](../../KNOWN_ISSUES.md).

## What a refund does to entitlement

| Refund | Entitlement |
| --- | --- |
| Full | `access_grants` revoked, subscription expired |
| Partial | unchanged (policy choice: partial refunds are goodwill) |
| UPI full | grants revoked after `completeRefund` |

Revoking is done via `revokeAllSessions`-style scoping per subscription, not per
user — a user with another active subscription keeps it.

## Audit

Every refund writes an `audit_logs` row with actor, amount, reason and resulting
status. Refund records are never deleted; they are part of the financial history
and may be needed for tax or dispute purposes.

## Related

- [UPI](UPI.md)
- [Payment lifecycle](PAYMENT_LIFECYCLE.md)
- [Payment security](PAYMENT_SECURITY.md)
