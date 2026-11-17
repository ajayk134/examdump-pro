# Changelog

All notable changes to ExamDump Pro.

## [Unreleased]

### Changed

- **Frontend visual identity replaced — "Nova".** The interface no longer shares
  the previous "Aurora" look. The identity is now a deep indigo ink neutral, an
  electric-violet primary with magenta and cyan gradient partners, a geometric
  display face (Space Grotesk) over a rounded text face (Manrope), generous radii,
  pill controls, and a soft brand mesh behind the page. Every surface was
  reworked to the new language while keeping its behaviour: landing (hero plus
  live catalogue/pricing previews), discovery and provider pages (mesh heroes,
  and brand-gradient card hairlines replacing the old per-provider rainbow hues,
  which fought the palette), a purpose-built exam detail page, pricing
  (ring-gradient plan cards, compare table, FAQ), the practice and mock
  interfaces (a floating glass progress bar with a completion ring; submit
  confirmation via the shared dialog), the workspace dashboard,
  history/leaderboard/bookmarks/notes/referrals/support/profile, the AI tutor
  surface, a dense admin console with a mobile section strip, a split auth shell,
  and the legal/error/404 states. Fonts are self-hosted by `next/font`, so there
  is no runtime font request. Two decorative glows and the admin mobile section
  strip were bounded so no route can scroll horizontally at 360 px. No API
  contract, entitlement, payment/UPI or auth guard changed, and no dependency was
  added.

- **Frontend redesign — the Aurora design system applied per surface.** Every
  route was rebuilt so it has a layout that fits its job instead of one repeated
  card grid, while sharing one token set. The system gained explicit layout
  idioms (`.panel`, `.panel-lg`, `.tile`, `.section`, `.rail`, `.tbl`, `.kbd`,
  `.link-quiet`) alongside the existing `.surface`/`.card` aliases, a shared
  `useOverlay` hook (focus trap, scroll lock, Escape, visual-viewport sizing)
  now used by both `Drawer` and the new `Dialog`, and new primitives
  (`StatStrip`, `Tooltip`, `KeyHint`). Highlights: split hero with a live
  catalogue strip on the landing page; provider/exam discovery with phone filters
  in a drawer; a briefing-style exam detail page; a workspace dashboard with a
  "continue" hero, grouped metrics and a chart-led performance panel; a focus
  practice interface with 1–9 answer shortcuts; a mock exam whose submit
  confirmation uses the shared dialog; analytics, pricing (compare table + FAQ),
  the AI tutor transcript and a dense admin console with a responsive side rail;
  and a premium footer rendered at every breakpoint. `PAYMENTS_ENABLED` and
  `UPI_AUTO_APPROVE` are untouched, no API contract changed, and no dependency
  was added.

### Added

- **YouPI-PG standalone UPI gateway integration.** Opt-in provider
  (`YOUPI_ENABLED`) that creates a checkout on an independently deployed YouPI-PG
  instance and receives its signed webhooks. The amount is always the server
  quote; the webhook is HMAC-SHA256 verified over the raw bytes with a timestamp
  replay window and `webhook_events` idempotency; and only a `RECONCILED`
  bank-statement event reaches `settlePayment`. `OBSERVED_SUCCESS` and
  `MANUAL_REVIEW` are recorded and never fulfil. `PAYMENTS_ENABLED` stays `false`.
  New: `services/payments/youpi.client.ts`, two routes in `payments.ts`,
  `test/youpi-integration.test.ts`, and `docs/deployment/YOUPI_PG_INTEGRATION.md`.

### Removed

- **The embedded UPI gateway.** Self-collected UPI (QR checkout, Gmail/SMS
  notification observers, matching and the Admin -> UPI dashboard) is removed.
  Deleted: 4 routes, the `services/upi/` subsystem (11 modules), the UPI schema
  module, the OAuth CLI script, 5 test suites, 3 web components and 2 guides.
  Retained deliberately: `payments/adapter.ts` and `razorpay.adapter.ts` (the
  generic `'upi'` payment method), `hyperswitch.client.ts`, `lib/secretbox.ts`,
  migrations `0006`-`0008` and the seven `upi_*` tables, all empty.
  Card and Razorpay checkout are unaffected. `PAYMENTS_ENABLED` remains `false`;
  no payment gateway is wired into the running application.

