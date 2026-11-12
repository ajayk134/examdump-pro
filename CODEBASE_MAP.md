# Codebase map

Where everything lives. Update this file when the structure changes.

## Top level

```
apps/api/          Fastify API
apps/web/          Next.js frontend
packages/shared/   Zod schemas, types, content parser (shared with web)
packages/data-client/  GitHub dataset client (server-only)
deploy/            Dockerfiles, compose, nginx, backup/restore
docs/              detailed documentation (start at docs/README.md)
.github/           CI workflows, Copilot instructions
```

## apps/api/src

```
config/env.ts          ← single source of truth for all environment variables
app.ts                 ← Fastify assembly: plugins, error handler, route registration
index.ts               ← bootstrap, cron schedules, worker startup, shutdown
openapi.ts             ← OpenAPI document served at /api/docs

db/
  client.ts            postgres() pool configuration
  apply-migrations.ts  migration runner (also run by the container at boot)
  seed.ts              plans, roles, permissions, settings, demo data
  schema/              Drizzle tables
    identity.ts        users, sessions, auth_tokens, login_attempts, roles,
                       permissions, role_permissions, user_roles
    learning.ts        attempts, question_results, exam_progress, user_stats,
                       notes, bookmarks, goals, daily_usage
    billing.ts         plans, subscriptions, payments, invoices,
                       invoice_sequences, refunds, coupons, coupon_redemptions,
                       referrals, access_grants, webhook_events
    upi.ts             upi_orders, upi_notifications, upi_matches,
                       upi_refunds, upi_risk_events, upi_observer_state
    mail.ts            email_queue, email_preferences, email_suppressions,
                       email_templates, email_campaigns, mail_logs
    platform.ts        settings, feature_flags, announcements, audit_logs,
                       error_events, catalog_*, notifications, support_tickets,
                       ticket_messages, ai_conversations, ai_messages,
                       reconciliation_runs
    enums.ts           shared enum definitions
  migrations/          numbered SQL, 0000–0007

lib/
  guards.ts            requireAuth, requireAdmin, requirePermission,
                       requireVerified, optionalAuth  ← all auth decisions
  jwt.ts               HS256 access-token sign/verify
  tokens.ts            randomToken, hashToken (sha256), safeEqual
  passwords.ts         bcrypt + pepper
  cookies.ts           refresh-cookie helpers
  errors.ts            AppError and factories  ← throw only through these
  pagination.ts        page-size clamping
  serializers.ts       DTO shaping
  tx.ts                AnyPgTx transaction type
  validation.ts        request validation helpers

routes/                one file per feature; registered in app.ts
  auth.ts users.ts exams.ts attempts.ts bookmarks.ts notes.ts
  analytics.ts leaderboard.ts notifications.ts support.ts ai.ts
  subscriptions.ts payments.ts coupons.ts referrals.ts
  upi.ts upi-ingest.ts
  admin.ts admin-ops.ts admin-email.ts admin-upi.ts
  email-preferences.ts health.ts

services/
  auth.service.ts            registration, login, refresh, reset
  rbac.service.ts            role → permission resolution
  entitlement.service.ts     ← the only place access is decided
  subscription.service.ts    activation, expiry, cancellation, refunds
  catalog.service.ts         provider/exam catalogue
  dataset.service.ts         question fetching + free-tier slicing
  analytics.service.ts       progress, weak topics, stats
  audit.service.ts           audit_logs writes
  settings.service.ts        typed settings
  usage.service.ts           daily quota accounting
  notification.service.ts    in-app notifications
  ai.service.ts              single-shot AI calls
  ai-chat.service.ts         multi-turn tutoring
  webhook.service.ts         gateway webhooks + reconciliation
  hyperswitch.client.ts      Hyperswitch HTTP client
  mail/                      send pipeline (14 files, see below)
  payments/                  adapter, registry, hyperswitch, razorpay
  upi/                       order lifecycle, parser, risk, qr, uri, money,
                             gmail observer, worker

scripts/
  migrate.ts           CLI migration entry
  sync-dataset.ts      dataset catalogue refresh
```

