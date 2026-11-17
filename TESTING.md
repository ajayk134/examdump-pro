# Testing

Vitest. API integration tests run against a **real PostgreSQL** — no database
mocking.

> **Detailed:** [docs/testing/](docs/testing/README.md)

## Run

```bash
npm test                       # shared + data-client + api

DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" \
  npm test -w @examdump/api

npm run typecheck
npm run build
```

Start a local database for tests:

```bash
podman run -d --name examdump-pg \
  -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16-alpine
```

CI supplies PostgreSQL 16 automatically (`.github/workflows/ci.yml`).

## Coverage

**307 tests**, 15 API files + 2 package test files + 4 web files.

| Area | Tests | File |
| --- | --- | --- |
| Email centre | 66 + 21 | `email-center.test.ts`, `email-center-api.test.ts` |
| YouPI / UPI | 34 | `youpi-integration.test.ts` |
| Payments | 31 | `payments.test.ts` |
| AI chat | 22 | `ai-chat.test.ts` |
| Mail | 18 | `mail.test.ts` |
| Auth | 12 | `auth.test.ts` |
| Practice targeting | 10 | `practice-targeting.test.ts` |
| Billing | 10 | `billing.test.ts` |
| Secret box | 10 | `secretbox.test.ts` |
| Exams | 9 | `exams.test.ts` |
| Subscriptions | 6 | `subscriptions.test.ts` |
| Admin | 5 | `admin.test.ts` |
| Attempts | 5 | `attempts.test.ts` |
| Refund limit | 5 | `refund-limit.test.ts` |

Packages: 16 parser/schema tests in `@examdump/shared` and 7 in
`@examdump/data-client`. Web: 20 unit tests, including paging/palette mechanics
in `apps/web/test/question-session.test.ts`.

## Principles

- **Real SQL** — partial unique indexes and `NOT NULL` constraints are only
  verifiable against a real database.
- **Synthetic question text only.** Never real dataset content.
- **No real network calls** to GitHub, SMTP, AI or payment gateways.
- **Deterministic** — injectable randomness (`setSuffixRandom`), no sleeps.

## Gaps

- **No browser E2E suite** — see [docs/testing/E2E_TESTING.md](docs/testing/E2E_TESTING.md).
- No load testing — see [LOAD_TESTING.md](LOAD_TESTING.md).
- No dependency CVE scanning in CI.

## Related

- [Testing docs](docs/testing/README.md)
- [Concurrency testing](docs/testing/CONCURRENCY_TESTING.md)
