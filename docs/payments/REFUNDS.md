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

`PAYMENT_MAX_REFUNDS` (default 5) caps the *number* of partial refunds per
payment. It is enforced inside a single conditional `UPDATE` that counts settled
refunds and claims the refund together, so two concurrent refunds cannot both
pass the check — a read-then-write check would allow exactly that. Failed refunds
do not consume the allowance because they never moved money. Reaching the cap
returns a 400; a payment modified concurrently returns a 409.

Regression coverage: `apps/api/test/refund-limit.test.ts`.

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
