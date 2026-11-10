# API reference

Base URL: `/api` (the same origin in production; `http://localhost:4000/api` in
local dev). Interactive reference: `/api/docs`, machine-readable spec:
`/api/openapi.json`.

## Conventions

- JSON in, JSON out. Send `Content-Type: application/json` for bodies.
- Authentication uses HttpOnly cookies (`ed_access`, `ed_refresh`) set by the
  API, or `Authorization: Bearer <accessToken>` for API clients. All browser
  requests use `credentials: 'include'`.
- Success responses are plain JSON objects. Errors look like:

```json
{ "error": { "code": "QUOTA_EXCEEDED", "message": "…", "details": {} } }
```

- Common status codes: `400` validation, `401` unauthenticated, `403`
  forbidden/quota, `404` not found, `409` conflict, `429` rate limited,
  `500` unexpected, `502` upstream dataset failure, `503` unavailable.

## Health

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Service status, uptime, DB state |
| GET | `/health/live` | Liveness |
| GET | `/health/ready` | Readiness (503 if DB down) |
| GET | `/health/stats` | Catalogue counts (providers/exams/questions) |

## Auth

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | – | Create account; returns `devVerificationUrl` when SMTP is not configured and `NODE_ENV !== production` |
| POST | `/auth/login` | – | Sign in; sets cookies and returns `{ user, accessToken }` |
| POST | `/auth/google` | – | Sign in with a Google ID token (`{ idToken }`) |
| POST | `/auth/refresh` | refresh cookie | Rotates the refresh token |
| POST | `/auth/logout` | refresh cookie | Revokes the session and clears cookies |
| GET | `/auth/me` | access | Current user |
| POST | `/auth/verify-email` | – | `{ token }` |
| POST | `/auth/resend-verification` | – | `{ email }` |
| POST | `/auth/forgot-password` | – | `{ email }` (always generic) |
| POST | `/auth/reset-password` | – | `{ token, password }` |
| POST | `/auth/change-password` | access | `{ currentPassword, newPassword }` |
| GET | `/auth/sessions` | access | List active sessions |
| DELETE | `/auth/sessions/:id` | access | Revoke a session |
| POST | `/auth/logout-all` | access | Revoke every session |

Registration body:

```json
{ "name": "Alex", "email": "alex@example.com", "password": "Str0ngPass", "acceptTerms": true, "referralCode": "OPTIONAL" }
```

## Users

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/users/me` | access | Profile |
| PATCH | `/users/me` | access | Update name/bio/avatar/timezone |
| PATCH | `/users/me/preferences` | access | Theme + notification preferences |
| GET | `/users/me/export` | access | Full personal data export (JSON) |
| DELETE | `/users/me` | access | Soft-delete account and log out |

## Exams

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/exams/providers` | – | Providers (catalogue, live fallback) |
| GET | `/exams/search?q=&provider=&sort=&page=&pageSize=` | – | Search exams |
| GET | `/exams/random` | – | Random recommended exams |
| GET | `/exams/:providerId` | – | Provider detail + exam list |
| GET | `/exams/:providerId/:examKey` | optional | Exam metadata + entitlement summary |
| GET | `/exams/:providerId/:examKey/questions` | optional | Questions with server-enforced limits |
| GET | `/exams/:providerId/:examKey/questions/:questionId` | optional | Single question (403 if locked) |
| GET | `/exams/entitlement/me` | access | Current user's entitlements |

Question query parameters: `mode` (`practice|reading|mock|timed|random`),
`limit`, `offset`, `random`, `seed`, `includeAnswer`.

Response shape:

```json
{
  "provider": { "id": "cisco", "title": "Cisco", "slug": "cisco" },
  "exam": { "key": "200-301", "code": "200-301", "questionCount": 1375 },
  "questions": [ { "id": "Question #: 1", "type": "single", "stem": [], "choices": [], "answer": "B" } ],
  "entitlement": {
    "plan": "free", "totalQuestions": 1375, "accessibleQuestions": 5,
    "returned": 5, "lockedQuestions": 1370, "isLimited": true, "offset": 0, "limit": 5
  }
}
```

> Free accounts always receive only the first `freeQuestionsPerExam` questions.
> `offset` and `random` are ignored for free accounts so limits cannot be
> bypassed. Assessment modes (`mock`, `timed`) never include answers.

