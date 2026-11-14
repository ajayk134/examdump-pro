# ExamDump Pro

A production-ready, premium certification exam-preparation SaaS. Practice with
real exam questions, sit timed mock exams, get AI explanations and track every
weak topic across 160+ certification providers.

> **Exam questions live exclusively in GitHub.** PostgreSQL stores application data
> only (users, sessions, subscriptions, progress, analytics, etc.). Secrets are
> injected by [Doppler](https://doppler.com) and never committed.

---

## Highlights

- **Discovery** — browse/search 1,800+ exams across 160+ providers with filters.
- **Study modes** — practice, reading, random, mock and timed exams.
- **Entitlements** — free accounts unlock 5 questions per exam; Premium unlocks
  everything. Limits are enforced **server-side** and cannot be bypassed by
  pagination, offsets, randomisation or direct question IDs.
- **AI tutor** — premium, on-demand explanations via any OpenAI-compatible API.
- **Progress** — attempts, server-side grading, weak-topic analysis,
  performance charts, streaks, leaderboards and recommendations.
- **Premium** — plans, coupons, referrals, checkout, payment history,
  notifications and a complete admin console.
- **Payments** — Hyperswitch/Razorpay adapters plus a first-party **UPI**
  collection flow with notification-based settlement and admin review.
- **Email centre** — templated transactional mail, campaigns, preferences,
  suppression, queue and rate limiting.
- **Security** — HttpOnly rotating refresh tokens, email verification, password
  reset, Google sign-in, rate limiting, audit logs, validation, Helmet, CORS.
- **Ops** — Docker, nginx, CI/CD, dataset sync cron, backups, health checks.

## Tech stack

| Layer | Technology |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS |
| API | Fastify 5, TypeScript, Zod, Drizzle ORM |
| Data | PostgreSQL 16 (application data) |
| Dataset | Private GitHub repo (`exam-data`) read server-side with a token |
| Auth | JWT access tokens + opaque rotating refresh tokens in HttpOnly cookies, Google OIDC |
| AI | Any OpenAI-compatible endpoint (e.g. NVIDIA NIM), key server-side only |
| Secrets | Doppler |
| Deploy | Docker / Podman Compose, nginx, Oracle Cloud VM |

## Repository layout

```
apps/
  api/                 Fastify API (routes, services, db schema, tests)
  web/                 Next.js frontend
packages/
  shared/              Types, Zod schemas, dataset content parser, plan catalogue
  data-client/         GitHub dataset client (TTL cache, both branch formats)
deploy/                legacy container files (unused); production runs under systemd
docs/                  Architecture, API, database, deployment, security, testing
docs/infrastructure/   Email deliverability audit, mail & pay, UPI collection
.github/
  workflows/           CI (typecheck, tests, builds, docker, secret scan)
  copilot-instructions.md   Authoritative brief for AI coding agents
```

### Inside `apps/api/src`

| Path | Contents |
| --- | --- |
| `routes/` | `auth`, `exams`, `attempts`, `payments`, `upi`, `upi-ingest`, `subscriptions`, `coupons`, `referrals`, `bookmarks`, `notes`, `analytics`, `leaderboard`, `ai`, `support`, `notifications`, `admin*` |
| `services/` | `entitlement`, `subscription`, `dataset`, `catalog`, `auth`, `rbac`, `ai`, `analytics`, `audit`, `settings`, `webhook`, plus `mail/`, `payments/`, `upi/` |
| `db/schema/` | Drizzle tables: `billing`, `catalog`, `enums`, `identity`, `learning`, `mail`, `platform`, `upi` |
| `db/migrations/` | Numbered SQL migrations `0000`–`0007` |
| `config/env.ts` | Single source of truth for every environment variable |

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Create a scratch database on the local PostgreSQL 16 cluster
createdb examdump_dev

# 3. Configure environment (never commit this file)
cp .env.example .env
#    Minimum: DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
#    PASSWORD_PEPPER. Add GITHUB_TOKEN/DATASET_* for real content.
#    Or inject everything with Doppler:
#    doppler run --project examdump-pro --config prd -- npm run dev

# 4. Build shared packages (once)
npm run build -w @examdump/shared
npm run build -w @examdump/data-client

# 5. Apply migrations, then seed plans/settings/admin and sync the catalogue
npm run migrate -w @examdump/api
npm run seed

# 6. Run API (:4000) and web (:3000)
npm run dev
```

Then open `http://localhost:3000`. The API reference is at
`http://localhost:4000/api/docs`.

For the web app during local development, copy
`apps/web/.env.local.example` to `apps/web/.env.local` and point
`NEXT_PUBLIC_API_URL` at the API (default `http://localhost:4000`).

### Demo accounts (created by `npm run seed` in non-production)

- Admin: value of `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- User: `demo@examdump.pro` / `DemoPass123`

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API and web together |
| `npm run build` | Build all workspaces |
| `npm run typecheck` | TypeScript across the monorepo |
| `npm test` | Shared + data-client + API tests (280) |
| `npm run test:api` | API integration tests |
| `npm run seed` | Seed plans, settings, admin and catalogue |
| `npm run migrate -w @examdump/api` | Apply pending migrations |
| `npm run sync:dataset -w @examdump/api` | Re-index the GitHub dataset |
| `npm run db:generate -w @examdump/api` | Generate a migration from schema changes |
| `npm run db:studio -w @examdump/api` | Open Drizzle Studio |
| `npm run format` | Prettier across the repo |

## Environment

See [`.env.example`](.env.example) for every variable and
`apps/api/src/config/env.ts` for validation rules. Groups:

**Core** — `NODE_ENV`, `API_PORT`, `API_HOST`, `WEB_ORIGIN`, `PUBLIC_WEB_URL`,
`PUBLIC_API_URL`, `LOG_LEVEL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`.

**Database** — `DATABASE_URL`, `DATABASE_URL_TEST`, `DATABASE_SSL`,
`DATABASE_POOL_MAX`, `DATABASE_APP_NAME`.

**Auth** — `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`,
`REFRESH_TOKEN_TTL_DAYS`, `PASSWORD_PEPPER`, `BCRYPT_ROUNDS`, `COOKIE_DOMAIN`,
`COOKIE_SECURE`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**Dataset** — `GITHUB_TOKEN`, `DATASET_OWNER`, `DATASET_REPO`, `DATASET_BRANCH`,
`DATASET_CACHE_TTL_SECONDS`, `DATASET_MAX_QUESTIONS_PER_REQUEST`,
`ENABLE_DATASET_SYNC`, `DATASET_SYNC_CRON`, `FREE_QUESTIONS_PER_EXAM`,
`PREMIUM_DAILY_QUESTION_LIMIT`.

**AI** — `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS`,
`AI_MAX_TOKENS`, `AI_DAILY_LIMIT_FREE`, `AI_DAILY_LIMIT_PREMIUM`,
`AI_WEB_SEARCH`.

**Mail** — `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
`MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_PUBLIC_URL`, `MAIL_ENABLED`,
`MAIL_MAX_ATTEMPTS`, `MAIL_RETRY_BASE_MS`, `MAIL_RATE_MAX`,
`MAIL_RATE_WINDOW_MS`, `MAIL_TIMEOUT_MS`, `MAIL_TEST_RECIPIENT`,
`MAIL_QUEUE_ENABLED`, `MAIL_BATCH_SIZE`, `MAIL_WORKER_INTERVAL_SECONDS`,
`MAIL_REMINDER_CRON`, `MAIL_HOURLY_SEND_LIMIT`, `MAIL_CAMPAIGN_BATCH_SIZE`,
`MAIL_LOCK_LEASE_SECONDS`.

**Card / hosted payments** — `PAYMENTS_ENABLED`, `ALLOW_MOCK_PAYMENTS`,
`PAYMENT_PROVIDER`, `PAYMENT_ADAPTER`, `PAYMENT_METHODS`,
`PAYMENT_WEBHOOK_URL`, `PAYMENT_RECONCILE_CRON`, `PAYMENT_HTTP_TIMEOUT_MS`,
`PAYMENT_WEBHOOK_TOLERANCE_SECONDS`, `PAYMENT_MIN_AMOUNT_MINOR`,
`PAYMENT_MAX_AMOUNT_MINOR`, `PAYMENT_MAX_REFUNDS`, `DEFAULT_CURRENCY`,
`HYPERSWITCH_*`, `RAZORPAY_*`.

**UPI** — `UPI_PAYEE_VPA`, `UPI_PAYEE_NAME`, `UPI_ORDER_TTL_MINUTES`,
`UPI_AUTO_APPROVE`, `UPI_NOTIFICATION_MAX_PAISE`, `UPI_GMAIL_POLL_SECONDS`,
`UPI_GMAIL_USER`, `UPI_GMAIL_LABEL`, `UPI_GMAIL_QUERY`, `UPI_GOOGLE_CLIENT_ID`,
`UPI_GOOGLE_CLIENT_SECRET`, `UPI_GOOGLE_REFRESH_TOKEN`,
`UPI_SMS_INGEST_SECRET`.

**Admin** — `ADMIN_EMAIL`, `ADMIN_PASSWORD` (seed only).

## Payments

Three layers exist; only what you enable is live.

1. **Mock** — `ALLOW_MOCK_PAYMENTS=true` in non-production only. Never in prod.
2. **Hosted provider** — Hyperswitch / Razorpay adapters in
   `services/payments/`. Webhook-verified, HMAC-checked, tolerant of retries.
3. **UPI collection** — first-party flow described in
   [`docs/infrastructure/upi-collection.md`](docs/infrastructure/upi-collection.md).

Safety defaults, do not change without an explicit decision:

```
PAYMENTS_ENABLED=false
UPI_AUTO_APPROVE=false
ALLOW_MOCK_PAYMENTS=false   # in production
```

### How UPI works

Each checkout reserves a **unique payable amount**: the plan price plus a random
0–99 paise suffix. A partial unique index (`upi_orders_active_amount_idx`)
guarantees no two active orders share an amount; collisions are retried. The
user sees a QR and `upi://` intent for that exact amount.

Settlement is **notification-based** — the server parses bank alert emails (Gmail
OAuth) or forwarded SMS, matches by amount and reference, and never trusts the
client. With `UPI_AUTO_APPROVE=false`, every match lands in the **admin review
queue** for a human to approve.

Read the full design and threat model in
[`docs/infrastructure/upi-collection.md`](docs/infrastructure/upi-collection.md).

## Testing

```bash
# Integration tests need a real PostgreSQL
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" npm test
```

CI provides a PostgreSQL 16 service automatically. The suite (280 tests) covers
the content parser, the GitHub data client (including masked branch keys), auth,
entitlement enforcement, grading, subscriptions/coupons, payments, UPI amount
reservation and settlement races, the mail centre and the audit trail. Test
fixtures use synthetic question text — never real dataset content.

## Deployment

Full instructions for the Oracle Cloud VM (rootful Podman Compose + Doppler +
nginx + Let's Encrypt) are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

```bash
cd deploy
doppler run --project examdump-pro --config prd -- \
  sudo systemctl restart examdump-api examdump-web
```

Operational facts worth knowing before touching production:

- ExamDump runs natively: `nginx`, `examdump-api`, `examdump-web`, `postgresql`.
  A rootless Podman store exists on the host for the unrelated Omniroute app;
  `podman ps` says nothing about ExamDump.
- Configuration lives in `/etc/examdump-pro/production.env`, rendered from
  Doppler. `sudo` drops exported shell variables — update the file, not the shell.
- nginx proxies to loopback (`127.0.0.1:4000`, `127.0.0.1:3000`), so there is no
  cached container IP to refresh. A 502 means the unit is not listening.
- `deploy/docker-compose.yml` and the Dockerfiles are legacy artifacts kept for
  reference only; they are not used in production.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Database & data model](docs/DATABASE.md)
- [Deployment runbook](docs/DEPLOYMENT.md)
- [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Development](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Changelog](docs/CHANGELOG.md)
- [UPI collection design](docs/infrastructure/upi-collection.md)
- [Mail & payments](docs/infrastructure/mail-and-pay.md)
- [Email deliverability audit](docs/infrastructure/email-deliverability-audit.md)
- [Agent instructions](.github/copilot-instructions.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: see
[SECURITY.md](SECURITY.md).

## License

Proprietary. All exam names and trademarks belong to their respective owners.
Study material is provided for educational purposes only.
