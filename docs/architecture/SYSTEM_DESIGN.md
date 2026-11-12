# System design

ExamDump Pro is a two-tier web application: a Next.js frontend and a Fastify API,
both backed by a single PostgreSQL database. Exam question content is **not** in
that database — it is read from a private GitHub repository at request time.

## Runtime topology

```
                    ┌──────────────────────────────┐
   browsers ───────▶│ nginx :80/:443               │
                    │ TLS, gzip, static, proxy     │
                    └───────────┬──────────────────┘
                                │
                 ┌──────────────┴───────────────┐
                 ▼                              ▼
        ┌─────────────────┐            ┌──────────────────┐
        │ web (Next.js)   │            │ api (Fastify)    │
        │ :3000           │───fetch───▶│ :4000            │
        └─────────────────┘            └────────┬─────────┘
                                                │
                    ┌───────────────────────────┼──────────────────┐
                    ▼                           ▼                  ▼
          ┌──────────────────┐      ┌────────────────┐   ┌─────────────────┐
          │ PostgreSQL 16    │      │ GitHub dataset │   │ SMTP / AI /     │
          │ :5432            │      │ (HTTPS, token) │   │ payment gateway │
          └──────────────────┘      └────────────────┘   └─────────────────┘
```

All four containers run on one host under **rootful Podman** via
`deploy/docker-compose.yml`:

| Service | Image | Exposed | Purpose |
| --- | --- | --- | --- |
| `nginx` | `nginx:1.27-alpine` | 80, 443 | TLS termination, routing, compression |
| `web` | `deploy/Dockerfile.web` | internal 3000 | Next.js standalone server |
| `api` | `deploy/Dockerfile.api` | internal 4000 | Fastify, migrations, background workers |
| `postgres` | `postgres:16-alpine` | internal 5432 | Application data |

## Request lifecycle

1. **nginx** terminates TLS and proxies `/api/*` to `api:4000`, everything else to
   `web:3000`.
2. **API** runs the Fastify plugin chain in `apps/api/src/app.ts`:
   cookie → CORS → Helmet → rate-limit → error handler → route plugins.
3. Each route plugin authenticates via a guard from `apps/api/src/lib/guards.ts`
   (`requireAuth`, `requireAdmin`, `requirePermission`, `optionalAuth`,
   `requireVerified`).
4. Handlers validate input with Zod, call a service, and return a serialized DTO
   (`apps/api/src/lib/serializers.ts`).
5. Errors are normalised by the global error handler into
   `{ error: { code, message, details? } }`.

Order matters: the error handler is registered **before** route plugins so every
child route inherits it.

## Process model

The API is one Node process that also hosts background work:

| Worker | Trigger | Source |
| --- | --- | --- |
| Mail queue drain | every `MAIL_WORKER_INTERVAL_SECONDS` | `services/mail/worker.ts` |
| Mail scheduled jobs | `MAIL_REMINDER_CRON` | `services/mail/campaign.service.ts` |
| Dataset sync | `DATASET_SYNC_CRON` | `scripts/sync-dataset.ts` |
| Subscription expiry | daily `15 2 * * *` | `services/subscription.service.ts` |
| Payment reconciliation | `PAYMENT_RECONCILE_CRON` | `services/webhook.service.ts` |
| UPI observer + sweeper | opt-in, `PAYMENTS_ENABLED` + `UPI_PAYEE_VPA` | `services/upi/worker.ts` |

There is **no Redis and no external queue**. All queue state is in PostgreSQL
(`email_queue`, `upi_observer_state`), so a restart resumes cleanly. This is a
deliberate trade-off: a single instance can run workers safely, but horizontal
scaling requires the lock/lease mechanism (`MAIL_LOCK_LEASE_SECONDS`) to be
respected — see [ADR-003](../decisions/ADR-003.md).

## Two data planes

This split is the most important architectural invariant.

| Plane | Storage | Contents |
| --- | --- | --- |
| **Application data** | PostgreSQL | users, sessions, subscriptions, payments, attempts, progress, notes, analytics, audit |
| **Exam content** | Private GitHub repo | question text, options, answers, explanations |

The dataset is fetched server-side by `packages/data-client` with a read-only
token, cached in-process for `DATASET_CACHE_TTL_SECONDS`. Only *metadata*
(provider and exam catalogue) is mirrored into PostgreSQL for search and
browsing (`catalog_providers`, `catalog_exams`).

Why: content updates must not require a migration, and content must never be
recoverable from an application-data backup. See
[ADR-001](../decisions/ADR-001.md).

## Entitlement enforcement

Entitlement is decided in the service layer, never the UI:

```
request → requireAuth → entitlement.resolveEntitlements()
        → if free: dataset slice limited to FREE_QUESTIONS_PER_EXAM
        → data-client fetch → toClientQuestion(q, includeAnswer)
```

`apps/api/src/services/entitlement.service.ts` is the only place that decides
what a user may see. Offset, random-seed and direct-ID requests all funnel
through it, which is why the free tier cannot be bypassed by pagination tricks.

Answers are withheld at serialisation time by `toClientQuestion()` in
`apps/api/src/routes/exams.ts`: mock/timed assessments set `includeAnswer=false`
so the correct option and explanation never reach the browser before grading.

## Failure isolation

| Dependency down | Effect |
| --- | --- |
| PostgreSQL | API returns 500; web still serves static pages |
| GitHub dataset | `DatasetError` → 404 for unknown exam, 502 for upstream failure |
| SMTP | Mail queue retries with backoff; requests succeed |
| AI provider | `POST /api/ai/*` fails; rest of the app unaffected |
| Payment gateway | Checkout unavailable; entitlement unchanged |

The API never blocks a request on mail, AI or payment provider availability.

## Source map

| Concern | File |
| --- | --- |
| Fastify assembly | `apps/api/src/app.ts` |
| Server bootstrap, cron, workers | `apps/api/src/index.ts` |
| Env validation | `apps/api/src/config/env.ts` |
| Auth guards | `apps/api/src/lib/guards.ts` |
| Error types | `apps/api/src/lib/errors.ts` |
| DB client | `apps/api/src/db/client.ts` |
| Migrations | `apps/api/src/db/migrations/` |
| Dataset client | `packages/data-client/src/` |
| Container topology | `deploy/docker-compose.yml` |
| Reverse proxy | `deploy/nginx/nginx.conf` |

## Related

- [Data flow](DATA_FLOW.md)
- [Service dependencies](SERVICE_DEPENDENCIES.md)
- [Architecture overview](../../ARCHITECTURE.md)
- [ADRs](../decisions/README.md)
