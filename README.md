# ExamDump Pro

ExamDump Pro is a production certification-exam preparation SaaS: browse a
catalogue of certification exams, practise real exam-style questions, sit timed
mocks, track weak topics, and ask an AI tutor for explanations.

The live deployment is **one Oracle Cloud host** running native systemd services,
nginx, and PostgreSQL 16. There is no staging environment, no container
deployment for this application, and no backup automation in this repository.
Production is the only deployed environment.

- Public site: <https://examtopicspro.duckdns.org>
- API health: <https://examtopicspro.duckdns.org/api/health>
- API reference (running): `/api/docs` on the API origin

> **Agent instructions:** every coding agent must read [`AGENTS.md`](AGENTS.md)
> before changing code. GitHub Copilot also reads
> [`.github/copilot-instructions.md`](.github/copilot-instructions.md) and the
> path-specific files in `.github/instructions/`.

---

## Architecture at a glance

```text
browsers
  │  HTTPS 80/443
  ▼
nginx (public)
  ├──► Next.js web        127.0.0.1:3000
  │       └── same-origin /api/* through nginx
  └──► Fastify API        127.0.0.1:4000
          ├── PostgreSQL 16           127.0.0.1:5432
          ├── private GitHub dataset  raw.githubusercontent.com
          ├── NVIDIA NIM (AI)
          ├── Gmail SMTP + Postgres mail queue
          └── YouPI-PG merchant API   pay-api.examdumppay.duckdns.org
                    │
                    └── independent YouPI-PG services on 127.0.0.1:6001/6100/7000
```

`nginx` is the only process listening publicly. The web app, API, PostgreSQL and
YouPI-PG admin/API ports bind to loopback.

Both `examdump-api` and `examdump-web` run as the unprivileged `examdump` user
from `/opt/examdump-pro`. They are separate systemd units; restarting one does
not restart the other.

### Stack

| Layer        | Technology                                                                         |
| ------------ | ---------------------------------------------------------------------------------- |
| Web          | Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 3                        |
| API          | Fastify 5, TypeScript, Zod, Drizzle ORM, `postgres` driver                         |
| Data         | PostgreSQL 16 for all application data                                             |
| Exam content | Private GitHub repository `ajayk134/exam-data`, read server-side                   |
| Auth         | JWT access cookie + opaque rotating refresh session; optional Google OIDC          |
| AI           | OpenAI-compatible API, NVIDIA NIM by default, server-side key                      |
| Mail         | Gmail SMTP with a durable PostgreSQL-backed queue                                  |
| Payments     | YouPI-PG (live UPI rail), HyperSwitch/Razorpay adapters, dev-only mock             |
| Runtime      | Node.js 22 (`/opt/examdump-pro/node`, v22.23.5), systemd, nginx                    |
| CI           | GitHub Actions: typecheck, tests against ephemeral PostgreSQL 16, builds, gitleaks |

### Repository layout

```text
apps/
  api/                 Fastify API, Drizzle schema/migrations, services, tests
  web/                 Next.js App Router frontend and browser tests
packages/
  shared/              Types, Zod schemas, plan catalogue, content normaliser
  data-client/         Server-only GitHub dataset client with TTL/LRU cache
.github/
  workflows/ci.yml     Verification pipeline
  instructions/        Path-scoped Copilot rules
  prompts/             On-demand Copilot workflows
  agents/              Specialist Copilot agents
```

There is no `deploy/` directory and no tracked deployment script. Production is
deployed manually from the host layout described below.

---

## Source entry points

