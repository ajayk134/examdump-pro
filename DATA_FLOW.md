# Data flow

Summary of how data moves. Full detail:
[docs/architecture/DATA_FLOW.md](docs/architecture/DATA_FLOW.md).

## Two data planes

| Plane | Storage | Contents |
| --- | --- | --- |
| Application | PostgreSQL | users, sessions, subscriptions, payments, attempts, progress, audit |
| Content | Private GitHub repo | questions, options, answers, explanations |

The planes never mix. Content is fetched per request and cached in-process;
only metadata (`catalog_providers`, `catalog_exams`) is mirrored into PostgreSQL.

## Paths

### Anonymous browse
`browser → nginx → web → api → catalog tables + GitHub metadata`. No writes.

### Register / login
`api/auth → users, sessions, auth_tokens, login_attempts → email_queue`.
Refresh tokens rotate on every use.

### Study
`api/exams → entitlement check → GitHub fetch → answer withheld for assessments`.
`api/attempts/:id/submit → server-side grading → attempts, question_results,
exam_progress, user_stats`.

The dataset is the source of truth for correctness; the client never supplies an
answer key.

### Checkout (hosted provider)
`checkout → adapter → payments(pending) → redirect`. Provider webhook → HMAC
verify → `webhook_events` idempotency → `subscriptions`, `access_grants`,
`invoices`. Reconciliation repairs missed webhooks.

### UPI
`POST /api/upi/orders → unique amount (base + 0–99 paise) → upi_orders(pending)`.
Bank alert → parser → risk score → match by amount → `under_review` (default) or
settled. Human approval is the control.

### Mail
`enqueue → email_queue → worker claim → render → SMTP → mail_logs`. Retries with
backoff; suppressions enforced.

## Write ownership

| Data | Written by |
| --- | --- |
| users, sessions, tokens | `auth.service` |
| attempts, results, progress | `attempts` route + `analytics.service` |
| subscriptions, payments, invoices | `subscription.service`, `webhook.service` |
| UPI records | `upi/order.service` |
| mail rows | `services/mail/*` |
| catalogue | dataset sync cron |
| audit, errors, webhooks | cross-cutting services |

## Related

- [Detailed data flow](docs/architecture/DATA_FLOW.md)
- [Architecture](ARCHITECTURE.md)
- [Database](DATABASE.md)
- [Payments](PAYMENTS.md)
