---
applyTo: "**/*.test.ts,**/*.test.tsx,apps/api/test/**,apps/web/test/**,apps/api/vitest.config.ts,apps/web/vitest.config.ts"
---

# Testing instructions

Tests exist in four places:

| Suite                    | Location                             | Command                                 |
| ------------------------ | ------------------------------------ | --------------------------------------- |
| Shared content/parser    | `packages/shared/src/*.test.ts`      | `npm run test -w @examdump/shared`      |
| Dataset client           | `packages/data-client/src/*.test.ts` | `npm run test -w @examdump/data-client` |
| API integration          | `apps/api/test/*.test.ts`            | `npm run test -w @examdump/api`         |
| Web utilities/components | `apps/web/test/*.test.ts(x)`         | `npm run test -w @examdump/web`         |

Run everything with `npm run test` (shared → data-client → API → web).

## API integration tests

- Require a real PostgreSQL via `DATABASE_URL_TEST`; the helpers create and clean
  the schema. CI supplies an ephemeral `postgres:16-alpine`.
- Never point `DATABASE_URL_TEST`, `DATABASE_URL`, or a test command at the
  production database.
- Tests use synthetic question text. Never copy real exam content into a fixture,
  snapshot, assertion, or log.
- Use the existing helpers in `apps/api/test/helpers.ts` for app setup, auth, and
  database lifecycle.
- Keep tests deterministic: no real time dependence, no external network calls,
  no live AI calls, no live payment calls.
- Payment webhook tests must construct signed payloads locally and use mock
  clients. Never create a real charge, replay a production webhook, or call a
  live gateway.
- Migrations should be applied by the test setup so schema drift is caught.

## Web tests

- `apps/web/test` covers the API base resolver, question session logic, Markdown
  escaping, scroll helpers, and SSR-sensitive exam selection.
- CI does **not** run these tests. Run them locally for changes to `apps/web/lib`
  or session/rendering logic.
- Component tests should assert user-visible behaviour and accessibility
  affordances, not implementation details.

## What every change needs

- **Bug fix:** a regression test that fails before the fix and passes after it.
- **New behaviour:** a test at the layer that owns the behaviour (service/route
  for API, utility/component for web).
- **Schema change:** a migration applied in the test database and a test that
  exercises the new column/constraint.
- **Payment change:** tests for success, duplicate delivery, invalid signature,
  amount/currency mismatch, and non-settlement events where applicable.
- **Auth change:** tests for missing, expired, revoked, suspended, and
  insufficient-permission cases.

## Verification discipline

```bash
npm run typecheck
npm run test:api
npm run test -w @examdump/web
npm run build
```

- Do not claim success from reading code. Run the command.
- If a test cannot run (for example no local PostgreSQL), say exactly what was not
  run and what remains unverified.
- Do not weaken, skip, or delete a test to make a change pass. Fix the cause or
  explain why the expectation was wrong.
- For deployment work, health checks and service status are the verification; a
  passing unit test does not prove the running host changed.