| Concern                                                               | Authoritative file                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| API bootstrap, startup checks, cron jobs, shutdown                    | `apps/api/src/index.ts`                                                           |
| Fastify instance, middleware, error shape, route registration         | `apps/api/src/app.ts`                                                             |
| Environment schema, defaults and validation                           | `apps/api/src/config/env.ts`                                                      |
| Database pool and Drizzle client                                      | `apps/api/src/db/client.ts`                                                       |
| Schema exports (identity, learning, catalog, billing, platform, mail) | `apps/api/src/db/schema/index.ts`                                                 |
| Migration runner and per-statement applier                            | `apps/api/src/scripts/migrate.ts`, `apps/api/src/db/apply-migrations.ts`          |
| Access decisions (subscriptions, grants, admin)                       | `apps/api/src/services/entitlement.service.ts`                                    |
| Checkout, settlement, invoices                                        | `apps/api/src/services/subscription.service.ts`                                   |
| YouPI-PG client and webhook verification                              | `apps/api/src/services/payments/youpi.client.ts`                                  |
| Payment adapter registry                                              | `apps/api/src/services/payments/registry.ts`                                      |
| Community votes and threaded discussions                              | `apps/api/src/routes/community.ts`, `apps/api/src/services/community.service.ts`  |
| AI provider calls, fallbacks, prompts, SSE                            | `apps/api/src/services/ai.service.ts`, `apps/api/src/services/ai-chat.service.ts` |
| Dataset fetch and catalogue sync                                      | `packages/data-client/src/dataset.ts`, `apps/api/src/services/dataset.service.ts` |
| Browser API client and single-flight refresh                          | `apps/web/lib/api.ts`                                                             |
| Production API base resolution                                        | `apps/web/lib/api-base.ts`                                                        |
| Auth/theme/toast providers                                            | `apps/web/components/providers.tsx`                                               |
| Practice runner and autosave                                          | `apps/web/components/study-session.tsx`                                           |
| Mock/timed runner                                                     | `apps/web/components/mock-session.tsx`                                            |
| OpenAPI document                                                      | `apps/api/src/openapi.ts`                                                         |
| CI pipeline                                                           | `.github/workflows/ci.yml`                                                        |

### Request flow

```text
nginx
  → Fastify middleware (cookie, CORS, Helmet, rate limit, error handlers)
  → route guard (`requireAuth` / `requireAdmin` / `requirePermission`)
  → Zod validation from `packages/shared/src/schemas.ts`
  → service (entitlement check, dataset fetch, database write)
  → serialised DTO or SSE stream
```

Errors are normalised to:

```json
{ "error": { "code": "CODE", "message": "Human readable", "details": [] } }
```

The raw JSON body is preserved as `request.rawBody` for payment webhook
signature verification. Do not replace the custom content-type parser with a
parser that re-serialises the body.

---

## Domain rules that shape the code

### Content lives in GitHub, application data lives in PostgreSQL

Exam questions are fetched server-side from the private `exam-data` repository at
request time. They are **never** copied into PostgreSQL, fixtures, tests, seed
data, logs, or commits. PostgreSQL stores users, sessions, subscriptions,
payments, attempts, progress, analytics, audit entries, and catalogue metadata.

The catalogue tables (`catalog_providers`, `catalog_exams`) contain only provider
and exam metadata for fast discovery/search. They do not contain question text.
Question results reference question IDs by string; there is no foreign key to the
external dataset.

### Entitlement is resolved server-side, in one place

`resolveEntitlements()` derives access from active subscriptions and access
grants, plus the `admin` role. The denormalised `users.plan` column is not the
authority. Free accounts receive the first `FREE_QUESTIONS_PER_EXAM` questions of
an exam; paid scopes unlock a single exam, up to three exams, or everything.

The API slices the accessible question set **before** filtering or randomising,
so pagination, topic filters, offsets, and direct question IDs cannot reach a
locked question. Answer keys are withheld during question delivery and grading
happens on the server.

### Payments settle only from verified server-side evidence

- The browser redirect never settles a payment.
- Amounts are quoted server-side and stored in integer minor units (paise).
- YouPI-PG settles **only** on a signature-verified `RECONCILED` webhook. The
  `OBSERVED_SUCCESS` and `MANUAL_REVIEW` states are recorded and ignored.
- HyperSwitch and Razorpay settlement paths verify signatures over the exact raw
  body and re-check status server-to-server.
- `ALLOW_MOCK_PAYMENTS` is dev-only; production returns 403 for mock activation.

See [`.github/instructions/payments.instructions.md`](.github/instructions/payments.instructions.md)
before touching any payment file.

