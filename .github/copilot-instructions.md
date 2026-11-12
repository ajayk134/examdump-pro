# Copilot instructions — ExamDump Pro

This file is the authoritative brief for any AI coding agent (GitHub Copilot,
Claude, Codex, Cursor, aider). Read it fully before making changes. If an
instruction here conflicts with a comment in the code, this file wins — but
verify against the actual source before assuming either is current.

---

## 1. What this project is

A production-grade certification exam-preparation SaaS.

- **Exam question content** lives in a **private GitHub repository** and is read
  server-side at request time. It is **never** copied into PostgreSQL, fixtures,
  test files, docs or commits.
- **All application data** (users, sessions, subscriptions, payments, attempts,
  progress, bookmarks, notes, analytics, logs, settings, RBAC) lives in
  **PostgreSQL** via Drizzle ORM.
- **Secrets** come from Doppler at runtime. Nothing secret is ever committed.

## 2. Repository layout

```
apps/
  api/          Fastify 5 API — routes, services, Drizzle schema, migrations, tests
  web/          Next.js 15 App Router frontend (React 19, Tailwind)
packages/
  shared/       Zod schemas, shared types, plan catalogue, dataset content parser
  data-client/  Server-only GitHub dataset client
deploy/         Dockerfiles, docker-compose.yml, nginx config, backup/restore
docs/           Architecture, API, database, deployment, security, testing
.github/        CI workflows and this file
```

Key paths inside `apps/api/src`:

| Path | Contents |
| --- | --- |
| `routes/` | One file per feature area (auth, exams, payments, upi, admin-*, …) |
| `services/` | Business logic: entitlement, subscription, dataset, ai, mail/, upi/, payments/ |
| `db/schema/` | Drizzle tables — billing, catalog, enums, identity, learning, mail, platform, upi |
| `db/migrations/` | Numbered SQL migrations `0000`–`0007` |
| `config/env.ts` | **Single source of truth** for every environment variable |

## 3. Non-negotiable rules

1. **PostgreSQL for all application data.** Add tables to
   `apps/api/src/db/schema/`, generate a migration, never hand-edit applied SQL.
2. **Never move question content into the database.** No question text in
   fixtures, tests, seed data, markdown or commits. Tests use synthetic text.
3. **Secrets only via Doppler / env.** Never hardcode, print, log or commit a
   secret. `.env*` is gitignored except `.env.example`. Do not echo the contents
   of env or credential files; grep for a specific name instead.
4. **Enforce entitlements server-side.** Free accounts get
   `FREE_QUESTIONS_PER_EXAM`; premium gets everything. UI-only checks are bugs.
   Guard against offset, random and direct-ID bypasses.
5. **Never say "student".** The product serves candidates/professionals. Use
   "you", "the user", "candidate", "professional" or "learner" — never "student"
   in UI copy, docs, comments, emails or commit messages.
6. **Payments stay disabled by default.** `PAYMENTS_ENABLED=false` and
   `UPI_AUTO_APPROVE=false` unless a human explicitly asks to enable them.
   Never invent a payment success path, never fake a settlement.
7. **No `dangerouslySetInnerHTML`.** The single allowed exception is the
   server-rendered own UPI QR SVG. Everything else renders through React.
8. **No new frontend dependencies** for Markdown or LaTeX rendering.
9. **The NVIDIA/AI API key stays server-side.** The browser never sees it.
10. **Do not touch** `ajayk134/examdump`, `ajayk134/exam-data`, Cloudflare or
    Netlify resources unless explicitly instructed.
11. **Scheduling is Postgres-backed.** Do not add Redis or a new queue broker.

## 4. Conventions

- TypeScript strict mode, ESM (`"type": "module"`). Relative imports inside
  packages/apps **must** end in `.js` even though the source is `.ts`.
- Validate all external input with Zod schemas from
  `packages/shared/src/schemas.ts`.
- Throw through helpers in `apps/api/src/lib/errors.ts`; never hand-roll error
  response shapes.
