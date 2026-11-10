# AGENTS.md — instructions for AI coding agents

## What this repository is

ExamDump Pro: a premium exam-preparation SaaS.

- `apps/api` — Fastify + Drizzle ORM API (all application data in PostgreSQL).
- `apps/web` — Next.js 15 frontend.
- `packages/shared` — Zod schemas, types, dataset content parser, plan catalogue.
- `packages/data-client` — GitHub dataset client (server-only).
- `deploy` — Dockerfiles, Compose, nginx, backups.
- `docs` — architecture, API, database, deployment, security, testing.

## Non-negotiable rules

1. **PostgreSQL for ALL application data** (users, sessions, subscriptions,
   payments, attempts, progress, bookmarks, notes, analytics, logs, settings,
   RBAC, admin data). Use the Drizzle schema in `apps/api/src/db/schema`.
2. **GitHub exclusively for exam question datasets.** Never copy questions into
   PostgreSQL, fixtures, docs or committed files.
3. **Doppler for secrets.** Never hardcode, print or commit secrets. `.env*` is
   gitignored except `.env.example`.
4. **Server-side enforcement.** Free accounts get `freeQuestionsPerExam`;
   premium gets everything. Never enforce limits only in the UI. Guard against
   offset, random and direct-ID bypasses.
5. **Do not touch the legacy repositories/services** (`ajayk134/examdump`,
   `ajayk134/exam-data`, Cloudflare, Netlify) unless explicitly asked.

## Commands

```bash
npm install
npm run build -w @examdump/shared
npm run build -w @examdump/data-client
npm run dev                      # api :4000 + web :3000
npm run typecheck

# Start a throwaway PostgreSQL for tests/seeding:
#   podman run -d --name examdump-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16-alpine
npm run migrate -w @examdump/api          # apply Drizzle migrations
npm run seed                              # plans, RBAC, settings, demo data
npm run sync:dataset -w @examdump/api
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" npm test
```

Run API commands under Doppler when available:

```bash
doppler run --project agent-keys --config dev_personal -- npm run dev
```

## Conventions

- TypeScript strict, ESM (`type: module`), `.js` extensions in relative imports
  inside packages/apps.
- Validation via Zod schemas in `packages/shared/src/schemas.ts`.
- Use error helpers in `apps/api/src/lib/errors.ts`.
- Add indexes for new query patterns; add tests for new behaviour.
- Keep the UI accessible (labels, focus states, contrast) and dark/light parity.
- Payment processing stays simulated until a provider is approved. Replace
  `createMockSubscription` only.

## Before committing

```bash
npm run typecheck
MONGODB_URI_TEST="mongodb://127.0.0.1:27017/examdump_test" npm test
npm run build
```

Ensure no secrets or question data are staged (`git diff --cached`).