- **Payment-gateway integration prototype.** An experimental external gateway
  deployment, its webhook route, service, tests and design notes were developed
  but never shipped: the running API image never contained the code. All
  artefacts are removed, leaving no unused integration surface.

### Fixed

- **Pricing comparison widened the whole document on phones.** The table's
  `sr-only` `<caption>` is `position: absolute`; because the scroll wrapper was
  `position: static`, the caption resolved against the viewport, escaped the
  wrapper's `overflow-x` clip and dragged `documentElement.scrollWidth` (and the
  fixed bottom nav) out to the table's full width. `TableScroll` is now
  `relative`, so it is the caption's containing block and clips it as intended.
- **`sm:animate-pop` on the shared dialog emitted no CSS.** `animate-pop` was a
  plain class, which cannot take a `sm:` prefix. The animation is now registered
  in `tailwind.config.ts` (`pop`, `sheet`, `slide-in`, `rise`, mirroring the
  existing keyframes) so responsive variants emit.
- Removed two dead class names that produced no CSS: `inline-math`
  (`components/markdown.tsx`) and `truncate-0` (`components/ui.tsx`,
  `app/dashboard/page.tsx`).
- The `Alert` "info" tone now uses the `accent` token instead of a raw brand
  ramp, and toasts use `positive`/`negative` tokens with a text-coloured
  message, so both themes read consistently.
- Coarse-pointer minimum height for `.chip` and `.btn-sm` raised to 44 px, and a
  `.link-quiet` idiom gives footer and "view all" text links the same touch
  hit-area expansion `.link` already had.

- **YouPI checkout was reachable while payments were disabled.**
  `POST /api/payments/pay/youpi/checkout` was gated only by `YOUPI_ENABLED`, so
  `YOUPI_ENABLED=true` + `PAYMENTS_ENABLED=false` still let a verified user
  create a real gateway order. Creation now requires both switches, with
  `PAYMENTS_ENABLED` checked first, and returns `503 PAYMENTS_DISABLED` before
  authentication, quoting, any gateway request or any `payments` row. Signed
  webhook verification and settlement of pre-existing orders are unchanged.
  Covered in `test/youpi-integration.test.ts` for every flag combination.

- **ExamDump used the wrong YouPI receiving account.** The intended account
  `8149d7a5-2a14-4c1d-88da-dabf3573fd2a` (`examdump@axl`, payee `Exam Dump`) was
  attached to the demo merchant while ExamDump used the placeholder
  `examdumptest@upi`. The intended account was reassigned after a verified
  backup; the placeholder is inactive and the Gmail observer now binds to the
  same intended account used by checkout and statement reconciliation.

- **Terminal YouPI events left local payments pending forever.** Signed
  `FAILED`, `EXPIRED` and `CANCELLED` events now close a pending payment as
  failed, while `OBSERVED_SUCCESS` and `MANUAL_REVIEW` remain non-settling.
  Authenticated webhook rows now end in `processed`/`ignored` for admin
  monitoring, and a delivery interrupted before completion is reprocessed on
  retry instead of being permanently acknowledged as a duplicate. RECONCILED
  events also reject a mismatched gateway payment id.

- **Pricing never offered the YouPI rail.** `/subscriptions/plans` now reports
  `youpi.available` (both switches plus credentials), and the pricing page
  routes to `/payments/pay/youpi/checkout` when it is actually available. With
  `PAYMENTS_ENABLED=false` the UI remains "Checkout unavailable".

