# Threat model

Assets, adversaries and the controls that actually exist in this codebase. Where
a control is weak or partial, it says so.

## Assets, in order of impact

| Asset | Impact if compromised |
| --- | --- |
| Payment integrity (entitlements granted without payment) | direct revenue loss |
| User credentials and sessions | account takeover |
| Personal data (email, study history) | privacy breach |
| Exam question content | dataset licensing, product value |
| Audit trail | inability to investigate anything else |
| Admin capability | full platform control |

## Adversaries

| Adversary | Capability | Primary goal |
| --- | --- | --- |
| Free user | authenticated, motivated | unlock premium content without paying |
| Opportunistic attacker | unauthenticated, automated | credential stuffing, scraping, abuse |
| Payment fraudster | can send money, can forge notifications | obtain entitlement without a real payment |
| Malicious insider / compromised admin | admin session | exfiltrate data, alter entitlements |
| Infra attacker | host or network level | secrets, database |

## Threats and controls

### T1 — Entitlement bypass (free → premium)

*Vector:* paginate past the free slice, request a random subset, fetch a question
by direct id, or call a premium-only endpoint.

*Controls:*
- All limiting happens in `services/entitlement.service.ts`, server-side.
- Answers are withheld at serialisation (`toClientQuestion(q, includeAnswer)`)
  for mock/timed modes, so even an unlocked question does not reveal its key.
- Every premium endpoint re-checks entitlement; there is no "trusted client" path.

*Residual risk:* low. The slices funnel through one function.

### T2 — Question dataset scraping

*Vector:* enumerate the catalogue and download everything.

*Controls:*
- `PREMIUM_DAILY_QUESTION_LIMIT` and `daily_usage` accounting.
- Free tier capped at `FREE_QUESTIONS_PER_EXAM`.
- Rate limiting via `@fastify/rate-limit`.
- Dataset fetched server-side; the GitHub token never reaches the browser.

*Residual risk:* medium. A paying user can still copy content manually, which is
inherent to the product.

### T3 — Payment forgery (UPI)

*Vector:* trigger a settlement without a real transfer.

*Controls:*
- The client can never mark an order paid. Settlement only happens from a
  server-parsed bank notification (`services/upi/order.service.ts`).
- Every order has a **unique** payable amount (`upi_orders_active_amount_idx`),
  so a match cannot be claimed by two orders.
- `upi_notifications_utr_idx` prevents replaying the same UTR.
- `upi_matches_order_settled_idx` allows at most one approval per order.
- **`UPI_AUTO_APPROVE=false` by default**, routing all matches to human review.

*Residual risk:* **material and acknowledged.** Matching is
notification-based: there is no signed callback from a bank or PSP. A forged
alert that parses correctly and matches an amount could be accepted if auto-
approval were enabled. This is precisely why it is disabled and matches are
reviewed against the actual bank statement. See
[payment security](../payments/PAYMENT_SECURITY.md).

### T4 — Card payment webhook forgery / replay

*Vector:* call the webhook endpoint with a fake payload, or replay a real one.

*Controls:*
- HMAC signature verification with `PAYMENT_WEBHOOK_TOLERANCE_SECONDS` replay
  window.
- `webhook_events` idempotency keys make replays no-ops.
- Status transitions are validated — a `pending` payment cannot jump straight to
  `captured` without a verified event.
- Reconciliation re-polls the gateway, so a *missed* webhook self-heals and a
  forged one does not survive.

*Residual risk:* low, assuming the webhook secret stays secret.

### T5 — Session theft

*Vector:* steal a refresh token, reuse a logged-out token.

*Controls:*
- Refresh tokens are opaque, stored as sha256 hashes — the plaintext is never in
  the database.
- Rotation on every use; a reused old token is detectable.
- `HttpOnly`, `Secure` (`COOKIE_SECURE=true` in production), `SameSite` cookies.
- Access tokens are short-lived (`ACCESS_TOKEN_TTL`, default 15m).

*Residual risk:* low; the main failure mode is missing HTTPS, which
`COOKIE_SECURE=true` would expose immediately.

### T6 — Credential stuffing / brute force

*Controls:* `@fastify/rate-limit` globally, `login_attempts` per email,
`BCRYPT_ROUNDS` (default 12) plus `PASSWORD_PEPPER`.

*Residual risk:* medium. There is no CAPTCHA and no IP reputation. Rate limits are
the only defence.

### T7 — Privilege escalation

*Controls:* role → permission resolution (`services/rbac.service.ts`),
`requireAdmin` / `requirePermission` guards, and `audit_logs` for privileged
actions.

*Residual risk:* medium. Every admin action must be audited —
`audit.service.ts` is the place to verify new admin routes call it.

### T8 — Injection

*Controls:* Drizzle parameterises all queries; Zod validates all input at the
route boundary. There is no string-concatenated SQL.

*Residual risk:* low. Danger is limited to raw SQL added later — use parameter
binding if that ever happens.

### T9 — XSS

*Controls:* React escaping everywhere. `dangerouslySetInnerHTML` is banned with
one audited exception: the server-rendered QR SVG.

*Residual risk:* low.

### T10 — CSRF

*Controls:* CORS restricted to `WEB_ORIGIN`, `SameSite` cookies, and a JSON-only
API (no form encoding).

*Residual risk:* low.

### T11 — Secret exposure

*Controls:* Doppler at runtime; `.env*` gitignored; gitleaks in CI.

*Residual risk:* medium. The risk is operational — printing env files, pasting
tokens into chat, or committing by accident. Rotation procedure:
[secrets management](SECRETS_MANAGEMENT.md).

### T12 — Email abuse

*Controls:* `MAIL_HOURLY_SEND_LIMIT`, per-recipient suppression, preferences,
rate limits, dedupe keys.

*Residual risk:* low-medium; a compromised admin could still send a campaign.

## Explicitly out of scope

- Nation-state attackers.
- Physical host access (assumed trusted).
- Compromise of the upstream dataset repository.

## Related

- [Security audit](SECURITY_AUDIT.md)
- [Authentication](AUTHENTICATION.md)
- [Authorization](AUTHORIZATION.md)
- [Payment security](../payments/PAYMENT_SECURITY.md)
- [SECURITY.md](../../SECURITY.md)
