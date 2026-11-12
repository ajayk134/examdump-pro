# Known issues

Defects and limitations that exist **today**. Each was verified by reading the
source, not inferred.

## Resolved defects

These were confirmed by reading the source, then fixed. Each fix has a
regression test that was verified to fail against the original code.

### ~~KI-1 — `PAYMENT_MAX_REFUNDS` was never enforced~~ — FIXED

`env.ts` defined it (default 5) but nothing read it, so the number of partial
refunds per payment was unbounded. Amounts remained bounded by
`payments.refunded_minor`, so over-refunding was already impossible.

- **Fix:** `services/subscription.service.ts` now enforces the ceiling inside a
  conditional `UPDATE` that counts settled refunds in the same statement, so two
  concurrent refunds cannot both pass the check. Failed refunds are excluded, as
  they never moved money. A concurrent modification surfaces as a 409.
- **Tests:** `apps/api/test/refund-limit.test.ts`.

### ~~KI-2 — UPI admin routes used coarse `requireAdmin`~~ — FIXED

`routes/admin-upi.ts` guarded every route with `requireAdmin`, so any
Administrator could move money, and a role created to review payments could not
reach the routes at all.

- **Fix:** per-route guards — `payments.read` for overview and listings,
  `payments.manage` for manual match and observer poll, `payments.refund` for
  refund request and completion.
- **Tests:** `apps/api/test/admin-upi-authz.test.ts` builds roles with exact
  permission sets and asserts a read-only role can read but cannot refund.

### ~~KI-3 — webhook raw-body fallback could weaken HMAC~~ — FIXED

Both receivers used `request.rawBody ?? JSON.stringify(request.body)`, silently
substituting different bytes for the ones the provider signed.

- **Fix:** `routes/payments.ts` exposes `requireRawBody`, which returns the
  captured bytes or throws a 400. A request with no raw bytes cannot be
  authenticated, so it is refused rather than guessed at.
- **Tests:** `apps/api/test/payments.test.ts`.

## Open defects

### KI-4 — no global log redaction

Pino `redact` is not configured.

- **Impact:** any `log.info({ body })` on an auth, payment or ingest route writes
  credentials or bank details to logs.
- **Fix:** configure redaction for `authorization`, `cookie` and secret-shaped
  paths.

### KI-5 — stale `doppler.yaml`

`doppler.yaml` points at `agent-keys/dev_personal`. Production requires
`examdump-pro/prd`.

- **Impact:** a bare `doppler run` uses the wrong project. Deploy scripts must pass
  `--project examdump-pro --config prd` explicitly.
- **Fix:** update the file or remove it in favour of explicit flags.

## Limitations by design (not bugs)

| Item | Why it stands |
| --- | --- |
| UPI matching is notification-based, not bank-verified | no callback exists for a personal VPA — see [ADR-003](docs/decisions/ADR-003.md) |
| `UPI_AUTO_APPROVE=false` | human review is the control that mitigates the above |
| Payments disabled by default | deliberate safety default |
| Rate limits are per process | in-memory store — see [ADR-002](docs/decisions/ADR-002.md) |
| Single host, no redundancy | see [ADR-005](docs/decisions/ADR-005.md) |

## Missing capability

- No browser E2E tests.
- No external uptime monitoring or alerting.
- No metrics pipeline.
- Off-host backup copies are not automated.
- No data-retention pruning for `sessions`, `login_attempts`, `mail_logs`,
  `email_queue`, `webhook_events`.
- No dependency CVE scanning in CI.
- No automated accessibility testing.

Structural work items are tracked separately in [TECH_DEBT.md](TECH_DEBT.md).

## Reporting

Security-relevant issues: see [SECURITY.md](SECURITY.md) — report privately, never
in a public issue.