### apps/api/src/services/mail

| File | Role |
| --- | --- |
| `queue.service.ts` | enqueue, claim (`FOR UPDATE SKIP LOCKED`), retry |
| `worker.ts` | drain loop |
| `transport.ts` | nodemailer SMTP |
| `render.ts` | template rendering |
| `templates.ts` | built-in templates |
| `template-store.ts` | DB-backed templates |
| `placeholders.ts` | placeholder substitution |
| `policy.service.ts` | suppression, preferences, rate limits |
| `deliverability.ts` | headers and reputation helpers |
| `headers.ts` | MIME headers |
| `unsubscribe.ts` | unsubscribe token/link |
| `campaign.service.ts` | bulk sends and scheduled jobs |
| `notify.service.ts` | high-level "send this kind of mail" |
| `mail.service.ts` | facade |

### apps/api/src/services/upi

| File | Role |
| --- | --- |
| `order.service.ts` | create, match, approve, refund, stats |
| `parser.ts` | extract amount/UTR from a bank alert |
| `risk.ts` | scoring → approve/review/reject |
| `money.ts` | integer paise arithmetic |
| `uri.ts` | `upi://` deep link |
| `qr.ts` | server-rendered QR SVG |
| `gmail-observer.ts` | OAuth mailbox poller |
| `worker.ts` | observer + expiry sweeper |

## apps/web

```
app/                 App Router pages
  layout.tsx page.tsx globals.css
  exams/ browse/ practice/ study/ mock/ history/ dashboard/
  pricing/ checkout/ invoices/ ask/ bookmarks/ notes/ leaderboard/
  referrals/ support/ profile/ login/ register/ forgot-password/
  reset-password/ verify-email/ unsubscribe/ privacy/ terms/ security/
  admin/             admin console
  sitemap.ts robots.ts
components/          23 shared components (mostly client)
  markdown.tsx       the only Markdown renderer (no new deps allowed)
  ui.tsx             shared primitives
  admin-*.tsx        admin consoles
lib/                 client helpers, local-store
```

46 of the 58 `.tsx` files under `app/` and `components/` are client components.

Rendering strategy and performance: [docs/performance/FRONTEND.md](docs/performance/FRONTEND.md).

## packages

| File | Role |
| --- | --- |
| `shared/src/schemas.ts` | **all** Zod request/response schemas |
| `shared/src/content.ts` | dataset content parser |
| `shared/src/constants.ts` | shared constants |
| `data-client/src/dataset.ts` | GitHub reader (both branch formats) |
| `data-client/src/cache.ts` | TTL + LRU cache |
| `data-client/src/types.ts` | dataset types |

## deploy

| File | Role |
| --- | --- |
| `docker-compose.yml` | 4 services, network aliases, logging limits |
| `Dockerfile.api` | multi-stage Node 22 build → `dist/` |
| `Dockerfile.web` | multi-stage, Next standalone output |
| `nginx/nginx.conf` | TLS, gzip, upstreams, SSE handling |
| `backup.sh` | pg_dump custom format, 14-day retention |
| `restore.sh` | pg_restore `--clean --if-exists` |
| `.env.production.example` | variable names only |

## Where to look for a given task

| Task | Files |
| --- | --- |
| Add an endpoint | `routes/`, `packages/shared/src/schemas.ts`, `app.ts` |
| Change access rules | `services/entitlement.service.ts`, `lib/guards.ts` |
| Add a table | `db/schema/`, then `npm run db:generate` |
| Change grading | `routes/attempts.ts`, `services/analytics.service.ts` |
| Payment changes | `services/payments/`, `services/webhook.service.ts` |
| UPI changes | `services/upi/` — read [ADR-003](docs/decisions/ADR-003.md) first |
| Email changes | `services/mail/` |
| Deploy changes | `deploy/`, [docs/deployment/PRODUCTION.md](docs/deployment/PRODUCTION.md) |
