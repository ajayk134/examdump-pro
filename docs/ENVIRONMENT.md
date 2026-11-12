# Environment reference

Every variable is validated in `apps/api/src/config/env.ts`. That file is the
authority — this page explains intent, not validation rules.

**Never commit real values.** Use Doppler (`examdump-pro` / `prd`) or a gitignored
local `.env`. `.env.example` documents the shape only.

Legend: **R** required · **O** optional · **S** secret

---

## Core

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | O | `development` | `production` disables mock payments and demo seeding |
| `API_PORT` | O | `4000` | |
| `API_HOST` | O | `0.0.0.0` | |
| `WEB_ORIGIN` | R | — | CORS allow-list, e.g. `https://example.com` |
| `PUBLIC_WEB_URL` | R | — | Used in emails and redirects |
| `PUBLIC_API_URL` | R | — | Used in webhooks and links |
| `LOG_LEVEL` | O | `info` | Pino level |
| `RATE_LIMIT_MAX` | O | `300` | Requests per window |
| `RATE_LIMIT_WINDOW` | O | `1 minute` | |

## Database

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | R | — | `postgres://user:pass@host:5432/db` |
| `DATABASE_URL_TEST` | O | localhost:5433 | Integration test database |
| `DATABASE_SSL` | O | `false` | `true` in managed cloud |
| `DATABASE_POOL_MAX` | O | `20` | |
| `DATABASE_APP_NAME` | O | `examdump-api` | Shows in `pg_stat_activity` |

PostgreSQL 16 is the supported version.

## Authentication

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `JWT_ACCESS_SECRET` | R | — | Strongly random, ≥32 chars |
| `JWT_REFRESH_SECRET` | R | — | Different from the access secret |
| `ACCESS_TOKEN_TTL` | O | `15m` | |
| `REFRESH_TOKEN_TTL_DAYS` | O | `30` | |
| `PASSWORD_PEPPER` | R | — | Mixed into password hashes |
| `BCRYPT_ROUNDS` | O | `12` | |
| `COOKIE_DOMAIN` | O | unset | Set for cross-subdomain cookies |
| `COOKIE_SECURE` | O | `true` in prod | Must stay `true` over HTTPS |
| `GOOGLE_CLIENT_ID` | O | — | Enables Google sign-in |
| `GOOGLE_CLIENT_SECRET` | O | — | |

Rotating the JWT secrets invalidates all sessions. That is the intended
emergency action after a leak.

## Exam dataset (GitHub)

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | R | — | Read-only token for the private dataset repo |
| `DATASET_OWNER` | O | `ajayk134` | |
| `DATASET_REPO` | O | `exam-data` | |
| `DATASET_BRANCH` | O | `main` | `masked_main` holds the redacted variant |
| `DATASET_CACHE_TTL_SECONDS` | O | `300` | |
| `DATASET_MAX_QUESTIONS_PER_REQUEST` | O | `100` | Caps payload size |
| `ENABLE_DATASET_SYNC` | O | `true` | Background indexing |
| `DATASET_SYNC_CRON` | O | `0 */6 * * *` | |
| `FREE_QUESTIONS_PER_EXAM` | O | `5` | Server-side free tier |
| `PREMIUM_DAILY_QUESTION_LIMIT` | O | `2000` | |

Question content must never be persisted to PostgreSQL or committed to this
repository. Only metadata and progress are stored locally.

## AI tutor

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `AI_PROVIDER` | O | `openai` | Any OpenAI-compatible provider |
| `AI_API_KEY` | O | — | **Server-side only**; feature hidden when unset |
| `AI_MODEL` | O | `gpt-4o-mini` | Provider-specific id |
| `AI_BASE_URL` | O | provider default | e.g. a NVIDIA NIM endpoint |
| `AI_TIMEOUT_MS` | O | `30000` | |
| `AI_MAX_TOKENS` | O | `1024` | |
| `AI_DAILY_LIMIT_FREE` | O | `0` | Free tier has no AI access |
| `AI_DAILY_LIMIT_PREMIUM` | O | `200` | |
| `AI_WEB_SEARCH` | O | `false` | |

The key must never reach the browser. All AI calls are proxied through the API
with entitlement checks.

## Mail

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `SMTP_HOST` / `SMTP_PORT` | O | — / `587` | Logged to console when unset |
| `SMTP_SECURE` | O | `false` | `true` for implicit TLS (465) |
| `SMTP_USER` / `SMTP_PASS` | O/S | — | App password; never log |
| `MAIL_FROM` | O | `ExamDump Pro <no-reply@examdump.pro>` | Must match a verified sender |
| `MAIL_REPLY_TO` | O | — | |
| `MAIL_PUBLIC_URL` | O | — | Base URL for links in emails |
| `MAIL_ENABLED` | O | `true` | |
| `MAIL_MAX_ATTEMPTS` | O | `3` | |
| `MAIL_RETRY_BASE_MS` | O | `500` | Exponential backoff base |
| `MAIL_RATE_MAX` | O | — | Per-window send cap |
| `MAIL_RATE_WINDOW_MS` | O | — | |
| `MAIL_TIMEOUT_MS` | O | — | |
| `MAIL_TEST_RECIPIENT` | O | — | Redirects all mail in non-production |
| `MAIL_QUEUE_ENABLED` | O | `true` | Postgres-backed queue |
| `MAIL_BATCH_SIZE` | O | `10` | |
| `MAIL_WORKER_INTERVAL_SECONDS` | O | `20` | |
| `MAIL_REMINDER_CRON` | O | — | |
| `MAIL_HOURLY_SEND_LIMIT` | O | — | Provider reputation guard |
| `MAIL_CAMPAIGN_BATCH_SIZE` | O | — | |
| `MAIL_LOCK_LEASE_SECONDS` | O | — | Visibility timeout for leases |

