# Authentication

JWT access tokens + opaque rotating refresh tokens.

> **Detailed:** [docs/security/AUTHENTICATION.md](docs/security/AUTHENTICATION.md)

## Model

| Token | Format | Lifetime | Storage |
| --- | --- | --- | --- |
| Access | HS256 JWT | `ACCESS_TOKEN_TTL` (15m) | client memory, `Authorization: Bearer` |
| Refresh | opaque 48 bytes | `REFRESH_TOKEN_TTL_DAYS` (30d) | `HttpOnly` cookie; sha256 hash in `sessions` |

Access tokens verify by signature alone (no DB). Refresh tokens verify by a
`sessions` lookup, which is what makes revocation possible. Rationale:
[ADR-004](docs/decisions/ADR-004.md).

## Properties

- Refresh rotation on every use; a reused old token is detectable.
- Only `sha256(refresh_token)` is stored — a database leak yields no usable session.
- Password reset calls `revokeAllSessions(userId)`.
- Passwords: `bcrypt(password + PASSWORD_PEPPER, BCRYPT_ROUNDS)`.
- Comparisons use constant-time `safeEqual`.

## Guards

`apps/api/src/lib/guards.ts` — the only place authentication is decided:

| Guard | Behaviour |
| --- | --- |
| `optionalAuth` | returns context or null |
| `requireAuth` | 401 without a valid access token |
| `requireVerified` | 403 if email unverified |
| `requireAdmin` | 403 unless admin |
| `requirePermission(p)` | 403 unless the permission is held |

There is no global default — **new routes must declare a guard explicitly.**

## Flows

Register → verify email → login → refresh → logout. Password reset invalidates all
sessions. Google OIDC is optional and falls back to password login.

## Related

- [Authorization](docs/security/AUTHORIZATION.md)
- [Secrets](docs/security/SECRETS_MANAGEMENT.md)
- [API](API.md)
