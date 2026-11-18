# Copilot instructions — ExamDump Pro

Read [`AGENTS.md`](../AGENTS.md) first. This file is the concise technical map;
the path-scoped files in `.github/instructions/` carry the detailed rules for the
area you are editing. Do not duplicate rules here.

## Product and architecture

Production certification-exam prep SaaS. Next.js 15 web + Fastify 5 API +
PostgreSQL 16, npm workspaces.

- Exam questions: private GitHub dataset (`ajayk134/exam-data`), fetched
  server-side at request time. Never copy question text into the DB, tests,
  fixtures, logs, docs, or commits.
- Application data: PostgreSQL via Drizzle (`apps/api/src/db/schema/`).
- Production: one host, native systemd (`examdump-api`, `examdump-web`,
  `postgresql`, `nginx`), no Docker, no staging, no backup automation.
- Live topology: nginx `:80/:443` → web `127.0.0.1:3000`, API `127.0.0.1:4000`,
  PostgreSQL `127.0.0.1:5432`. Domain `https://examtopicspro.duckdns.org`.

## Repository map

```text
apps/api/src/
  index.ts            bootstrap, startup checks, cron jobs, graceful shutdown
  app.ts              Fastify setup, middleware, errors, route registration
  config/env.ts       authoritative env schema/defaults
  routes/             HTTP handlers, one file per feature
  services/           business logic and DB writes (entitlement, payments, mail, AI)
  db/schema/          Drizzle tables (identity, learning, catalog, billing, platform, mail)
  db/migrations/      SQL 0000–0008, custom forward-only runner
  lib/                auth guards, JWT, cookies, errors, validation, pagination, tx
  openapi.ts          API document served at /api/openapi.json
apps/web/
  app/                App Router pages (pricing, practice, mock, admin, checkout/return…)
  components/         UI, providers, session runners, workspace panels
  lib/api.ts          cookie fetch, single-flight refresh, SSE client
  lib/api-base.ts     same-origin production API base; ignores loopback in prod
packages/shared/      types, Zod schemas, plan catalogue, content normaliser
packages/data-client/ GitHub dataset client with TTL/LRU cache
```

## Commands

```bash
npm ci
npm run build -w @examdump/shared && npm run build -w @examdump/data-client
npm run dev                 # API :4000 + web :3000
npm run typecheck           # also the "lint" command (no ESLint)
npm run build               # shared → data-client → api → web
npm run test:api            # needs DATABASE_URL_TEST (real PostgreSQL)
npm run test -w @examdump/web
npm run migrate -w @examdump/api
npm run seed
npm run db:generate -w @examdump/api
```

The API does not auto-load `.env`; export variables or use
`doppler run --project examdump-pro --config prd -- npm run dev`.
CI does not run web tests — run them locally for frontend changes.

## Hard rules (details in path files)

1. Entitlement is server-side only (`services/entitlement.service.ts`); slice the
   accessible question set before filters, randomisation, or pagination.
2. Payments settle only from verified server-side evidence. Browser redirects
   never settle. YouPI settles only on `RECONCILED`. Never enable or reconfigure
   live payments without explicit authorization.
3. Secrets come from Doppler; never print, log, commit, or echo them. Do not
   weaken log redaction or webhook raw-body/signature handling.
4. Never modify production infrastructure, restart services, or touch the
   production database as part of a normal code change. Migrations are
   forward-only and are not run at boot.
5. Keep the layering: routes → services → schema. Validate input with Zod, throw
   via `lib/errors.ts`, preserve API contracts. (`routes/attempts.ts` is a known
   existing exception that writes directly.)
6. Add a regression test for fixes and a test for new behaviour. Update docs in
   the same commit when behaviour, env, schema, endpoints, or deployment change.
7. Do not invent endpoints, env vars, deploy scripts, backups, or measurements.

## Path-scoped instructions

| Editing                      | Read                                              |
| ---------------------------- | ------------------------------------------------- |
| `apps/web/**`                | `.github/instructions/frontend.instructions.md`   |
| `apps/api/**` (general)      | `.github/instructions/backend.instructions.md`    |
| `db/schema`, migrations      | `.github/instructions/database.instructions.md`   |
| auth, secrets, webhooks, env | `.github/instructions/security.instructions.md`   |
| CI, build, production paths  | `.github/instructions/deployment.instructions.md` |
| tests and verification       | `.github/instructions/testing.instructions.md`    |
| payment files                | `.github/instructions/payments.instructions.md`   |

## Known traps

- `doppler.yaml` points at `agent-keys/dev_personal`; production is
  `examdump-pro/prd`.
- `.env.example` is stale (AI provider/model, mock payments, MongoDB comment,
  web port 4100 vs API 4000).
- `npm run upi:gmail-oauth -w @examdump/api` targets a missing script.
- UPI tables from migrations `0006`–`0008` are dormant; `0007` is skipped on a
  fresh database. Do not build on them.
- The `/security` page incorrectly says MongoDB; the app uses PostgreSQL.
- Production has payments enabled and YouPI available; do not infer state from
  the development template.