- **Production web bundle called `http://127.0.0.1:4100` from visitors'
  browsers.** `NEXT_PUBLIC_API_URL` is inlined at build time, and the developer
  value in `apps/web/.env.local` reached the production bundle, so every API
  call failed with `ERR_CONNECTION_REFUSED`/CORS and pages rendered without
  data (login included). `apps/web/lib/api-base.ts` now ignores loopback values
  when `NODE_ENV === 'production'` and falls back to same-origin, which nginx
  routes to the API under `/api`. Covered by `apps/web/test/api-base.test.ts`.

- **Hydration mismatch on Practice and Mock Tests.** `ExamPicker` read
  `localStorage` during render, so the server HTML (no "recent exams" tip)
  differed from a returning visitor's first client render and React re-rendered
  the picker. Recents are now read after mount. Covered by
  `apps/web/test/exam-picker-ssr.test.ts`.

- **Answer options showed their letter twice** ("A  A. default route") and the
  answer panel read "Suggested answer: Suggested Answer: B". The option label
  and answer label are now stripped from the rendered content by
  `stripOptionLabelFromContent` and `stripAnswerLabel`. Covered in
  `packages/shared/src/content.test.ts`.

- **Footer offered "Sign in" to signed-in users and no way to sign out.** The
  footer now shows "Sign out" (clearing the session and returning home) when a
  session exists.

- **Pricing offered a checkout button that could never succeed.** With live
  payments disabled the plan sheet showed "Activate (test mode)", but
  `mock-activate` refuses to run on a production deployment, so every click
  returned 403. The button now reads "Checkout unavailable" and is disabled
  unless live payments or mock activation are actually available.

- **`redeploy-api.sh --rollback --dry-run` performed a real rollback.** `DRY_RUN`
  was checked only inside the build and image-verification steps, so `--rollback`
  stopped, renamed, restarted and removed production containers while reporting
  that nothing had changed. `deploy` had the same class of defect: it removed
  leftover containers before its own dry-run check. Every mutating path now gates
  on a single `mutating` guard, dry runs print the exact steps and image IDs they
  would use, and mutually exclusive modes are rejected instead of silently
  ignoring one. Covered by `deploy/test-dry-run.sh` (27 cases), which includes an
  assertion that the live container's image ID is unchanged after a rollback dry
  run.

### Changed

- `helpers.ts` no longer defaults to a hardcoded test database URL. `npm test`
  requires `DATABASE_URL_TEST`, so a stray Postgres on port 5433 can never be
  silently truncated.

### Fixed

- **Gmail Connect no longer demands a hand-typed client secret.** The dashboard
  required both OAuth fields even when the server already held a correct pair,
  so the token exchange ran against whatever had been pasted into the form and
  failed with a generic "connection could not be completed". It now uses
  `UPI_GOOGLE_CLIENT_ID` / `UPI_GOOGLE_CLIENT_SECRET` by default, with an opt-in
  field for a different Google project.
- **Authorization codes and `state` tokens were being written to the API request
  log.** Fastify's default request serializer echoes the full URL. A request
  serializer now censors sensitive query parameters by name, keeping the
  parameter list visible so logs stay useful.
- **Failed OAuth connections recorded no diagnosable reason.** The audit row now
  carries a stable error code (and Google's `error` marker, reduced to a safe
  identifier) instead of only a prose sentence.

### Added

- **UPI gateway configuration from the admin dashboard.** The merchant UPI ID,
  the Gmail connection and the payment/observer/auto-approval switches can now be
  managed at Admin → UPI → Gateway settings, removing routine environment-variable
  edits and the host-side OAuth script. Settings live in `upi_config`; credentials
  are encrypted at rest with AES-256-GCM (`UPI_SECRETS_KEY`, kept in Doppler).
  Dashboard values take precedence over environment values, and a malformed stored
  value is ignored in favour of the environment rather than throwing. Collecting
  money and watching the mailbox are independent switches. Automatic approval stays
  off, requires a typed confirmation, and is refused unless the observer is
  connected.

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