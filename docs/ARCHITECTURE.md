# Architecture

## System overview

```
                        ┌──────────────────────────────────────────────┐
                        │                Oracle Cloud VM                │
                        │                                              │
  Browser ──HTTPS──▶    │  nginx  ──/──▶  Next.js (web) :3000           │
                        │     │                                        │
                        │     └──/api──▶  Fastify API :4000             │
                        │                        │                     │
                        └────────────────────────┼─────────────────────┘
                                                 │
                        ┌────────────────────────┼─────────────────────┐
                        │                        ▼                     │
                        │   MongoDB Atlas      GitHub (private)        │
                        │   application data   exam question dataset   │
                        └──────────────────────────────────────────────┘
```

The web app is fully static/SSR-rendered; all dynamic data goes through the API.
nginx is the only public entry point and proxies `/api/*` to Fastify and
everything else to Next.js.

## Applications

### `apps/api` (Fastify)

Layered structure:

- `routes/` — HTTP boundary: auth guards, Zod validation, response shaping.
- `services/` — business logic: auth, entitlements, usage quotas, subscriptions,
  analytics, dataset sync, notifications, auditing.
- `db/models/` — Mongoose schemas, indexes and TTL policies.
- `lib/` — cross-cutting helpers (JWT, cookies, errors, email, pagination).
- `plugins/` — Fastify plugins (cookie, CORS, Helmet, rate limit).

Key design rules:

1. **Authorization happens in the route handler.** Every protected route calls
   `requireAuth`, `requireVerified` or `requireAdmin`.
2. **Entitlements are computed server-side** from the user document + settings
   and applied to every question response.
3. **The dataset token never leaves the server.** The browser only ever talks to
   `/api/*`.

### `apps/web` (Next.js)

- App Router with client components for authenticated/real-time screens and
  server components for static marketing content.
- `components/providers.tsx` implements theme, auth and toast contexts.
- `lib/api.ts` is the single fetch client (cookies included, typed errors).
- Tailwind + CSS variables power dark/light themes with no flash on load.

### `packages/shared`

Framework-agnostic contracts shared by API and web:

- Zod request schemas (single source of truth for validation).
- Content parser that normalises the upstream dataset into a stable question DTO
  while preserving every item type (`text`, `break`, `image`).
- Constants (roles, plans, statuses, audit actions, cookie names).

### `packages/data-client`

Server-only GitHub client:

- Fetches `data/index.json`, `data/<provider>/exams.json` and
  `data/<provider>/<exam>.json` via `raw.githubusercontent.com`.
- Supports both dataset branches:
  - `main`: human-readable provider/exam keys.
  - `masked_main`: hashed provider directories and `code__hash` exam keys.
- TTL + LRU in-memory cache. **No questions are written to MongoDB or disk.**

## Question flow

```
GET /api/exams/:provider/:exam/questions
  │
  ├─ optionalAuth  → user? → entitlements from settings
  ├─ DatasetClient → GitHub (cached in memory)
  ├─ normalise     → NormalizedQuestion[]
  ├─ entitlement   → free: slice(0, FREE_QUESTIONS_PER_EXAM), force offset=0
  │                  premium: paginate (capped by DATASET_MAX_QUESTIONS_PER_REQUEST)
  ├─ usage         → increment daily counters (authenticated)
  └─ response      → questions + explicit entitlement metadata
```

Offsets, random shuffling and direct question IDs are all constrained by the
server. A free user can never retrieve question `N+1` even by guessing IDs.

## Attempt & grading flow

1. `POST /api/attempts` validates the requested mode, selects a server-side
   question set (randomised for mock/timed) and stores an `in_progress` attempt.
   Returns the exact questions (answers hidden) so the client cannot choose a
   different set.
2. `POST /api/attempts/:id/complete` re-fetches the canonical questions, grades
   every answer against the normalised answer key, updates the attempt,
   per-question results, per-exam progress, user totals and streaks.
3. Analytics endpoints aggregate from those collections; no client-side scoring
   is trusted.

## Subscriptions

- Plans and coupons live in MongoDB.
- `createMockSubscription` is the payment seam. It validates the plan/coupon,
  supersedes the previous active subscription, records a `Payment`, applies the
  period to `user.premiumUntil` and writes an audit event.
- When a real processor is approved, replace this single service function with a
  provider adapter; the rest of the app reads entitlements from the user
  document, so nothing else needs to change.
- A nightly cron expires subscriptions and downgrades lapsed users.

## Caching & performance

- `DatasetClient` TTL/LRU cache (default 300s) avoids repeated GitHub reads.
- Settings are cached for 30s and invalidated on admin writes.
- MongoDB indexes cover every hot query path (see `DATABASE.md`).
- Next.js pages are statically rendered where possible; authenticated screens
  fetch client-side through the API.

## Failure modes

| Failure | Behaviour |
| --- | --- |
| GitHub dataset unreachable | API returns `502 DATASET_*`; catalogue metadata (last sync) still serves discovery |
| MongoDB unavailable | Readiness probe fails; API returns 503 on DB operations |
| Email provider absent | Emails are logged; dev verification/reset links are returned outside production |
| AI provider unavailable | AI route returns `503`; the rest of the app is unaffected |
| Payment provider disabled | Checkout returns a clear `503` (or runs in mock mode if enabled) |

## Scaling path

- Stateless API containers behind nginx → add replicas freely.
- Move the in-memory dataset cache to Redis if multiple API replicas cause
  repeated GitHub reads.
- Add a CDN in front of nginx for static assets.
- MongoDB Atlas scales vertically/horizontally independently.