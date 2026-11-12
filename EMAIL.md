# Email

Transactional mail, campaigns, preferences and suppression. Postgres-backed queue,
in-process worker.

> **Detailed:** [docs/infrastructure/mail-and-pay.md](docs/infrastructure/mail-and-pay.md) ·
> [deliverability audit](docs/infrastructure/email-deliverability-audit.md)

## Pipeline

```
service → mail.service.enqueue() → email_queue
worker  → claim (FOR UPDATE SKIP LOCKED, lease)
        → policy checks (preferences, suppressions, MAIL_HOURLY_SEND_LIMIT)
        → render template + placeholders
        → nodemailer over SMTP
        → mail_logs
```

## Configuration

`SMTP_HOST/PORT/SECURE/USER/PASS`, `MAIL_FROM`, `MAIL_REPLY_TO`,
`MAIL_PUBLIC_URL`, `MAIL_ENABLED`. When SMTP is unset, mail is logged instead of
sent (development behaviour, never in production).

Queue tuning: `MAIL_QUEUE_ENABLED`, `MAIL_BATCH_SIZE`,
`MAIL_WORKER_INTERVAL_SECONDS`, `MAIL_MAX_ATTEMPTS`, `MAIL_RETRY_BASE_MS`,
`MAIL_LOCK_LEASE_SECONDS`, `MAIL_HOURLY_SEND_LIMIT`,
`MAIL_CAMPAIGN_BATCH_SIZE`.

## Tables

| Table | Purpose |
| --- | --- |
| `email_queue` | durable outbox with lease, attempts, dedupe key |
| `mail_logs` | one row per send attempt |
| `email_templates` | editable templates |
| `email_preferences` | per-user opt-in per category |
| `email_suppressions` | hard bounces and complaints (keyed by address) |
| `email_campaigns` | bulk sends |

## Compliance

- Unsubscribe link in every marketing message (`services/mail/unsubscribe.ts`).
- `email_suppressions` is keyed by **email address**, so it survives account
  deletion and re-registration.
- Transactional mail respects preferences but not marketing opt-outs.

## Deliverability

Sender authentication (SPF/DKIM/DMARC) is a DNS configuration concern, documented in
the [deliverability audit](docs/infrastructure/email-deliverability-audit.md). Poor
authentication is the usual cause of landing in spam, not the application code.

## Related

- [Background jobs](BACKGROUND_JOBS.md)
- [Monitoring](docs/operations/MONITORING.md)
