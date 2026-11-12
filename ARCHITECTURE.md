# Architecture

A two-tier application: Next.js frontend, Fastify API, PostgreSQL for application
data, GitHub for exam content.

> **Detailed design:** [docs/architecture/SYSTEM_DESIGN.md](docs/architecture/SYSTEM_DESIGN.md)

## Topology

```
browsers → nginx (:80/:443) → web (Next.js :3000)
                            → api (Fastify :4000) → PostgreSQL :5432
                                                  → GitHub dataset (HTTPS)
                                                  → SMTP / AI / payment gateway
```

Four containers on one host under rootful Podman:
`deploy/docker-compose.yml`. Rationale and its limitations:
[ADR-005](docs/decisions/ADR-005.md).

## Applications

| Workspace | Stack | Size |
| --- | --- | --- |
| `apps/api` | Fastify 5, Drizzle ORM, Zod, TypeScript | ~19.6k lines, 92 files |
| `apps/web` | Next.js 15 App Router, React 19, Tailwind | ~13.5k lines, 65 files |
| `packages/shared` | Zod schemas, types, content parser | ~1.1k lines |
| `packages/data-client` | GitHub dataset client, TTL cache | ~430 lines |

## The two most important invariants

### 1. Content in GitHub, data in PostgreSQL

Exam questions live in a private GitHub repository and are read server-side at
request time. PostgreSQL holds users, progress, payments, audit — never question
text. See [ADR-001](docs/decisions/ADR-001.md).

Consequences: content updates need no migration; database backups contain no
licensed content; but `question_results` reference questions by string identifiers
with no foreign key, so content removed upstream leaves dangling history.

### 2. Entitlement is decided server-side, in one place

`apps/api/src/services/entitlement.service.ts` is the only place that decides what
a user may access. Free accounts get `FREE_QUESTIONS_PER_EXAM`; premium gets
everything. Answers are withheld at serialisation
(`toClientQuestion(q, includeAnswer)`), so the UI is never the control.

## Layering

```
routes/      HTTP only: guards, validation, serialization
services/    business logic + all database writes
db/schema/   table definitions, no queries
lib/         auth, errors, transactions, pagination
packages/    framework-free, shared with the frontend
```

A route must not query the database directly. A service must not import from
`routes/`.

## Request path

```
nginx → Fastify plugin chain (cookie → CORS → helmet → rate-limit → errors)
      → route guard (requireAuth / requireAdmin / requirePermission)
      → Zod validation
      → service (entitlement check, dataset fetch, DB write)
      → serialized DTO
```

Errors are normalised to `{ error: { code, message, details? } }` by the global
handler in `app.ts`.

## Background work

Workers run **inside the API process** — no Redis, no broker. Queue state is in
PostgreSQL, claimed with `FOR UPDATE SKIP LOCKED`:

| Job | Trigger |
| --- | --- |
| Mail drain | every `MAIL_WORKER_INTERVAL_SECONDS` |
| Mail campaigns/reminders | `MAIL_REMINDER_CRON` |
| Dataset sync | `DATASET_SYNC_CRON` |
| Subscription expiry | daily `15 2 * * *` |
| Payment reconciliation | `PAYMENT_RECONCILE_CRON` |
| UPI observer + sweeper | opt-in, requires `PAYMENTS_ENABLED` |

Trade-off and its scaling ceiling: [ADR-002](docs/decisions/ADR-002.md).

## Database

52 tables, 154 indexes, PostgreSQL 16. Grouped by domain in
[docs/database/SCHEMA.md](docs/database/SCHEMA.md).

Notable correctness constraints (partial unique indexes):

- `upi_orders_active_amount_idx` — no two live UPI orders share an amount.
- `upi_matches_order_settled_idx` — an order settles at most once.
- `upi_notifications_utr_idx` — a bank UTR is counted once.

## Payments

Two rails: a hosted provider adapter (Hyperswitch/Razorpay) and first-party UPI.
Both converge on `subscription.service.activate()`, the only place entitlement is
created.

UPI uses **unique payable amounts** (plan price + 0–99 paise) so a bank alert can
be matched unambiguously. Matching is **notification-based**, not bank-verified,
which is why `UPI_AUTO_APPROVE=false` and a human reviews every match:
[ADR-003](docs/decisions/ADR-003.md).

Both rails ship disabled (`PAYMENTS_ENABLED=false`).

## Related

- [System design](docs/architecture/SYSTEM_DESIGN.md)
- [Data flow](docs/architecture/DATA_FLOW.md)
- [Service dependencies](docs/architecture/SERVICE_DEPENDENCIES.md)
- [Codebase map](CODEBASE_MAP.md)
- [ADRs](docs/decisions/README.md)
