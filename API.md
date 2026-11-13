# API reference

Fastify 5, JSON over HTTPS, base path `/api`.

> **Live specification:** `GET /api/docs` returns an OpenAPI 3.0.3 document
> (`apps/api/src/openapi.ts`). That file is the authoritative list of documented
> endpoints — 41 paths — and is more reliable than any hand-written list.

## Conventions

**Base URL.** `/api` (same origin through nginx).

**Auth.** `Authorization: Bearer <accessToken>` on authenticated routes. The
refresh token travels in an `HttpOnly` cookie and is never in a response body.

**Errors.** Every failure has the same envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "The submitted data is invalid.",
             "details": [{ "path": "email", "message": "Invalid email" }] } }
```

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Zod validation failed; `details` says where |
| 401 | `UNAUTHORIZED` | missing, expired or invalid access token |
| 403 | `FORBIDDEN` | authenticated but not permitted |
| 404 | `NOT_FOUND` | unknown resource, or not visible to this user |
| 409 | `CONFLICT` | state conflict (duplicate, already settled) |
| 429 | `RATE_LIMITED` | rate limit exceeded |
| 500 | `INTERNAL_ERROR` | unhandled; details are only in logs |
| 502 | `DATASET_ERROR` | upstream dataset unavailable |

404 rather than 403 is used for another user's resource, to avoid confirming it
exists.

**Pagination.** `?page=1&pageSize=20`, clamped by `lib/pagination.ts`. Responses
carry `{ items, total, page, pageSize }`.

**Money.** Always integer paise. Never a decimal string.

## Endpoint groups

Route files are in `apps/api/src/routes/`. Registration order and prefixes are in
`app.ts`.

### Health — `health.ts`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | `{status, database, uptimeSeconds}` |
| GET | `/api/health/live` | liveness |
| GET | `/api/health/ready` | readiness incl. database |
| GET | `/api/health/stats` | counters |

### Auth — `auth.ts`

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` | creates user, sends verification |
| POST | `/api/auth/login` | returns access token, sets refresh cookie |
| POST | `/api/auth/refresh` | rotates refresh token |
| POST | `/api/auth/logout` | revokes session |
| GET | `/api/auth/verify-email` | consumes a single-use token |
| POST | `/api/auth/forgot-password` | always returns success (no enumeration) |
| POST | `/api/auth/reset-password` | revokes all sessions |
| POST | `/api/auth/google` | OIDC sign-in |

### Users — `users.ts`

`GET/PATCH /api/users/me`, `DELETE /api/users/me`, `GET /api/users/me/export`,
`GET/DELETE /api/users/sessions/:id`.

### Exams — `exams.ts`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/exams/providers` | provider list |
| GET | `/api/exams/:providerId` | exams for a provider |
| GET | `/api/exams/:providerId/:examKey` | metadata + entitlement |
| GET | `/api/exams/:providerId/:examKey/questions` | free-tier sliced |
| GET | `/api/exams/:providerId/:examKey/questions/:questionId` | single question |
| GET | `/api/exams/random` | random subset |
| GET | `/api/exams/search` | `q`, `provider`, `sort` |

Question responses omit `answer` and `explanation` when the mode is an assessment
(`toClientQuestion(q, includeAnswer)`).

### Attempts — `attempts.ts`

`POST /api/attempts`, `POST /api/attempts/:id/submit`, `GET /api/attempts/history`.
Grading is server-side against the dataset.

### Study data

`bookmarks.ts`, `notes.ts`, `analytics.ts` (`/dashboard`, `/progress`,
`/weak-topics`, `/recommendations`), `leaderboard.ts`, `notifications.ts`.

### AI — `ai.ts`

`POST /api/ai/explain`, chat endpoints under `/api/ai/chat/*`. Premium only,
quota via `AI_DAILY_LIMIT_PREMIUM`. The provider key never leaves the server.

### Subscriptions and coupons — `subscriptions.ts`, `coupons.ts`, `referrals.ts`

`GET /api/subscriptions/plans`, `/api/subscriptions/entitlement/me`,
`/api/subscriptions/history`, `POST /api/subscriptions/cancel`,
`POST /api/subscriptions/redeem-coupon`.

### Payments — `payments.ts`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/payments/methods` | availability (reflects `PAYMENTS_ENABLED`) |
| POST | `/api/payments/checkout` | 503 when payments disabled |
| GET | `/api/payments/invoices`, `/invoices/:id` | history |
| GET | `/api/payments/pay/:id/status` | provider status |
| GET | `/api/payments/pay/:id/refundable` | remaining refundable amount |
| POST | `/api/payments/webhook/hyperswitch` | HMAC verified |
| POST | `/api/payments/webhook/razorpay` | HMAC verified |

