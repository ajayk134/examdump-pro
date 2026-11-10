# Changelog

All notable changes to ExamDump Pro.

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