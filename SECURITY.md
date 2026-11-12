# Security policy

Report suspected vulnerabilities **privately** to the maintainers. Do not open a
public issue.

## Supported scope

Latest `main` branch.

## What to include

- Affected endpoint or component, and environment.
- Reproduction steps or proof of concept.
- Impact assessment (data exposure, privilege escalation, quota bypass, payment
  integrity).
- Suggested remediation.

Please allow reasonable time for a fix before disclosure.

## Security posture

> **Detailed:** [threat model](docs/security/THREAT_MODEL.md) ·
> [audit](docs/security/SECURITY_AUDIT.md) ·
> [authentication](docs/security/AUTHENTICATION.md) ·
> [authorization](docs/security/AUTHORIZATION.md) ·
> [secrets](docs/security/SECRETS_MANAGEMENT.md) ·
> [payment security](docs/payments/PAYMENT_SECURITY.md)

### Controls in place

- bcrypt with an application pepper; constant-time comparisons
- Rotating opaque refresh tokens (sha256-hashed), HttpOnly + Secure cookies
- Server-side entitlement enforcement in one service
- Zod validation on every boundary; Drizzle parameterised SQL
- Helmet headers, CORS allow-list, rate limiting
- HMAC-verified webhooks over the raw body, with idempotency keys
- Partial unique indexes making double settlement impossible
- Audit logging for privileged actions; gitleaks in CI
- Secrets exclusively from Doppler

### Honest limitations

- **UPI settlement is notification-based, not bank-verified.** There is no signed
  callback. Mitigated by unique amounts, single-settlement constraints and
  `UPI_AUTO_APPROVE=false`. See [ADR-003](docs/decisions/ADR-003.md).
- `PAYMENT_MAX_REFUNDS` is not enforced.
- No global log redaction is configured.
- Single host with no redundancy and no monitoring.
- No dependency CVE scanning in CI.

Full list: [KNOWN_ISSUES.md](KNOWN_ISSUES.md) and [TECH_DEBT.md](TECH_DEBT.md).

### Payment defaults

```
PAYMENTS_ENABLED=false
UPI_AUTO_APPROVE=false
ALLOW_MOCK_PAYMENTS=false   # production
```

These must not be changed without explicit authorization.
