# Known issues

Defects and limitations that exist **today**. Each was verified by reading the
source, not inferred.

## Confirmed defects

### KI-1 — `PAYMENT_MAX_REFUNDS` is never enforced

`apps/api/src/config/env.ts:178` defines it (default 5). A repository-wide search
finds no other reference.

- **Impact:** the *number* of partial refunds per payment is unbounded. Amounts are
  still bounded by `payments.refunded_minor`, so over-refunding is prevented.
- **Fix:** enforce a count in the refund path, or delete the variable so it stops
  implying a control that does not exist.

### KI-2 — UPI admin routes use coarse `requireAdmin`

`routes/admin-upi.ts:52` guards with `requireAdmin`. Other admin route files use
`requirePermission(...)`.

- **Impact:** any Administrator can act on UPI orders, regardless of payment-specific
  permissions. No escalation today because no limited admin role exists.
- **Fix:** switch to `requirePermission('payments.manage')` / `('payments.refund')`.

### KI-3 — webhook raw-body fallback could weaken HMAC

`routes/payments.ts:135,365` use `request.rawBody ?? JSON.stringify(request.body)`.

- **Impact:** currently safe — the raw parser is registered at `app.ts:69`. If that
  registration were removed, verification would silently degrade to
  re-serialised JSON, which is not byte-identical.
- **Fix:** reject the request when `rawBody` is absent.

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
