# Testing overview

Vitest throughout. API integration tests use a **real PostgreSQL** — there is no
database mocking.

## Running

```bash
# everything
npm test

# API only (needs a database)
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" \
  npm test -w @examdump/api

# watch
npm run test:watch -w @examdump/api
```

CI provides PostgreSQL 16 on `127.0.0.1:5432` and sets `DATABASE_URL` and
`DATABASE_URL_TEST` to it. See `.github/workflows/ci.yml`.

## Suite composition

| File | Tests | Focus |
| --- | --- | --- |
| `upi.test.ts` | 60 | amount suffixing, collision retry, matching, risk, refunds |
| `email-center.test.ts` | 66 | queue, templates, campaigns, suppression, preferences |
| `payments.test.ts` | 26 | checkout, webhook verification, idempotency, reconciliation |
| `upi-api.test.ts` | 23 | UPI HTTP surface and admin review |
| `email-center-api.test.ts` | 21 | mail API routes |
| `ai-chat.test.ts` | 19 | AI tutor flows and quota |
| `mail.test.ts` | 18 | transport, retries, rendering |
| `auth.test.ts` | 12 | register, login, refresh, verification, reset |
| `billing.test.ts` | 10 | plans, coupons, invoices |
| `exams.test.ts` | 9 | catalogue, question slicing, entitlements |
| `subscriptions.test.ts` | 6 | activation, expiry |
| `admin.test.ts` | 5 | admin guards and audit |
| `attempts.test.ts` | 5 | submission and grading |

Plus `packages/shared` (content parser) and `packages/data-client` (dataset
client, masked branch keys).

Total: **280 tests** across 13 API files and 2 package test files.

## Principles

1. **Real database.** Tests exercise actual SQL, indexes and constraints —
   including the partial unique indexes that enforce UPI invariants. A mocked
   database cannot catch a missing `NOT NULL`.
2. **No real question content.** Fixtures use synthetic text. Committing dataset
   content would be a licensing and security violation.
3. **No real network calls.** External providers (GitHub, SMTP, AI, payment
   gateways) are stubbed or pointed at fakes.
4. **Deterministic.** Time-sensitive logic is injected (`setSuffixRandom()`) so
   randomness can be pinned.
5. **Isolated.** Each file sets up and tears down its own data.

## Test organisation

| Kind | Location | Where documented |
| --- | --- | --- |
| Unit (pure logic) | `packages/*/src/*.test.ts` | [Unit testing](UNIT_TESTING.md) |
| Integration (HTTP + DB) | `apps/api/test/` | [Integration testing](INTEGRATION_TESTING.md) |
| Concurrency | within `upi.test.ts`, `payments.test.ts` | [Concurrency testing](CONCURRENCY_TESTING.md) |
| End-to-end (browser) | **none exist** | [E2E testing](E2E_TESTING.md) |

## Before pushing

```bash
npm run typecheck
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" npm test
npm run build
```

`typecheck` and `build` are not optional — `next.config.mjs` fails the build on
type errors.

## Related

- [Unit](UNIT_TESTING.md)
- [Integration](INTEGRATION_TESTING.md)
- [E2E](E2E_TESTING.md)
- [Concurrency](CONCURRENCY_TESTING.md)
- [TESTING.md](../../TESTING.md)
