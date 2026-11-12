# Copilot instructions — ExamDump Pro

Authoritative brief for GitHub Copilot (and consistent with `AGENTS.md` for all
other agents). Read it fully before proposing changes.

**Before modifying code:** read [`AGENTS.md`](../AGENTS.md) and the documentation
for the area you are touching. Start at [`docs/README.md`](../docs/README.md). For
payments or UPI, read [`docs/payments/UPI.md`](../docs/payments/UPI.md) first —
that subsystem's design is not obvious and is easy to break.

---

## 1. What this project is

A production certification exam-preparation SaaS.

- **Exam question content** lives in a **private GitHub repository** and is read
  server-side at request time. It is **never** copied into PostgreSQL, fixtures,
  tests, docs or commits.
- **All application data** (users, sessions, subscriptions, payments, attempts,
  progress, analytics, audit) lives in **PostgreSQL** via Drizzle ORM.
- **Secrets** come from Doppler at runtime. Nothing secret is committed.

## 2. Repository layout

```
apps/api/            Fastify 5 API — routes, services, Drizzle schema, tests
apps/web/            Next.js 15 App Router frontend (React 19, Tailwind)
packages/shared/     Zod schemas, types, content parser, plan catalogue
packages/data-client/  Server-only GitHub dataset client (TTL + LRU cache)
deploy/              Dockerfiles, docker-compose.yml, nginx, backup/restore
docs/                full documentation — start at docs/README.md
.github/             CI workflows, these instructions
```

| Path in `apps/api/src` | Contents |
| --- | --- |
| `routes/` | one file per feature; registered in `app.ts` |
| `services/` | business logic and all writes (`entitlement`, `subscription`, `upi/`, `mail/`, `payments/`) |
| `db/schema/` | Drizzle tables: identity, learning, billing, upi, mail, platform |
| `db/migrations/` | numbered SQL `0000`–`0007` |
| `config/env.ts` | **single source of truth** for every environment variable |
| `lib/` | guards, jwt, tokens, passwords, errors, pagination, tx |

## 3. Non-negotiable rules

1. **PostgreSQL for all application data.** Add tables to `db/schema/`, then
   `npm run db:generate -w @examdump/api`.
2. **Never put question content in the database**, fixtures, tests, seed data,
   markdown or commits. Tests use synthetic text.
3. **Secrets only via Doppler / env.** Never hardcode, print, log or commit a
   secret. Do not echo env or credential files; check presence with
   `printenv NAME >/dev/null && echo set || echo missing`.
4. **Enforce entitlements server-side** in `services/entitlement.service.ts`.
   Free accounts get `FREE_QUESTIONS_PER_EXAM`; premium gets everything. Guard
   against offset, random and direct-ID bypasses. UI checks are cosmetic.
5. **Never say "student".** Use "you", "user", "candidate", "professional" or
   "learner" — in code, docs, UI copy, emails and commit messages.
6. **Payments stay disabled by default:** `PAYMENTS_ENABLED=false`,
   `UPI_AUTO_APPROVE=false`. Never invent a payment success path or fake a
   settlement, and never enable production payments without explicit human
   authorization.
7. **No `dangerouslySetInnerHTML`.** Single audited exception: the server-rendered
   own UPI QR SVG.
8. **No new frontend dependencies** for Markdown or LaTeX rendering.
9. **The AI provider key stays server-side.** The browser never sees it.
10. **Scheduling is Postgres-backed.** Do not add Redis or an external broker.
11. **Do not touch** `ajayk134/examdump`, `ajayk134/exam-data`, Cloudflare or
    Netlify resources unless explicitly instructed.

## 4. Conventions

- TypeScript strict, ESM (`"type": "module"`), `.js` extensions in relative
  imports even though the source is `.ts`.
- Validate all external input with Zod schemas from
  `packages/shared/src/schemas.ts`.
- Throw via helpers in `apps/api/src/lib/errors.ts`; never hand-roll an error
  response.
- Add an index when you add a query pattern; add a test for every behaviour change.
- Accessibility: labelled controls, visible focus, sufficient contrast, dark **and**
  light parity.
- Match existing formatting; Prettier is authoritative.

## 5. Local development and verification

```bash
npm install
npm run build -w @examdump/shared && npm run build -w @examdump/data-client

podman run -d --name examdump-pg \
  -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16-alpine

export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/examdump"
npm run migrate -w @examdump/api
npm run seed
npm run dev                       # api :4000 + web :3000
```

```bash
npm run typecheck
npm run build
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" \
  npm test
```

Do not report a task complete without running the command that proves it.

## 6. Database changes

```bash
# 1. edit apps/api/src/db/schema/*.ts
npm run db:generate -w @examdump/api   # writes a numbered migration
# 2. review the generated SQL
npm run migrate -w @examdump/api
```

Migrations are forward-only. Never edit an applied migration. Adding a `NOT NULL`
column requires a default or an in-migration backfill — otherwise the previous
image breaks (this happened with `0007_upi_amount_suffix.sql`).