### Community data is scoped to one question

Community votes and discussions live in PostgreSQL, keyed by
`provider/exam/questionId` because question IDs are only unique within an exam.
A voter has one row per question; changing the answer updates that row instead of
adding a second vote. Discussion comments can nest, deletes are soft so replies
never disappear, and only the author or an admin may edit or delete a comment.
The question experience reveals both panels only after the learner has committed
to an answer, so neither can act as an answer key during practice or a mock.

### Background work is in-process and PostgreSQL-backed

The API process owns all scheduled work. There is no Redis or external broker.

| Job                        | Trigger                                               |
| -------------------------- | ----------------------------------------------------- |
| Mail queue drain           | every `MAIL_WORKER_INTERVAL_SECONDS`                  |
| Mail reminders/campaigns   | `MAIL_REMINDER_CRON`                                  |
| Dataset catalogue sync     | `DATASET_SYNC_CRON`                                   |
| Subscription expiry        | daily at `15 2 * * *`                                 |
| HyperSwitch reconciliation | `PAYMENT_RECONCILE_CRON`, only when checkout is ready |
| Invoice backfill           | once at boot for already-paid payments                |

The mail worker recovers abandoned rows at boot and releases them with a lease;
state is durable in `email_queue`.

---

## Local development

Use Node.js 22 for parity with production. The repository declares
`node >=20.11.0`, CI uses Node 22, and production runs Node 22.23.5.

```bash
npm ci

# Build workspace packages before running either app.
npm run build -w @examdump/shared
npm run build -w @examdump/data-client
```

### Environment

`.env.example` documents the variables, but the API does **not** load `.env`
automatically. Export the values in the calling shell, or inject them with
Doppler:

```bash
export DATABASE_URL="postgres://examdump:change-me@127.0.0.1:5432/examdump_dev"
export JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
export JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
export PASSWORD_PEPPER="$(openssl rand -hex 16)"
# Optional: GITHUB_TOKEN, AI_API_KEY, SMTP_*, payment credentials

npm run dev   # API :4000 + web :3000
```

Or, for a machine with Doppler access:

```bash
doppler run --project examdump-pro --config prd -- npm run dev
```

For the web app, copy `apps/web/.env.local.example` to
`apps/web/.env.local` and set `NEXT_PUBLIC_API_URL=http://localhost:4000`.
The example currently says `4100`; the API dev server is on `4000`.

### Local database

Use a scratch database. Never point local commands at the production database.

```bash
createdb examdump_dev
npm run migrate -w @examdump/api
npm run seed
```

`npm run seed` creates default plans, settings, feature flags, email templates,
coupons, an announcement, the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, a demo
learner in non-production, and syncs the catalogue when
`ENABLE_DATASET_SYNC=true`.

### Common commands

| Command                                 | Purpose                                      |
| --------------------------------------- | -------------------------------------------- |
| `npm run dev`                           | Run API and web together                     |
| `npm run dev:api` / `npm run dev:web`   | Run one side                                 |
| `npm run build`                         | Build shared, data-client, API, web in order |
| `npm run typecheck`                     | TypeScript across all workspaces             |
| `npm run lint`                          | Same as typecheck (there is no ESLint)       |
| `npm run test`                          | Shared, data-client, API, then web tests     |
| `npm run test:api`                      | API integration tests only                   |
| `npm run seed`                          | Seed plans/settings/admin/catalogue          |
| `npm run migrate -w @examdump/api`      | Apply pending migrations                     |
| `npm run sync:dataset -w @examdump/api` | Re-index the GitHub catalogue                |
| `npm run db:generate -w @examdump/api`  | Generate a migration from schema edits       |
| `npm run db:studio -w @examdump/api`    | Open Drizzle Studio                          |
| `npm run format`                        | Prettier across the repo                     |

### Tests

API integration tests require a real PostgreSQL database supplied through
`DATABASE_URL_TEST` (the tests reset the `public` and `drizzle` schemas and apply
migrations themselves). CI starts an ephemeral `postgres:16-alpine` service; a
developer may use a disposable local scratch database, never production.