Webhook routes accept no authentication header — they authenticate by signature
over the raw body.

### UPI — `upi.ts`, `upi-ingest.ts`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/upi/status` | `{available, autoApprove, payeeName, orderTtlMinutes, verification}` |
| POST | `/api/upi/orders` | creates an order with a unique amount |
| GET | `/api/upi/orders/active` | the caller's live order |
| GET | `/api/upi/orders/:id` | poll one order (the checkout does this) |
| POST | `/api/upi/orders/:id/cancel` | cancel |
| POST | `/api/upi/ingest/sms` | shared-secret alert ingest (`UPI_SMS_INGEST_SECRET`) |
| POST | `/api/upi/ingest/notification` | generic relay ingest, same authentication |

`GET /api/upi/orders/:id` returns a **customer-facing** `status`, not the database
enum, because the checkout renders it directly and must not need to know the
schema:

| `status` | Meaning |
| --- | --- |
| `pending` | QR is live; nothing has arrived |
| `processing` | a credit for this exact amount was seen and is being verified |
| `paid` | settled; the plan is already active |
| `expired` | the payment window closed |
| `cancelled` | the payer abandoned the order |

The response also carries `review: {observedAt, amountPaise} | null` while a credit
is being verified, and `verification: 'automatic_match' | 'reviewed_match'` so the
page states which confirmation the payer will actually get. The bank reference,
risk score and reviewer notes are never included.

The ingest routes authenticate by HMAC-SHA256 over the **raw** request body, bound
to the `X-UPI-Timestamp` header. A request whose exact bytes were not captured is
refused; the signature is never computed over re-serialised JSON. No endpoint
accepts a "mark this order paid" instruction.

### Admin — `admin.ts`, `admin-ops.ts`, `admin-email.ts`, `admin-upi.ts`,
`admin-upi-config.ts`

Mounted under `/api/admin` and `/api/admin-ops`. Guarded by `requireAdmin` or
`requirePermission(...)`. Full inventory: `GET /api/docs`.

#### UPI gateway configuration — `admin-upi-config.ts`

Mounted under `/api/admin-ops`.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/admin-ops/upi/config` | `payments.read` |
| PATCH | `/api/admin-ops/upi/config` | `payments.manage` |
| PATCH | `/api/admin-ops/upi/config/switches` | `payments.manage` |
| POST | `/api/admin-ops/upi/config/payee/validate` | `payments.manage` |
| POST | `/api/admin-ops/upi/config/gmail/start` | `payments.manage` |
| GET | `/api/admin-ops/upi/config/gmail/callback` | `state` token (see below) |
| POST | `/api/admin-ops/upi/config/gmail/test` | `payments.manage` |
| DELETE | `/api/admin-ops/upi/config/gmail` | `payments.manage` |

`GET /upi/config` returns the payee, the three switches, Gmail connection state
and, per setting, which source is in effect (`db`, `env` or `unset`).
**No response on these routes contains a credential.** Presence is reported as
`gmail.hasClientSecret` / `gmail.hasRefreshToken` booleans.

`PATCH /upi/config/switches` accepts `paymentsEnabled`, `gmailEnabled` and
`autoApprove`. Setting `autoApprove: true` additionally requires
`confirm: "CONFIRM"`, and is refused unless the Gmail observer is connected.
Enabling `paymentsEnabled` is refused while no valid payee VPA is configured.

`gmail/callback` is the Google OAuth redirect target, so it cannot require an
admin session. Its security is the `state` parameter: 32 random bytes issued to
the admin who started the flow, single-use (redeemed by `DELETE ... RETURNING`)
and valid for ten minutes. It always redirects to the dashboard with a
`?gmail=connected|denied|bad_state|failed` outcome rather than rendering JSON.

### Mail — `email-preferences.ts`, `admin-email.ts`

`GET/POST /api/email/preferences`, `GET /api/email/preferences/link`,
admin campaign and template management under `/api/admin-ops/email/*`.

## Rate limiting

`@fastify/rate-limit`, `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW`. Exceeding it
returns 429 `RATE_LIMITED`. The default store is in-memory, so limits are per
process.

## Versioning

No version prefix. Breaking changes require a coordinated frontend deploy; there
is no compatibility shim.

## Related

- [Authentication](docs/security/AUTHENTICATION.md)
- [Authorization](docs/security/AUTHORIZATION.md)
- [Data flow](docs/architecture/DATA_FLOW.md)
- [Payment lifecycle](docs/payments/PAYMENT_LIFECYCLE.md)