## Attempts

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/attempts` | access | Start an attempt |
| GET | `/attempts` | access | List attempts (paginated, filter by exam/status) |
| GET | `/attempts/:id` | access | Attempt detail |
| POST | `/attempts/:id/complete` | access | Submit answers; server grades |
| POST | `/attempts/:id/abandon` | access | Abandon in-progress attempt |

Start body:

```json
{ "provider": "cisco", "exam": "200-301", "mode": "mock", "timeLimitSeconds": 3600 }
```

Complete body:

```json
{ "answers": [ { "questionId": "Question #: 1", "selected": ["B"], "timeSpentMs": 4200 } ], "timeSpentMs": 90000 }
```

## Analytics

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/analytics/dashboard` | access | Stats, recent attempts, progress, weak topics, series, recommendations |
| GET | `/analytics/weak-topics?limit=` | access | Weakest topics by accuracy |
| GET | `/analytics/performance?days=` | access | Daily accuracy series |
| GET | `/analytics/progress` | access | Per-exam progress + stats |
| GET | `/analytics/recommendations` | access | Personalised exam suggestions |

## Bookmarks & notes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/bookmarks?page=&pageSize=&examKey=` | access | List bookmarks |
| POST | `/bookmarks` | access | Add `{ provider, exam, questionId }` |
| GET | `/bookmarks/status?examKey=&questionId=` | access | Is bookmarked |
| DELETE | `/bookmarks/:id` | access | Remove by id |
| DELETE | `/bookmarks?examKey=&questionId=` | access | Remove by question |
| GET | `/notes?page=&pageSize=&examKey=` | access | List notes |
| POST | `/notes` | access | Upsert `{ provider, exam, questionId, body }` |
| GET | `/notes/:id` | access | Note detail |
| DELETE | `/notes/:id` | access | Delete |

## Subscriptions

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/subscriptions/plans` | – | Active plans + payment mode flags |
| GET | `/subscriptions/me` | access | Current subscription, payments, entitlements |
| POST | `/subscriptions` | verified | Create subscription (simulated checkout) |
| POST | `/subscriptions/:id/cancel` | access | Cancel at period end |
| GET | `/subscriptions/payments` | access | Payment history |

Subscribe body: `{ "planId": "premium-monthly", "billingCycle": "monthly", "couponCode": "SAVE20" }`.

Mock checkout is only available while `ALLOW_MOCK_PAYMENTS=true` and
`PAYMENTS_ENABLED=false`. No money moves.

## Coupons & referrals

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/coupons/validate` | optional | `{ code, planId }` → validity + pricing preview |
| GET | `/referrals/me` | access | Code, share URL, referral stats |

## Notifications & leaderboard

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/notifications?limit=&unreadOnly=` | access | List + unread count |
| POST | `/notifications/read` | access | `{ ids }` or `{ all: true }` |
| GET | `/leaderboard?period=all|month&limit=` | – | Top learners |

## AI

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/ai/explain` | premium | `{ provider, exam, questionId }` → explanation |

Requires `AI_API_KEY`; returns `503` when not configured and `403` for non-premium.

## Admin

All admin routes require `role: admin`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/admin/stats` | Users, attempts, mock revenue, subscriptions, catalogue, signups |
| GET | `/admin/users?q=&role=&plan=&page=` | List users |
| PATCH | `/admin/users/:id` | Update role/plan/suspension/name |
| DELETE | `/admin/users/:id` | Soft-delete user |
| GET/POST | `/admin/plans` | List/create plans |
| PATCH/DELETE | `/admin/plans/:id` | Update/deactivate plan |
| GET/POST | `/admin/coupons` | List/create coupons |
| PATCH/DELETE | `/admin/coupons/:id` | Update/deactivate coupon |
| GET/PATCH | `/admin/settings` | Entitlement limits, maintenance, announcements |
| GET | `/admin/audit` | Audit log (paginated, filter by action) |
| GET | `/admin/dataset/status` | Dataset branch + catalogue counts |
| POST | `/admin/dataset/sync` | Re-index the GitHub catalogue |

## Rate limiting

Global limit: `RATE_LIMIT_MAX` requests per window (`RATE_LIMIT_WINDOW`).
Auth endpoints are stricter (12/min; 6/min for sensitive flows), AI is 20/min and
dataset sync is 3/hour. The edge (nginx) also applies a burst limit.