```bash
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5432/examdump_test" \
  npm run test:api

npm run test -w @examdump/shared
npm run test -w @examdump/data-client
npm run test -w @examdump/web
```

Note: CI runs shared, data-client, and API tests, then builds both apps. It does
**not** run `apps/web/test`; run the web suite locally when changing frontend
logic.

Do not report a change as verified without running the command that proves it.
`npm run typecheck` passing is necessary but is not a substitute for the relevant
tests.

---

## Database and migrations

PostgreSQL 16 holds 56 application tables across eight schema groups:

| Group      | Tables / purpose                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `identity` | users, sessions, auth tokens, roles/permissions, login attempts, audit logs                                    |
| `learning` | attempts, question results, exam progress, user stats, bookmarks, notes, goals, daily usage                    |
| `catalog`  | provider and exam metadata synced from GitHub                                                                  |
| `billing`  | plans, subscriptions, access grants, payments, refunds, coupons, referrals, webhooks, reconciliation, invoices |
| `platform` | settings, feature flags, notifications, announcements, support tickets, error events                           |
| `mail`     | mail logs, durable queue, templates, preferences, campaigns, suppressions                                      |
| `community`| question votes and threaded question discussions                                                               |
| `enums`    | PostgreSQL enum types shared by the above                                                                      |

Migrations live in `apps/api/src/db/migrations` (`0000`–`0009`) and are applied
by a custom runner:

- Statements execute individually because `ALTER TYPE ... ADD VALUE` cannot run
  inside a transaction block.
- Enum additions are guarded, so re-running is safe.
- Progress is recorded in `drizzle.__drizzle_migrations`.
- Migrations are **forward-only**. Never edit an applied migration.
- **Migrations do not run automatically at API boot.** Apply them explicitly
  before restarting the API.

The runner searches `MIGRATIONS_DIR`, then `src/db/migrations`,
`apps/api/src/db/migrations`, and `db/migrations` relative to the working
directory. The deployed layout keeps SQL in `/opt/examdump-pro/api/migrations`,
which is **not** one of the default relative paths. Set `MIGRATIONS_DIR`
explicitly when running migrations from `/opt/examdump-pro/api`.

`db:push` bypasses the migration history. Never run it against production.

### Dormant UPI tables

Migrations `0006`–`0008` create UPI collection tables (`upi_orders`,
`upi_notifications`, `upi_matches`, `upi_risk_events`, `upi_observer_state`,
`upi_refunds`, `upi_config`, `gmail_oauth_states`). No current route, service, or
Drizzle schema module uses them, and the `upi:gmail-oauth` script referenced by
`apps/api/package.json` does not exist. Treat these tables as historical; do not
build new features on them without an explicit decision. The live UPI rail is the
separate YouPI-PG integration, not these tables.

`0007_upi_amount_suffix.sql` has a journal timestamp that sorts before `0005`, so
a fresh database skips it. Production already has it applied. This does not affect
live behaviour while the UPI tables are dormant, but it is a reason not to rely on
those tables.

---

## Authentication and security

- Access token: HS256 JWT, 15-minute default, HttpOnly `ed_access` cookie with
  path `/`, plus a Bearer-header fallback for API clients.
- Refresh token: opaque random token stored as a hash in `sessions`, HttpOnly
  `ed_refresh` cookie with path `/api/auth`, 30-day default, rotated on refresh.
- Cookies are `SameSite=Lax` and `Secure` in production.
- `requireAuth` verifies the JWT **and** loads the user and session, rejecting
  suspended/deleted users and revoked or expired sessions.
- Browser API calls use `credentials: 'include'` and a single-flight refresh on 401. See `apps/web/lib/api.ts`.
- Registration signs the user in immediately; email verification is still
  required before checkout.
- Google sign-in is optional and enabled only when `GOOGLE_CLIENT_ID` is
  configured; the API verifies Google ID tokens against that audience.
  `GOOGLE_CLIENT_SECRET` is accepted in the environment schema but is not used by
  the current ID-token flow.
