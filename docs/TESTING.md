# Testing

## Run everything

```bash
npm install
npm run build -w @examdump/shared
npm run build -w @examdump/data-client

# Integration tests need a throwaway MongoDB database
MONGODB_URI_TEST="mongodb://127.0.0.1:27017/examdump_test" npm test
```

`npm test` runs:

1. `@examdump/shared` — content parser, answer extraction, client payloads.
2. `@examdump/data-client` — GitHub client, caching, both branch formats.
3. `@examdump/api` — full HTTP integration suite via `app.inject()`.

If `MONGODB_URI_TEST` is unset, the API tests fall back to
`mongodb-memory-server` (downloads a MongoDB binary on first use).

## API test coverage

| File | Covers |
| --- | --- |
| `auth.test.ts` | register, verify, login, duplicate/weak input, refresh rotation, password reset, logout, admin authorization |
| `exams.test.ts` | providers, search, provider detail, free limit, offset/random bypass resistance, locked question 403, premium unlock, assessment hides answers, 404s |
| `attempts.test.ts` | start attempt, locked-question refusal, server-side grading, stats/streak, free mock quota, premium unlimited mocks |
| `subscriptions.test.ts` | plans, coupon validation, coupon discount + payment, cancel, coupon reuse prevention |
| `admin.test.ts` | stats, user list/update/suspend, settings affecting entitlements immediately, audit log, dataset sync |

The test helper injects a deterministic `DatasetClient` (no network) and seeds a
known catalogue, so tests are fast and hermetic. The dataset is **not** written
to MongoDB in any test.

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

- install, build shared packages, typecheck, unit + integration tests (MongoDB 7
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