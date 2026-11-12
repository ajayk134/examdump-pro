# Changelog

All notable changes to ExamDump Pro.

## [Unreleased]

### Added

- Unique payable amount per UPI order: the plan price plus a random 0–99 paise
  suffix, so an incoming bank alert matches exactly one active order. Enforced by
  the partial unique index `upi_orders_active_amount_idx`; creation retries on
  collision. `base_amount_paise` records the unsuffixed price.
- UPI settlement hardening after a security audit: a single settlement per order
  (`upi_matches_order_settled_idx`), one notification per bank UTR
  (`upi_notifications_utr_idx`), risk scoring, and human review by default.
- Email centre: durable Postgres-backed queue with `FOR UPDATE SKIP LOCKED`
  claiming, templates, campaigns, preferences and suppression.
- Documentation system: `docs/` hierarchy (architecture, database, security,
  performance, deployment, payments, testing, operations, decisions), root-level
  reference documents, and agent instructions for GitHub Copilot
  (`.github/copilot-instructions.md` plus path-scoped
  `.github/instructions/*.instructions.md`).

### Changed

- `deploy/docker-compose.yml` declares explicit network aliases `postgres` and
  `api`. `DATABASE_URL` targets the bare hostname `postgres` and nginx proxies to
  `server api:4000`; without the aliases a recreated container fails to resolve and
  the site returns 502.
- Documentation corrected where it described systems that no longer exist
  (stale MongoDB references in `AGENTS.md`, `CONTRIBUTING.md` and
  `TROUBLESHOOTING.md`; a wrong Postgres port).

### Fixed

- Rebuilding the API container no longer leaves a stale nginx upstream. Note that
  `nginx -s reload` remains required after an API recreate — see
  `docs/OPERATIONS.md`.

### Fixed

- **`PAYMENT_MAX_REFUNDS` is enforced.** The ceiling was defined and documented
  but never read, so the number of partial refunds per payment was unbounded. It
  is now enforced inside a conditional `UPDATE`, making the check atomic: two
  concurrent refunds cannot both pass. Failed refunds do not consume the
  allowance.
- **Admin UPI routes use granular permissions.** A blanket `requireAdmin` guard
  meant any Administrator could move money while a payments-review role could not
  reach the routes at all. Routes now require `payments.read`,
  `payments.manage` or `payments.refund` as appropriate.
- **Webhooks no longer fall back to re-serialised JSON.** When the raw body was
  absent the receivers hashed `JSON.stringify(request.body)`, which is not the
  byte string the provider signed. `requireRawBody` now refuses such a request
  with a 400 instead of substituting different bytes.

- **UPI ingest refuses requests without signed raw bytes.** Both ingest routes
  read the body with `request.rawBody ?? ''`, the same unsafe fallback removed from
  the payment webhooks. They now share `requireRawBody`, and refuse bodies over
  8 KB before hashing.
- **Abandoning a UPI order closes its payment attempt.** Expiry and cancellation
  left the `payments` row `pending` forever, so a second checkout could create a
  second claimable payment for the same plan. Both paths now fail the payment
  inside the same transaction, guarded on `status = 'pending'`.
- **The Gmail observer no longer silently misses new payments.** With
  `gmail.readonly` and no read-marking, the default `is:unread` query selected the
  whole mailbox oldest-first and stopped returning new alerts once 25 existed. The
  default is now `in:anywhere`, and any unread term is stripped with a warning.

Each fix is covered by a regression test verified to fail against the previous
code. Remaining limitations are listed in [`KNOWN_ISSUES.md`](../KNOWN_ISSUES.md).

### Added (UPI automation)

- **`processing` state in the checkout.** A UPI order now reports a
  customer-visible status (`pending`, `processing`, `paid`, `expired`,
  `cancelled`) instead of the database enum. A credit awaiting verification is
  reported as `processing` with a redacted summary, so the payer is not left
  looking at an unchanged QR and paying twice. The checkout polls in that state and
  refreshes when the tab becomes visible again.
- **`npm run upi:gmail-oauth`** — a real handshake script for the payment
  mailbox: prints the consent URL, exchanges the code, refuses a grant wider than
  `gmail.readonly`, and prints the refresh token once.
- **[`docs/payments/UPI_SETUP.md`](payments/UPI_SETUP.md)** — the complete manual
  checklist for enabling real payments, including what remains manual forever.
- UPI routes added to the OpenAPI document and `API.md`; they were absent.

## [1.1.0] — 2026

### Changed

- **Database migrated from MongoDB/Mongoose to self-hosted PostgreSQL** using
  Drizzle ORM. All collections (users, sessions, auth tokens, attempts, progress,
  bookmarks, notes, usage, notifications, audit logs, settings, catalogue) are now
  relational tables with typed queries, indexes and foreign keys.
- Added Drizzle migrations (`apps/api/src/db/migrations`) applied automatically on
  container boot, plus a `db:generate` script.
- **Pricing moved to INR** with four plans: One Exam 30d ₹500, One Exam Early
  Access 30d ₹1,000, All Exams 30d ₹1,500, All Exams 365d ₹2,500. Prices are stored
  in minor units and are server-authoritative.
- **Entitlements redesigned around subscriptions + access grants.** Single-exam
  plans unlock exactly one exam; all-exam plans unlock everything. Access is never
  inferred from client input.
- Backups/restore now use `pg_dump`/`pg_restore`; CI uses a PostgreSQL service.

### Added

- Granular RBAC (roles, permissions, per-user roles) with `requirePermission`.
- Admin console APIs: roles/permissions, access grants & revocations, refunds,
  payments, feature flags, email templates, reports overview and system health.
- Goals, entitlements endpoint, plan change/upgrade and cancellation flows.
- Refunds (full/partial) that immediately revoke access.

## [1.0.0] — 2026

### Added

- Complete rebuild as a TypeScript monorepo (Fastify API + Next.js 15 web).
- PostgreSQL-backed accounts, sessions, subscriptions, payments, attempts,
  progress, bookmarks, notes, notifications, analytics, audit logs and settings.
- GitHub-only exam dataset client with TTL cache and support for both `main` and
  `masked_main` branches. Questions are never stored in PostgreSQL.
- Authentication: registration, email verification, login, rotating refresh
  sessions, logout, password reset, change password, Google sign-in, roles.
- Server-enforced entitlements: 5 free questions per exam, unlimited Premium.
  Offset/random/direct-ID bypass attempts are blocked.
- Exam discovery and search, practice, reading, random, mock and timed modes.
- Server-side grading, weak-topic analysis, performance series, streaks,
  leaderboards and personalised recommendations.
- Premium plans, coupons, referrals, simulated checkout, payment history and a
  full admin console with audit trail and dataset sync.
- AI explanations (premium) via any OpenAI-compatible API.
- Dark/light themes, responsive layouts, accessibility-minded components.
- Security: Zod validation, rate limiting, Helmet, CORS, password pepper,
  HttpOnly cookies, audit logging, secret scanning.
- Ops: Dockerfiles, Docker Compose, nginx, Doppler integration, CI/CD,
  dataset sync cron, subscription expiry cron, backup/restore scripts, health
  checks and comprehensive documentation.
- Automated tests across the content parser, dataset client and API
  (31 integration tests).

### Notes

- Payment processing is intentionally **simulated** until a provider
  (e.g. HyperSwitch) is approved. No real charges are made.
- The legacy Cloudflare Worker + static frontend are preserved unchanged in the
  original recovered project and are not part of this repository.