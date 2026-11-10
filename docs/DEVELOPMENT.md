# Development guide

## Prerequisites

- Node.js ≥ 20.11 (22 recommended)
- npm 10+
- A PostgreSQL database (local, Docker, or Atlas)
- Doppler CLI (recommended) or a local `.env`
- Optional: a read-only GitHub token for the private dataset

## Setup

```bash
npm install
cp .env.example .env                     # fill values (gitignored)
cp apps/web/.env.local.example apps/web/.env.local

npm run build -w @examdump/shared
npm run build -w @examdump/data-client
npm run seed
npm run dev                              # API :4000 + web :3000
```

With Doppler:

```bash
doppler run --project agent-keys --config dev_personal -- npm run seed
doppler run --project agent-keys --config dev_personal -- npm run dev
```

## Workspace commands

| Command | Effect |
| --- | --- |
| `npm run dev` | API + web in parallel (`npm-run-all`) |
| `npm run build` | Build every workspace |
| `npm run typecheck` | `tsc --noEmit` everywhere |
| `npm test` | All tests |
| `npm run seed` | Plans, settings, admin, demo user, catalogue sync |
| `npm run sync:dataset -w @examdump/api` | Re-index GitHub catalogue |
| `npm run format` | Prettier |

## Adding an API feature

1. **Schema** — add the Drizzle ORM model/index in `apps/api/src/db/models/`.
2. **Validation** — add a Zod schema in `packages/shared/src/schemas.ts`.
3. **Service** — put business logic in `apps/api/src/services/` (testable,
   no Fastify imports).
4. **Route** — add the handler in `apps/api/src/routes/`, parse with
   `parseOrThrow`, and call `requireAuth` / `requireVerified` / `requireAdmin`.
5. **Register** — export the route function and wire it in `apps/api/src/app.ts`.
6. **Test** — add an integration test under `apps/api/test/`.
7. **Docs** — update `docs/API.md`.

## Adding a web page

- Static/marketing pages can be server components under `apps/web/app/`.
- Authenticated/interactive pages should be client components that use
  `lib/api.ts` and the contexts in `components/providers.tsx`.
- Reuse `components/ui.tsx` primitives; keep dark/light parity and keyboard
  focus states.

## Dataset branch switching

`DATASET_BRANCH` accepts `main` or `masked_main`.

- `main`: readable provider/exam keys (recommended when the API is the only
  access path).
- `masked_main`: hashed provider directories and `code__hash` exam keys. The
  data client normalises these transparently; the UI still shows the real exam
  code prefix.

Switch and re-sync:

```bash
DATASET_BRANCH=masked_main npm run sync:dataset -w @examdump/api
```

## Conventions

- TypeScript strict; no `any` unless unavoidable and documented.
- Never trust client-computed values for scoring/entitlements.
- All secrets come from `process.env` (Doppler). Never hardcode.
- Keep workers/services free of Fastify types where possible.
- Use the existing error helpers (`badRequest`, `forbidden`, `notFound`,
  `quotaExceeded`, …) for consistent error envelopes.
- Prefer server-side filtering in PostgreSQL over in-memory processing for lists.
- Add indexes for every new query pattern.

## Debugging

- API logs are structured JSON (pino). Set `LOG_LEVEL=debug`.
- `GET /api/health` reports DB connectivity and uptime.
- `POST /api/admin/dataset/sync` (as admin) forces a catalogue refresh.
- To inspect the dataset directly, use the `data-client` in a script with
  `doppler run`.

## Git

- Conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Never commit `.env`, tokens, dumps or question data.
- Run `npm run typecheck && npm test` before pushing.