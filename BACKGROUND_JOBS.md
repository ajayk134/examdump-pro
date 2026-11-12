# Background jobs

Workers run **inside the API process**. No Redis, no external broker. Queue state
lives in PostgreSQL and is claimed with `FOR UPDATE SKIP LOCKED`.

> **Rationale:** [ADR-002](docs/decisions/ADR-002.md)

## Scheduled work

Registered in `apps/api/src/index.ts`.

| Job | Schedule | Function |
| --- | --- | --- |
| Mail queue drain | every `MAIL_WORKER_INTERVAL_SECONDS` (20 s) | `services/mail/worker.ts` |
| Mail campaigns & reminders | `MAIL_REMINDER_CRON` | `mail/campaign.service.ts` |
| Dataset sync | `DATASET_SYNC_CRON` | `scripts/sync-dataset.ts` |
| Subscription expiry | daily `15 2 * * *` | `subscription.service.ts` |
| Payment reconciliation | `PAYMENT_RECONCILE_CRON` | `webhook.service.ts` |
| UPI observer + sweeper | opt-in | `services/upi/worker.ts` |

The UPI worker starts only when both `PAYMENTS_ENABLED` and `UPI_PAYEE_VPA` are
set.

## Mail queue mechanics

The reference implementation of every pattern used here.

```
enqueue         → insert email_queue (status=pending, scheduled_for, dedupe_key)
claim batch     → UPDATE ... WHERE id IN (
                    SELECT id FROM email_queue
                    WHERE status='pending' AND scheduled_for <= now()
                    ORDER BY scheduled_for LIMIT $1
                    FOR UPDATE SKIP LOCKED
                  ) RETURNING *
send            → nodemailer
success         → status=sent, insert mail_logs
failure         → attempts+1, next_attempt_at = backoff
                  attempts > MAIL_MAX_ATTEMPTS → status=failed
```

Why each piece matters:

- **`SKIP LOCKED`** — two workers never claim the same row and never block. This is
  what makes a restart mid-batch safe.
- **Lease (`MAIL_LOCK_LEASE_SECONDS`)** — a crashed worker's rows become claimable
  again after the lease expires. Without it, a crash would strand mail forever.
- **`dedupe_key`** — a retried request cannot enqueue the same mail twice.
- **`timer.unref()`** — an idle queue does not keep the process alive.

## Failure handling

| Failure | Behaviour |
| --- | --- |
| SMTP down | retried with exponential backoff up to `MAIL_MAX_ATTEMPTS` |
| Provider rate limit | `MAIL_HOURLY_SEND_LIMIT` throttles the batch |
| Hard bounce / complaint | address added to `email_suppressions`, future mail skipped |
| GitHub unavailable | dataset sync logs the error and retries next cron |
| Payment gateway down | reconciliation retries next cron; no data lost |

Workers never fail the HTTP request that triggered them — enqueueing is the only
synchronous step.

## Scaling limit

Workers, cron and rate limiting are **per process**. Running two API instances would
duplicate cron work and double rate limits. Before horizontal scaling, workers must
be separated into a single-instance process. Tracked in
[TECH_DEBT.md](TECH_DEBT.md).

## Inspecting

```sql
select status, count(*) from email_queue group by status;
select id, status, attempts, next_attempt_at from email_queue
where status = 'failed' order by created_at desc limit 20;
select trigger, repaired, mismatches, created_at from reconciliation_runs
order by created_at desc limit 10;
```

## Related

- [ADR-002](docs/decisions/ADR-002.md)
- [Email](EMAIL.md)
- [Caching](CACHING.md)
- [Monitoring](docs/operations/MONITORING.md)
