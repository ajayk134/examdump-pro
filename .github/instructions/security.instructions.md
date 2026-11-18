---
applyTo: "apps/api/src/lib/**,apps/api/src/config/env.ts,apps/api/src/routes/auth.ts,apps/api/src/routes/payments.ts,apps/api/src/services/auth.service.ts,apps/api/src/services/payments/**,apps/api/src/services/mail/**,apps/web/lib/api.ts,apps/web/lib/api-base.ts,.github/workflows/**"
---

# Security instructions

Security-sensitive code includes auth, sessions, environment validation, payment
webhooks, mail credentials, browser API handling, and CI secret scanning.

## Secrets

- The source of truth is Doppler project `examdump-pro`, config `prd`. The host
  renders `/etc/examdump-pro/production.env` (`0640 root:examdump`).
- Never commit, print, log, paste, or echo a secret. Do not `cat` the production
  env file or run `env` in a production shell. Check presence only.
- Never put a secret in a `NEXT_PUBLIC_*` variable; those are bundled into the
  browser.
- `.env.example` and `apps/web/.env.local.example` are templates. They must not
  contain real values.
- `doppler.yaml` currently points at a non-production config. Use explicit
  `--project examdump-pro --config prd` flags.

## Authentication and sessions

- Access token: HS256 JWT, 15-minute default, `ed_access` HttpOnly cookie at `/`,
  with Bearer fallback for API clients.
- Refresh token: opaque random value, stored only as a hash in `sessions`,
  `ed_refresh` HttpOnly cookie at `/api/auth`, rotated on refresh.
- Cookies are `SameSite=Lax` and `Secure` in production. Do not weaken these
  flags or move tokens to JavaScript-readable storage.
- `requireAuth` verifies the JWT and loads both the user and session. Keep the
  suspended/deleted-user and revoked/expired-session checks.
- Passwords use bcrypt with the configured pepper and rounds. Do not add a second
  password hashing path.
- Rate-limit auth and sensitive endpoints; preserve the per-route limits.
- CORS allows exact origins from `WEB_ORIGIN` with credentials. Never use `*` for
  a credentialed origin.

## Logging and error handling

- `apps/api/src/app.ts` redacts sensitive query parameters, authorization/cookie
  headers, and password/token fields. Do not bypass the serializer or add logs
  that include raw bodies, cookies, tokens, or env values.
- Return `{ error: { code, message, details? } }`. Do not leak stack traces,
  provider responses, SQL, or secret fragments to clients.
- Log failures with enough context to diagnose, but never log the secret itself.

## Webhooks and raw bodies

- Payment signatures cover the exact bytes sent by the provider. `app.ts` captures
  `request.rawBody` before JSON parsing; preserve that parser.
- Verify the signature **before** any idempotency shortcut or settlement.
- YouPI uses HMAC-SHA256 with a timestamped V2 signature and replay tolerance.
- HyperSwitch uses the configured HMAC-SHA512 header and a server-to-server status
  fetch before settlement.
- Razorpay verifies its signature and re-fetches the payment server-side.
- A browser redirect, query parameter, or client-supplied status never settles a
  payment.

## Input, output, and data access

- Validate all external input with Zod. Do not trust IDs, amounts, plans, roles,
  limits, or URLs from the client.
- Use Drizzle query builders or parameterised SQL. Never interpolate input into
  `sql.unsafe`.
- Do not use `dangerouslySetInnerHTML` for untrusted or model-generated content.
- Dataset URLs come from validated configuration, not user input; do not add an
  arbitrary-URL fetch path.
- Do not add dependencies without checking maintenance and supply-chain risk.

## CI and dependencies

- `.github/workflows/ci.yml` runs gitleaks. Keep it enabled.
- Never add a real credential to a workflow, test, fixture, or log.
- Do not disable secret scanning or allowlist broad paths to make a check pass.

If you find a suspected secret in the repository or logs, stop, do not repeat it
in chat, and report it to the repository owner.