- Fastify redacts sensitive query parameters, authorization/cookie headers, and
  password/token fields from logs. Do not add logging that bypasses this.
- Helmet, exact-origin CORS, and API/edge rate limits are enabled.
- Payment webhook signatures are verified over the exact raw request body.

Secrets come from Doppler project `examdump-pro`, config `prd`. The rendered
runtime copy is `/etc/examdump-pro/production.env` (mode `0640`,
`root:examdump`). Never commit, print, or copy a secret into documentation,
tests, logs, or chat. Check presence, not value.

The tracked `doppler.yaml` currently points at `agent-keys` / `dev_personal`,
which is **not** the production configuration. Use explicit
`--project examdump-pro --config prd` flags rather than relying on that file.

### Email

Transactional mail is queued in PostgreSQL and drained by the API process. The
worker retries with backoff, enforces per-recipient and hourly send limits,
honours suppression/unsubscribe state, and records delivery attempts in
`mail_logs`. Do not send mail inline from a request handler; use the queue
helpers.

### AI

The AI key is server-side only. `AI_PROVIDER=nvidia` is the production value;
`AI_MODEL` is `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`. The client walks a
small fallback list when a model is retired or unavailable. The explanation
endpoint returns a deterministic offline explanation when every model fails; the
streaming chat endpoint surfaces an error instead of inventing an answer. SSE chat
is served at `/api/ai/chat/...` and nginx disables buffering for that path. AI
quotas are fair-use daily limits, not an entitlement gate.

Progressive hints are generated server-side for the actual question and the
requested level. The client sends the hints already shown so the next level adds
a new clue, and hint responses are marked `no-store` so a cached nudge never
appears on a different question.

---

## Production

### Host layout

```text
/opt/examdump-pro/node                 pinned Node 22 runtime (v22.23.5)
/opt/examdump-pro/api                  API runtime: dist/, migrations/, node_modules/
/opt/examdump-pro/api/dist             index.js, migrate.js, seed.js
/opt/examdump-pro/api/migrations       deployed SQL files
/opt/examdump-pro/web                  Next.js standalone runtime
/opt/examdump-pro/web/apps/web         server.js + .next (static assets)
/etc/examdump-pro/production.env       rendered env file, 0640 root:examdump
/etc/systemd/system/examdump-api.service
/etc/systemd/system/examdump-web.service
/etc/nginx/conf.d/examdump.conf
```

The services run:

```text
examdump-api: /opt/examdump-pro/node/bin/node dist/index.js
              WorkingDirectory=/opt/examdump-pro/api
examdump-web: /opt/examdump-pro/node/bin/node apps/web/server.js
              WorkingDirectory=/opt/examdump-pro/web
              PORT=3000 HOSTNAME=127.0.0.1
```

Systemd hardening includes `NoNewPrivileges`, `PrivateTmp`,
`ProtectSystem=strict`, `ProtectHome`, and a narrow `ReadWritePaths` entry for
the app directory.

### Current production flags (verified 2026-11-18)

| Setting               | Value         | Meaning                                      |
| --------------------- | ------------- | -------------------------------------------- |
| `NODE_ENV`            | `production`  | Production behaviour, secure cookies         |
| `PAYMENTS_ENABLED`    | `true`        | Payment UI/checkout is enabled               |
| `YOUPI_ENABLED`       | `true`        | YouPI-PG checkout may create orders          |
| `PAYMENT_PROVIDER`    | `hyperswitch` | Legacy HyperSwitch label; not checkout-ready |
| `ALLOW_MOCK_PAYMENTS` | `false`       | Mock activation is refused                   |
| `AI_PROVIDER`         | `nvidia`      | NVIDIA NIM                                   |
| `ENABLE_DATASET_SYNC` | `true`        | Daily catalogue sync enabled                 |

Do not infer payment state from `.env.example`; it is a development template and
still shows `PAYMENTS_ENABLED=false`.

Live payment status at the same check:

- `GET /api/payments/methods` → `checkoutReady:false`,
  `gatewayConfigured:false`, `pay.youpi.available:true`.
