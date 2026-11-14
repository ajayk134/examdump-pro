# Testing

## Run everything

```bash
npm install
npm run build -w @examdump/shared
npm run build -w @examdump/data-client

# Integration tests need a throwaway PostgreSQL database
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" npm test
```

`npm test` runs:

1. `@examdump/shared` — content parser, answer extraction, client payloads.
2. `@examdump/data-client` — GitHub client, caching, both branch formats.
3. `@examdump/api` — full HTTP integration suite via `app.inject()`.

If `DATABASE_URL_TEST` is unset, the API tests fall back to
`postgres://postgres:postgres@127.0.0.1:5433/examdump_test`. Start one with:

```bash
# native PostgreSQL is already installed; use a scratch database
createdb examdump_test
# postgres://examdump@127.0.0.1:5432/examdump_test \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=examdump_test postgres:16-alpine
```

Each test context drops and recreates the `public`/`drizzle` schemas and replays
the Drizzle migrations, so suites are isolated.

## API test coverage

| File | Covers |
| --- | --- |
| `auth.test.ts` | register, verify, login, duplicate/weak input, refresh rotation, password reset, logout, admin authorization |
| `exams.test.ts` | providers, search, provider detail, free limit, offset/random bypass resistance, locked question 403, premium unlock, assessment hides answers, 404s |
| `attempts.test.ts` | start attempt, locked-question refusal, server-side grading, stats/streak, free mock quota, premium unlimited mocks |
| `subscriptions.test.ts` | INR plans, single-exam requirement, coupon discount + payment, cancel, refund revocation, coupon reuse prevention |
| `admin.test.ts` | stats, user list/update/suspend, settings affecting entitlements immediately, audit log, dataset sync |

The test helper injects a deterministic `DatasetClient` (no network) and seeds a
known catalogue, so tests are fast and hermetic. The dataset is **not** written
to PostgreSQL in any test.

## Content parser tests

`packages/shared/src/content.test.ts` verifies:

- labelled single and multi-answer parsing (`Suggested Answer: AB`),
- option label stripping,
- preservation of `text`, `break` and `image` items,
- vote normalisation and percentages,
- hiding answers in client payloads,
- drag-and-drop detection.

## Data client tests

`packages/data-client/src/dataset.test.ts` verifies:

- provider listing/sorting and slug resolution,
- exam counts,
- numeric question ordering,
- typed errors,
- **masked branch keys** (`200-301__hash`),
- TTL caching.

## Web

The web app is guarded by TypeScript and a production build:

```bash
npm run typecheck -w @examdump/web
NEXT_TELEMETRY_DISABLED=1 npm run build -w @examdump/web
```

## CI

`.github/workflows/ci.yml` runs on every push/PR:

- install, build shared packages, typecheck, unit + integration tests (PostgreSQL 16
  service), production builds of both apps, Docker image builds, and a gitleaks
  secret scan.

## Manual QA checklist

- [ ] Register → verify → login → logout.
- [ ] Free user sees exactly 5 questions; locked banner and upgrade prompt.
- [ ] Attempt question 6 by URL returns 403.
- [ ] Subscribe (mock) → unlimited questions unlock immediately.
- [ ] Coupon applies a discount and appears in payment history.
- [ ] Mock exam grades correctly and updates dashboard/streak.
- [ ] Bookmark/note persist across sessions.
- [ ] Admin: create user, suspend, coupon, settings, dataset sync, audit.
- [ ] Dark/light theme, mobile layout, keyboard navigation.