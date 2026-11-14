# Integration testing

HTTP routes exercised through Fastify's `inject()` against a **real PostgreSQL**.
No database mocking anywhere in this suite.

## Setup

`apps/api/test/helpers.ts` provides the harness:

| Helper | Purpose |
| --- | --- |
| `createTestContext()` | builds a Fastify app + DB, returns `{ app, cleanup }` |
| `registerVerifiedUser()` | creates a verified user and returns an authenticated context |
| `loginAdmin()` | returns an admin access token |
| `subscribeUser()` | grants an active subscription |
| `extractCookies()` | pulls `Set-Cookie` values from a response |
| `DATASET` | synthetic question fixtures (**never real content**) |

Standard file skeleton:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, registerVerifiedUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = ctx.app;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

it('returns the free-tier slice for a free user', async () => {
  const { accessToken } = await registerVerifiedUser(app);
  const res = await app.inject({
    method: 'GET',
    url: '/api/exams/aws/saa-c03/questions',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().questions.length).toBeLessThanOrEqual(5);
});
```

## Database requirements

```bash
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" \
  npm test -w @examdump/api
```

If unset it defaults to `postgres://postgres:postgres@127.0.0.1:5433/examdump_test`
(`helpers.ts:16`). Start one locally:

```bash
createdb examdump_test \
  -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16-alpine
```

## Why real SQL matters

Several invariants exist **only in the database**, so a mock cannot verify them:

- `upi_orders_active_amount_idx` — the partial unique index that makes UPI amounts
  unique. The retry-on-collision logic is only testable against real constraint
  enforcement.
- `upi_matches_order_settled_idx` — prevents double settlement.
- `NOT NULL` on `base_amount_paise` — the exact failure that reached production.
- Foreign keys and cascades.

These are the bugs most likely to reach production, so they are the ones worth
testing against reality.

## Isolation

`createTestContext()` sets up per-file state and `cleanup()` tears it down. Tests
within a file run in order and may share the context; do not depend on another
file's data.

Use unique identifiers (email, reference) rather than assuming an empty table —
a leftover row from a failed run must not break the next one.

## What to cover for a new endpoint

1. Unauthenticated → 401.
2. Wrong user → 403 or 404 (never another user's data).
3. Free tier limit enforced.
4. Valid input → expected shape.
5. Invalid input → 400 with a `VALIDATION_ERROR` code.
6. Admin-only routes → 403 for a normal user.

That list catches the majority of real regressions in this codebase.

## Related

- [Unit testing](UNIT_TESTING.md)
- [Concurrency testing](CONCURRENCY_TESTING.md)
- [Testing overview](README.md)