- YouPI is the only checkout path that can currently take money.
- HyperSwitch reports `adapter_coming_soon`; Razorpay is implemented but not the
  selected adapter.
- No payment configuration may be changed, and no live charge may be created,
  without explicit human authorization.

### Deploying a build (manual, no script)

Build with Node 22. `NEXT_PUBLIC_API_URL` must be empty (or same-origin) for a
production bundle; a loopback value would make every browser call hit the
visitor's own machine (see `apps/web/lib/api-base.ts`).

```bash
cd ~/projects/examdump-pro
git fetch origin && git checkout main && git pull --ff-only

npm ci
NEXT_PUBLIC_API_URL='' npm run build
```

Copy the API output and SQL, preserving a previous copy for rollback:

```bash
sudo install -d -o examdump -g examdump /opt/examdump-pro/api/dist
sudo install -d -o examdump -g examdump /opt/examdump-pro/api/migrations

sudo cp -a /opt/examdump-pro/api/dist \
  "/opt/examdump-pro/api.prev-dist-$(date -u +%Y%m%dT%H%M%SZ)" || true
sudo cp -a apps/api/dist/. /opt/examdump-pro/api/dist/
sudo cp -a apps/api/src/db/migrations/. /opt/examdump-pro/api/migrations/
sudo chown -R examdump:examdump /opt/examdump-pro/api
```

Copy the Next.js standalone output:

```bash
sudo cp -a /opt/examdump-pro/web \
  "/opt/examdump-pro/web.prev-$(date -u +%Y%m%dT%H%M%SZ)" || true
sudo rm -rf /opt/examdump-pro/web.new
sudo cp -a apps/web/.next/standalone /opt/examdump-pro/web.new
sudo cp -a apps/web/.next/static /opt/examdump-pro/web.new/apps/web/.next/static
if [ -d apps/web/public ]; then
  sudo cp -a apps/web/public /opt/examdump-pro/web.new/apps/web/public
fi
sudo rm -rf /opt/examdump-pro/web
sudo mv /opt/examdump-pro/web.new /opt/examdump-pro/web
sudo chown -R examdump:examdump /opt/examdump-pro/web
```

Apply migrations **before** starting the new API build. The production
`examdump` role cannot create tables or write the Drizzle history, so a normal
service-env run fails with `permission denied for database examdump`. Apply the
pending SQL as `postgres` and record the journal row in the same transaction:

```bash
migration=0009_community
hash=$(sha256sum "/opt/examdump-pro/api/migrations/$migration.sql" | cut -d' ' -f1)
when=$(node -p "require('/opt/examdump-pro/api/migrations/meta/_journal.json').entries.find(e => e.tag === '$migration').when")

sudo -u postgres psql -d examdump -v ON_ERROR_STOP=1 -1 <<SQL
\i /opt/examdump-pro/api/migrations/$migration.sql
insert into drizzle.__drizzle_migrations ("hash", "created_at") values ('$hash', $when);
SQL
```

The transaction guarantees a failed statement cannot leave a half-applied
migration. Verify the migration row and the new tables before restarting.

Restart and verify:

```bash
sudo systemctl restart examdump-api
curl -fsS http://127.0.0.1:4000/api/health/ready

sudo systemctl restart examdump-web
curl -fsS -o /dev/null -w '%{http_code}\n' https://examtopicspro.duckdns.org/
```

If a step fails, stop and inspect logs before continuing:

```bash
systemctl status examdump-api examdump-web --no-pager
journalctl -u examdump-api -n 100 --no-pager
journalctl -u examdump-web -n 100 --no-pager
journalctl -u examdump-api -f
```

Rollback is manual: restore the previous `dist`/`web` directory and restart the
unit. Database rollback is **not** automated, no scheduled dump is configured for
this app, and no one should drop, restore, or reset the production database
without explicit authorization.

### Operational guardrails

- Do not restart or modify `postgresql`, `nginx`, or YouPI-PG services unless the
  task explicitly requires it.
