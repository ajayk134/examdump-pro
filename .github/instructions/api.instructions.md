---
applyTo: "apps/api/**/*.ts"
---
# API rules (apps/api)

- Fastify 5 + Drizzle ORM. All application data goes to PostgreSQL.
- Every route validates input with a Zod schema from
  `packages/shared/src/schemas.ts`. Never trust `request.body`/`params` raw.
- Read configuration only through `apps/api/src/config/env.ts`. Never call
  `process.env.X` directly in a route or service.
- Throw using helpers in `apps/api/src/lib/errors.ts` so responses keep a stable
  shape. Never return a bare string as an error.
- Entitlement checks belong in the service layer, before fetching question
  content. Free users get `FREE_QUESTIONS_PER_EXAM`; premium gets everything.
  Never rely on the client to enforce a limit.
- Exam questions are read from GitHub via `packages/data-client`. Never persist
  question text to PostgreSQL and never inline it in code or tests.
- Money is an integer in paise. Never use floats. Never format currency
  server-side for display.
- UPI: every order must set `base_amount_paise` (a 0–99 paise suffix on top of
  the plan price). Settlement is notification-based — the client can never mark
  its own order paid. Leave `UPI_AUTO_APPROVE=false`.
- Scheduling and queues are Postgres-backed. Do not introduce Redis or an
  external broker.
- Add an index when you add a query pattern. Add a test for every new behaviour
  in `apps/api/test/`.

## Testing

```bash
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" \
  npm test -w @examdump/api
```

Tests need a live PostgreSQL. Use synthetic question text only.
