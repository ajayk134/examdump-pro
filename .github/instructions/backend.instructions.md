---
applyTo: "apps/api/**"
---

# Backend instructions

The API is Fastify 5 + TypeScript (ESM) + Zod + Drizzle ORM. It is the only place
that may enforce entitlement, settle payments, or write application data.

## Layering

```text
routes/      HTTP only: guards, validation, serialisation
services/    business logic and all database writes
db/schema/   table definitions, no queries
lib/         auth, errors, transactions, pagination, tokens
config/      validated environment
```

- Register new route plugins in `apps/api/src/app.ts` under the `/api` prefix.
- Keep response shapes and error codes stable; the web client depends on them.
- `apps/api/src/routes/attempts.ts` currently performs direct database writes.
  That is an existing exception, not a pattern to copy.
- A service must not import from `routes/`.

## Conventions

- TypeScript strict, ESM, `.js` extensions in relative imports even though the
  source is `.ts`.
- Validate every external input with a Zod schema from
  `packages/shared/src/schemas.ts` via `parseOrThrow`.
- Throw with helpers from `apps/api/src/lib/errors.ts` (`badRequest`, `forbidden`,
  `notFound`, `conflict`, `serviceUnavailable`, `AppError`). Never hand-build an
  error response.
- Use `requireAuth`, `requireVerified`, `requireAdmin`, or `requirePermission`
  from `apps/api/src/lib/guards.ts`. Never trust a user id, role, plan, or limit
  from the request body.
- Use `apps/api/src/lib/tx.ts` when a write spans multiple tables.
- Money is integer minor units (paise). Never use floats or decimal strings.
- Use Drizzle query builders or parameterised SQL. Never interpolate user input
  into `sql.unsafe`.
- Preserve raw request bytes for webhook routes. `app.ts` installs the custom JSON
  parser that stores `request.rawBody`; do not bypass it.

## Entitlement and data

- `services/entitlement.service.ts` is the sole authority for access. Slice the
  accessible question set before applying filters, randomisation, offsets, or
  direct question IDs.
- Free users get `FREE_QUESTIONS_PER_EXAM`; paid scopes are `single`, `multi`,
  and `all`. The denormalised `users.plan` column is not authoritative.
- Exam content comes from `services/dataset.service.ts` /
  `packages/data-client`. Never persist question text.
- Write analytics, attempts, and progress only after server-side grading.

## Background work

Scheduled jobs live in `apps/api/src/index.ts` and run inside the API process.
There is no Redis or external broker. Durable queue state belongs in PostgreSQL.
Do not add a worker process or scheduler dependency without an explicit decision.

## API documentation

When adding or changing an endpoint, update `apps/api/src/openapi.ts` and the
route's header comment. Keep `/api/docs` accurate.

## Verification

```bash
npm run typecheck
npm run test -w @examdump/api        # needs DATABASE_URL_TEST
npm run build -w @examdump/api
```

Add a regression test for fixes and a test for new behaviour under
`apps/api/test/`. Never point tests at the production database.