- Do not modify `/etc/examdump-pro/production.env` or Doppler values without
  authorization. Never overwrite production configuration from a template.
- Do not create, drop, truncate, or migrate the production database as an
  experiment.
- Do not enable payments, change gateway credentials, or replay a live payment
  without authorization.
- Do not touch `ajayk134/examdump`, `ajayk134/exam-data`, Cloudflare, Netlify, or
  unrelated host services.
- Keep the pinned Node 22 runtime; do not assume the local Node 24 is production.

---

## Known discrepancies and traps

These are real differences between source, templates, and the live host. Fixing
them is a product decision, not an incidental documentation change.

1. **`doppler.yaml` is stale.** It selects `agent-keys` / `dev_personal`.
   Production secrets are in `examdump-pro` / `prd`. The file's own comment says
   to use a dedicated production config.
2. **`.env.example` drifts from code.** It says `AI_PROVIDER=openai` and
   `AI_MODEL=gpt-4o-mini` while `env.ts` defaults to NVIDIA/Nemotron; it sets
   `ALLOW_MOCK_PAYMENTS=true`; its comment still says “NEVER stored in MongoDB”.
3. **Web example port is wrong.** `apps/web/.env.local.example` uses
   `http://localhost:4100`; `npm run dev:web` expects the API on `4000`.
4. **`upi:gmail-oauth` points at a missing file.** The script references
   `src/scripts/upi-gmail-oauth.ts`, which is not present.
5. **UPI migrations are dormant.** `0006`–`0008` create tables and OAuth state
   storage that no current runtime code reads or writes; `0007` is also skipped
   on a fresh database because of its journal timestamp.
6. **`/security` page is inaccurate.** It says application data lives in MongoDB;
   the application uses PostgreSQL only.
7. **CI does not run frontend tests.** CI runs shared, data-client, and API tests
   plus both builds. Run `npm run test -w @examdump/web` locally for UI changes.
8. **Production migration role.** The deployed SQL is in
   `/opt/examdump-pro/api/migrations`, which the runner does not search by
   default, and the `examdump` role cannot create tables or write
   `drizzle.__drizzle_migrations`. Apply pending SQL as `postgres` and record
   the journal row in the same transaction.
9. **Production env retains unused variables.** `MONGODB_URI`, `MONGODB_DB`,
   `UPI_AUTO_APPROVE`, and `MIGRATION_DATABASE_URL` are not read by the current
   `env.ts`/runtime. They are legacy and should not be treated as live config.
   (`YOUPI_*` variables are live.)
10. **No deployment/backup automation is tracked.** The host layout and systemd
    units are the source of truth for deployment; there is no deploy script,
    container path, or scheduled database dump to invoke.

---

## Documentation map

| Need                                   | Read                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Universal agent contract               | [`AGENTS.md`](AGENTS.md)                                                                             |
| Copilot quick-start and repository map | [`.github/copilot-instructions.md`](.github/copilot-instructions.md)                                 |
| Frontend rules                         | [`.github/instructions/frontend.instructions.md`](.github/instructions/frontend.instructions.md)     |
| Backend/API rules                      | [`.github/instructions/backend.instructions.md`](.github/instructions/backend.instructions.md)       |
| Database/migration rules               | [`.github/instructions/database.instructions.md`](.github/instructions/database.instructions.md)     |
| Auth, secrets and webhook security     | [`.github/instructions/security.instructions.md`](.github/instructions/security.instructions.md)     |
| Production deployment and operations   | [`.github/instructions/deployment.instructions.md`](.github/instructions/deployment.instructions.md) |
| Testing and verification               | [`.github/instructions/testing.instructions.md`](.github/instructions/testing.instructions.md)       |
| Payments and settlement invariants     | [`.github/instructions/payments.instructions.md`](.github/instructions/payments.instructions.md)     |
| Repeatable workflows                   | `.github/prompts/`                                                                                   |
| Specialist agents                      | `.github/agents/`                                                                                    |
| CI definition                          | `.github/workflows/ci.yml`                                                                           |

## License

Unlicensed and private. See [`LICENSE`](LICENSE).