Deliverability guidance: `docs/infrastructure/email-deliverability-audit.md`.

## Payments (hosted provider)

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `PAYMENTS_ENABLED` | O | `false` | **Keep false** unless going live |
| `ALLOW_MOCK_PAYMENTS` | O | `false` | Non-production only |
| `PAYMENT_PROVIDER` | O | — | `hyperswitch` or `razorpay` |
| `PAYMENT_ADAPTER` | O | — | Explicit adapter override |
| `PAYMENT_METHODS` | O | — | Comma-separated allow-list |
| `PAYMENT_WEBHOOK_URL` | O | — | Public URL the provider calls |
| `PAYMENT_RECONCILE_CRON` | O | — | |
| `PAYMENT_HTTP_TIMEOUT_MS` | O | `20000` | |
| `PAYMENT_WEBHOOK_TOLERANCE_SECONDS` | O | — | Replay window |
| `PAYMENT_MIN_AMOUNT_MINOR` / `PAYMENT_MAX_AMOUNT_MINOR` | O | — | Minor units (paise) |
| `PAYMENT_MAX_REFUNDS` | O | `5` | Max partial refunds per payment; enforced atomically in the refund path |
| `DEFAULT_CURRENCY` | O | `INR` | |
| `HYPERSWITCH_BASE_URL` | O | — | |
| `HYPERSWITCH_API_KEY` | O/S | — | |
| `HYPERSWITCH_ADMIN_API_KEY` | O/S | — | |
| `HYPERSWITCH_MERCHANT_ID` | O | — | |
| `HYPERSWITCH_PROFILE_ID` | O | — | |
| `HYPERSWITCH_WEBHOOK_SECRET` | O/S | — | HMAC verification |
| `HYPERSWITCH_API_VERSION` | O | — | |
| `HYPERSWITCH_CONNECTORS` | O | — | |
| `RAZORPAY_KEY_ID` | O | — | |
| `RAZORPAY_KEY_SECRET` | O/S | — | |
| `RAZORPAY_WEBHOOK_SECRET` | O/S | — | |

## UPI

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `UPI_PAYEE_VPA` | O | — | Without this, UPI checkout cannot work |
| `UPI_PAYEE_NAME` | O | `ExamDump` | Shown in the UPI app |
| `UPI_ORDER_TTL_MINUTES` | O | `15` | Reservation lifetime |
| `UPI_AUTO_APPROVE` | O | `false` | **Keep false**: human review |
| `UPI_NOTIFICATION_MAX_PAISE` | O | — | Ignore larger alerts as noise |
| `UPI_GMAIL_POLL_SECONDS` | O | — | |
| `UPI_GMAIL_USER` | O | — | Mailbox receiving bank alerts |
| `UPI_GMAIL_LABEL` | O | — | Only parse this label |
| `UPI_GMAIL_QUERY` | O | `in:anywhere` | Gmail search filter. `is:unread` is unsafe here: the observer never marks mail read, so it selects the whole mailbox oldest-first and drops new payments |
| `UPI_GOOGLE_CLIENT_ID` | O | — | OAuth for the observer mailbox |
| `UPI_GOOGLE_CLIENT_SECRET` | O/S | — | |
| `UPI_GOOGLE_REFRESH_TOKEN` | O/S | — | Long-lived; rotate if leaked |
| `UPI_SMS_INGEST_SECRET` | O/S | — | Shared secret for forwarded SMS |

Alert-parsing credentials grant read access to a mailbox. Treat them as highly
sensitive and scope them to the narrowest possible mailbox/label.

## Admin seeding

| Variable | Req | Default | Notes |
| --- | --- | --- | --- |
| `ADMIN_EMAIL` | O | — | Used only by `npm run seed` |
| `ADMIN_PASSWORD` | O/S | — | Change immediately after first login |

---

## Profiles

**Local development** — needs `DATABASE_URL`, the two JWT secrets,
`PASSWORD_PEPPER`. Everything else optional. Leave payments off.

**CI** — `DATABASE_URL_TEST` only; no real secrets required.

**Production** — everything marked **R** plus `SMTP_*`, `AI_*`, and the payment
or UPI block for whichever flow is enabled.

## Secret hygiene

- Never `cat` or `printenv` a whole env file into a terminal or issue tracker.
- To confirm a variable is set, check its presence, not its value:
  `printenv NAME >/dev/null && echo set || echo missing`.
- Rotate immediately if a secret is written to logs, a commit or a screenshot.
