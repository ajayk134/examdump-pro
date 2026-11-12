# Reconciliation

Repairs drift between the gateway's view and ours. Implemented in
`reconcilePayments()` — `apps/api/src/services/webhook.service.ts:218`.

## Why it exists

A webhook can be lost for many reasons: network failure, a deploy mid-request, a
crash between "gateway charged" and "database updated", or a provider outage.
Without reconciliation, a user who paid would never receive entitlement, and the
only fix would be a manual database edit.

## Trigger

`PAYMENT_RECONCILE_CRON` (only registered when `checkoutReady(env)` is true).
Each run records a row in `reconciliation_runs` with the trigger, counts and
outcome.

```bash
# inspect recent runs
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c \
  "select trigger, repaired, mismatches, created_at
   from reconciliation_runs order by created_at desc limit 10;"
```

## Algorithm

```
for each payment still in a non-terminal state
    adapter.fetchPaymentStatus(order_ref)      ← external call, no transaction
    compare gateway status with local status
        gateway captured, local pending  → complete the settlement
        gateway failed,   local pending  → mark failed
        local captured,   gateway pending → flag mismatch (do not downgrade)
        both agree                        → skip
    write reconciliation_runs
```

The external call happens **outside** any transaction. Holding a transaction open
across a gateway request would exhaust the connection pool
(`DATABASE_POOL_MAX`, default 20) and hold row locks for the duration.

Settlement goes through the same `activate()` path as a webhook, so idempotency
applies: reconciliation cannot double-grant.

## Deliberate asymmetry

- A payment the gateway says is captured but we show as pending is **repaired
  upwards** — the user gets what they paid for.
- A payment we show as captured but the gateway will not confirm is **flagged, not
  reversed**. Silently revoking access from a paying user is worse than an
  investigation.

Mismatches increment a counter and are logged; they require human review.

## UPI reconciliation

Different problem: there is no gateway to ask. Instead:

- `expireStaleOrders()` sweeps orders past `expires_at`.
- Unmatched notifications sit in `upi_notifications` with a status for review.
- An admin can manually match a notification to an order when automation failed
  (e.g. the alert arrived after expiry).

Manual matching is audited and subject to the same one-settlement-per-order
unique index.

## Related

- [Payment lifecycle](PAYMENT_LIFECYCLE.md)
- [UPI](UPI.md)
- [Monitoring](../operations/MONITORING.md)
- [Incident response](../operations/INCIDENT_RESPONSE.md)
