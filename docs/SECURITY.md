# Security model

## Principles

1. **Least privilege** — the dataset token is read-only; PostgreSQL credentials are
   scoped to one database; containers run as a non-root user.
2. **Defence in depth** — nginx limits, API rate limits, per-user quotas,
   entitlement checks and audit logging are independent layers.
3. **No secrets in source** — all secrets are injected by Doppler. `.env*` files
   are gitignored; only `.env.example` is committed.
4. **Server-authoritative** — grading, entitlements and premium status are
   decided by the API, never the browser.

## Authentication

- Passwords: bcrypt with configurable rounds (default 12) **plus a secret
  pepper** from Doppler. Passwords are never returned or logged.
- Access tokens: short-lived HS256 JWTs (default 15 min) stored in an HttpOnly,
  `SameSite=Lax`, `Secure` (in production) cookie.
- Refresh tokens: opaque 48-byte random values, stored **hashed** in PostgreSQL,
  rotated on every use, revocable per device and automatically expiring.
- Sessions are checked on every authenticated request, so logout and suspension
  take effect immediately.
- Brute-force protection: failed logins are recorded; after 10 failures in 15
  minutes the email is temporarily locked. Auth routes are also rate limited.
- Email verification tokens and password-reset tokens are random, stored hashed,
  single-use and time-limited (24 h / 1 h).
- Google sign-in verifies the ID token audience and requires a verified email.

## Authorization

- Roles: `user` and `admin`. Admin routes call `requireAdmin`.
- Email verification is required for subscription creation and AI.
- Entitlements are derived from `user.plan` + `user.premiumUntil` and server
  settings on every request.

## Dataset protection

- Questions are fetched server-side from a private GitHub repo using a token
  that is never exposed to clients.
- Free users receive only the first N questions. Offset, random and direct-ID
  access cannot exceed the limit.
- Assessment responses omit the answer key.
- The API returns a clear `403 QUOTA_EXCEEDED` instead of leaking data.

## Input & output

- Every mutating endpoint validates its body with Zod (types, lengths, formats,
  enums, numeric bounds).
- Drizzle ORM enforces schema-level constraints and safe casting.
- NoSQL injection is mitigated by schema typing and Zod coercion (query strings
  are parsed into explicit types; user strings are never passed as query
  operators).
- No `eval`, no dynamic `require`, no user-controlled outbound URLs.

## HTTP hardening

- Helmet security headers.
- CORS restricted to configured origins with credentials.
- Body limit 1 MB; nginx 2 MB.
- Rate limiting at the API and edge.
- Request logging redacts authorization headers, cookies and password fields.
- Responses use structured error codes without stack traces.

## Secrets

| Secret | Purpose |
| --- | --- |
| `DATABASE_URL` | Atlas connection (dedicated DB) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | token signing |
| `PASSWORD_PEPPER` | password hashing pepper |
| `GITHUB_TOKEN` | read-only dataset access |
| `GOOGLE_CLIENT_SECRET` | Google OIDC (optional) |
| `SMTP_PASS` | transactional email (optional) |
| `AI_API_KEY` | AI explanations (optional) |
| `ADMIN_PASSWORD` | one-time admin bootstrap |

Rotate the GitHub token and all JWT/pepper secrets if exposure is ever
suspected. Rotating the pepper requires a password reset for all users.

## Audit trail

Sensitive events (login, failed login, registration, email verification,
password reset, role changes, suspensions, subscription lifecycle, coupon
creation, settings changes, dataset syncs, deletions) are written to
`auditlogs` with actor, IP, user-agent and metadata. Admin routes expose the log.

## Data protection

- Users can export their data and soft-delete their account from Settings.
- Deletion anonymises the email and suspends the account, and revokes sessions.
- Backups are encrypted at rest by the storage layer; restrict access to them.

## Reporting a vulnerability

Contact the maintainers privately. Do not open a public issue for security
reports. Include reproduction steps and impact.

## Production checklist

- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS enabled.
- [ ] Strong, unique `JWT_*`, `PASSWORD_PEPPER`, `ADMIN_PASSWORD`.
- [ ] Atlas IP allowlist restricted; database user has least privilege.
- [ ] GitHub token read-only and scoped to the dataset repo.
- [ ] SMTP configured (otherwise verification/reset links are console-only).
- [ ] PostgreSQL backups scheduled and restore tested.
- [ ] Uptime monitoring on `/api/health/ready`.
- [ ] `gitleaks` clean in CI.