- Add a database index when you add a new query pattern.
- Add or update a test for every behaviour change.
- Accessibility matters: labelled controls, visible focus, sufficient contrast,
  dark **and** light parity.
- Match existing formatting; Prettier config is authoritative.

## 5. Local development

```bash
npm install
npm run build -w @examdump/shared
npm run build -w @examdump/data-client

# throwaway database on port 5433
podman run -d --name examdump-pg \
  -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16-alpine

export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/examdump"
npm run migrate -w @examdump/api     # drizzle migrations
npm run seed                          # plans, RBAC, settings, demo data

npm run dev                           # api :4000 + web :3000
```

Run with secrets injected when available:

```bash
doppler run --project examdump-pro --config prd -- npm run dev
```

## 6. Verification before you claim something works

```bash
npm run typecheck
npm run build
npm test            # shared + data-client + api (280 tests)
```

Integration tests need a real Postgres:

```bash
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" \
  npm test -w @examdump/api
```

Do not report a task as complete without running the command that proves it.
"Should work" is not verification.

## 7. Database changes

```bash
# 1. edit apps/api/src/db/schema/*.ts
npm run db:generate -w @examdump/api      # writes a numbered migration
# 2. review the generated SQL
npm run migrate -w @examdump/api          # apply
```

Migrations must be forward-only and idempotent where practical. When adding a
`NOT NULL` column, either provide a default or backfill in the same migration —
otherwise existing rows break.

The API container runs `node dist/migrate.js` before `node dist/index.js`, so a
restart applies pending migrations automatically.

## 8. UPI payment system — read before touching

Files: `apps/api/src/services/upi/*`, `routes/upi.ts`, `routes/upi-ingest.ts`,
`routes/admin-upi.ts`, `db/schema/upi.ts`.

Critical invariants:

- Every payment attempt gets a **unique payable amount**: base price plus a
  random 0–99 paise suffix. A partial unique index
  `upi_orders_active_amount_idx` guarantees no two active orders share an amount.
  Collisions are retried, never ignored.
- `base_amount_paise` is `NOT NULL` for every new order. Old code that omits it
  will fail the insert — this is intentional.
- Settlement is **notification-based** (bank email/SMS parsing), never client
  confirmation. The client cannot mark its own order paid.
- `UPI_AUTO_APPROVE=false` routes every match to the **admin review queue**
  instead of auto-settling. Keep it false unless explicitly told otherwise.
- Amounts are integers in paise. Never use floats for money.
- Reconciliation and refunds must agree with the same amount that was quoted.

## 9. Deployment (single host, rootful Podman)

```bash
cd deploy
doppler run --project examdump-pro --config prd -- \
  podman compose -p examdump-pro up -d --build
```

Notes learned from real incidents:

- **Two Podman stores exist on the host** — rootless (`podman`) and rootful
  (`sudo podman`). Production runs **rootful**. Check `sudo podman ps` first;
  the rootless store may contain a dead duplicate.
- `POSTGRES_PASSWORD` must be present or compose aborts. Use
  `doppler run`, not a shell `export` (sudo drops exported vars).
- `docker-compose.yml` declares network aliases `postgres` and `api`. Without
  them, `DATABASE_URL` and nginx's upstream fail to resolve.
- **nginx caches the API's IP at startup.** After recreating the API container,
  run `podman exec examdump-pro_nginx_1 nginx -s reload` or the site returns 502
  until it is reloaded.

## 10. What to check before committing

```bash
npm run typecheck && npm run build && npm test
git diff --cached        # no secrets, no question data, no build output
```

Never commit `.env`, `node_modules/`, `.next/`, `dist/`, database dumps or
anything under `docs/` containing real customer data.

## 11. Style for commits and prose

- Imperative mood, sentence case: "Add UPI amount suffix reservation".
- Explain **why** in the body when the change is not obvious.
- Never mention that an AI wrote the change.
- Keep markdown wrapped near 80 columns to match existing docs.