The API container runs `node dist/migrate.js` before `node dist/index.js`, so a
restart applies pending migrations.

## 7. UPI and payments — read before touching

Files: `services/upi/*`, `routes/upi.ts`, `routes/upi-ingest.ts`,
`routes/admin-upi.ts`, `db/schema/upi.ts`.

Invariants:

- Every order gets a **unique payable amount**: base price + a random 0–99 paise
  suffix. `upi_orders_active_amount_idx` guarantees uniqueness among active
  orders; collisions are retried.
- `base_amount_paise` is `NOT NULL`. Old code that omits it fails the insert — by
  design.
- Settlement is **notification-based** (parsed bank email/SMS). The client can
  never mark its own order paid. This is **not** bank-verified — see
  [`docs/decisions/ADR-003.md`](../docs/decisions/ADR-003.md).
- `UPI_AUTO_APPROVE=false` routes every match to human review. Keep it false.
- `upi_matches_order_settled_idx` allows one settlement per order; do not remove it.
- Money is integer paise. Never floats.

## 8. Deployment facts

Production is a single host running **rootful** Podman (`sudo podman`).

```bash
cd deploy
doppler run --project examdump-pro --config prd -- \
  podman compose -p examdump-pro up -d --build
sudo podman exec examdump-pro_nginx_1 nginx -s reload
```

- There are **two Podman stores**. `podman ps` being empty says nothing about
  production — check `sudo podman ps`.
- **nginx caches the API IP.** Always reload after recreating the API, or the site
  502s while the API is healthy.
- `POSTGRES_PASSWORD` must be injectable; `sudo` strips exported variables, so use
  `doppler run`.
- `docker-compose.yml` declares network aliases `postgres` and `api`. Removing them
  breaks DNS.

## 9. Documentation must be maintained — mandatory

**Documentation is part of the change, not a follow-up.** Whenever a code change
affects documented behaviour, update the documentation **in the same commit**.

Required actions:

1. **Update** the relevant Markdown when a change affects behaviour,
   architecture, APIs, database schema, environment variables, deployment,
   security or business logic.
2. **Create** new documentation when a genuinely new subsystem or important
   feature is introduced.
3. **Remove or correct** documentation that the change made inaccurate. Stale docs
   are a defect, not neutral.
4. **Keep documentation synchronized with source code.** Never leave a described
   behaviour that no longer exists.
5. **Update `CODEBASE_MAP.md`** and the relevant indexes when project structure
   changes.
6. **Update `docs/CHANGELOG.md`** for meaningful changes.
7. **Include the documentation update in the same commit** as the implementation.
8. **Never invent features, configuration, endpoints or behaviour** to make
   documentation appear complete. If something does not exist, say so — follow the
   style of `KNOWN_ISSUES.md` and `TECH_DEBT.md`.
9. **Never fabricate measurements.** If a benchmark was not run, state that it was
   not run.

Change-to-document mapping:

| Change | Update |
| --- | --- |
| Endpoint or payload | `API.md`, `apps/api/src/openapi.ts` |
| Schema or migration | `DATABASE.md`, `docs/database/SCHEMA.md`, `docs/database/MIGRATIONS.md` |
| Index or constraint | `docs/database/INDEXES.md` |
| Auth, guards, permissions | `AUTH.md`, `docs/security/AUTHORIZATION.md` |
| Payments / UPI | `PAYMENTS.md`, `docs/payments/*.md` |
| Deployment, compose, nginx | `DEPLOYMENT.md`, `docs/deployment/*.md` |
| Environment variable | `docs/ENVIRONMENT.md`, `.env.example`, `deploy/docker-compose.yml` |
| Architecture or lasting decision | `ARCHITECTURE.md` + new ADR in `docs/decisions/` |
| File layout or new subsystem | `CODEBASE_MAP.md`, `docs/architecture/SERVICE_DEPENDENCIES.md` |
| Frontend behaviour | `FRONTEND.md`, `UI_UX.md` |
| Performance-relevant change | `PERFORMANCE.md`, `docs/performance/*.md` |
| Tests | `TESTING.md`, `docs/testing/*.md` |
| Dependency | `DEPENDENCY_MAP.md` |
| Notable change | `docs/CHANGELOG.md` |

Do not modify unrelated files merely to create a diff.

## 10. Before committing

```bash
npm run typecheck && npm run build && npm test
git diff --cached        # no secrets, no question data, no build output
```

Never commit `.env`, `node_modules/`, `.next/`, `dist/`, database dumps, or any
customer data.

**Git identity.** Commits must carry the repository owner's verified GitHub
identity — never an agent's name, never an invented address. Verify with
`git config user.name` / `git config user.email` before committing. Never change
global git configuration, never rewrite history to alter authorship, and never claim
a commit belongs to the owner merely because git accepted the values.

## 11. Commit style

- Imperative mood, sentence case: "Add UPI amount suffix reservation".
- Explain **why** in the body when the change is not self-evident.
- Never mention that an AI wrote the change.
- Wrap markdown near 80 columns to match existing docs.
