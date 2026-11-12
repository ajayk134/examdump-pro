# Security audit

Current posture, controls verified against source, and items that remain open.

**Date:** 2026-11-12. **Method:** code review of the security-relevant
directories plus verification queries against the live schema. This is an internal
review, not an external penetration test.

## Verified controls

| Control | Where | Verification |
| --- | --- | --- |
| Password hashing with pepper | `lib/passwords.ts` | bcrypt + `PASSWORD_PEPPER` appended before hash |
| Refresh tokens stored hashed | `lib/tokens.ts` `hashToken` | sha256; plaintext never persisted |
| Refresh rotation | `services/auth.service.ts:220` | old hash replaced on every refresh |
| Session revocation | `auth.service.ts:272` `revokeAllSessions` | called on password reset |
| Constant-time comparison | `lib/tokens.ts` `safeEqual` | used for token/hash compare |
| Access-token verification without DB | `lib/jwt.ts` HS256 | signature only |
| Guards on every route | `lib/guards.ts` | `requireAuth`/`requireAdmin`/`requirePermission` |
| Zod validation at boundaries | `packages/shared/src/schemas.ts` | rejected with `VALIDATION_ERROR` |
| Central error handling | `app.ts:117` | no stack traces to clients |
| Security headers | `@fastify/helmet` | registered |
| CORS allow-list | `app.ts:84` | `WEB_ORIGIN` |
| Rate limiting | `@fastify/rate-limit` | `RATE_LIMIT_MAX` / window |
| Webhook HMAC over raw body | `app.ts:69` raw parser, `routes/payments.ts` | verified before JSON parse |
| Webhook idempotency | `webhook_events` | unique key |
| UPI amount uniqueness | `upi_orders_active_amount_idx` | partial unique, verified in live DB |
| Single settlement per order | `upi_matches_order_settled_idx` | partial unique, verified |
| Alert replay prevention | `upi_notifications_utr_idx` | partial unique, verified |
| SQL injection | Drizzle parameterisation | no string-concatenated SQL |
| XSS | React escaping | `dangerouslySetInnerHTML` banned except own QR SVG |
| Secret scanning | gitleaks in CI | `.github/workflows/ci.yml` |
| Audit trail | `audit_logs` | privileged actions recorded |

## Findings

### F1 — `PAYMENT_MAX_REFUNDS` is defined but never enforced (medium)

`apps/api/src/config/env.ts:178` defines it (default 5). A repository-wide search
finds **no other reference**. Refund *amounts* are correctly bounded against
`payments.refunded_minor`, so over-refunding is prevented, but the *number* of
partial refunds is unlimited.

Impact: an admin could issue many small partial refunds. Low financial risk
(arithmetic holds), but the control implies an intent that is not implemented.

Recommendation: enforce the count in the refund path, or remove the variable so it
does not mislead operators.

### F2 — `routes/admin-upi.ts` uses coarse `requireAdmin` (low)

Other admin route files use `requirePermission(...)`. The UPI admin routes use
`requireAdmin`, which permits **any** Administrator rather than requiring a
payment-specific permission. Today no non-admin role has admin access, so there is
no live escalation, but the granularity is inconsistent and would become a real gap
if a limited admin role were added.

Recommendation: switch to `requirePermission('payments.manage')` /
`('payments.refund')` for consistency with `admin-ops.ts`.

### F3 — Webhook raw-body fallback (low)

The handlers use `request.rawBody ?? JSON.stringify(request.body)`. The fallback
would weaken HMAC verification, because re-serialisation is not byte-identical. The
raw parser at `app.ts:69` is registered, so the fallback is not currently taken —
but removing that registration would silently degrade verification.

Recommendation: fail closed (reject) when `rawBody` is absent for a webhook
request.

### F4 — No global log redaction (medium)

Pino redaction is not configured. Any `request.log.info({ body })` on an auth,
payment or UPI ingest route would write credentials or bank details to logs, which
are rotated but not encrypted.

Recommendation: configure `redact` for `req.headers.authorization`,
`req.headers.cookie` and known secret-shaped paths.

### F5 — UPI settlement is not bank-verified (by design, high residual)

Documented at length in [ADR-003](../decisions/ADR-003.md) and
[payment security](../payments/PAYMENT_SECURITY.md). Mitigated by
`UPI_AUTO_APPROVE=false` and unique amounts. Not a defect to "fix" without moving
to a PSP with real callbacks.

### F6 — No rate limiting on the refresh endpoint beyond the global limit (low)

Refresh is covered by the global limiter. Given rotation is single-use, brute force
is impractical. Acceptable.

## Not audited

- Kubernetes/infra hardening (not applicable — single host, see ADR-005)
- Third-party dependency CVEs (no automated audit in CI; `npm audit` is not
  wired into the workflow)
- DNS/TLS configuration
- Physical/host-level access — assumed trusted

These are recorded in [KNOWN_ISSUES.md](../../KNOWN_ISSUES.md) and
[TECH_DEBT.md](../../TECH_DEBT.md).

## Related

- [Threat model](THREAT_MODEL.md)
- [Payment security](../payments/PAYMENT_SECURITY.md)
- [SECURITY.md](../../SECURITY.md)
