# Authentication

Implemented in `apps/api/src/services/auth.service.ts`,
`apps/api/src/lib/{jwt,tokens,passwords,cookies,guards}.ts`, and
`apps/api/src/routes/auth.ts`.

## Token model

Two tokens with different lifetimes and storage:

| Token | Format | Lifetime | Storage |
| --- | --- | --- | --- |
| Access | JWT, HS256 | `ACCESS_TOKEN_TTL` (15m) | returned in JSON, held by the client in memory |
| Refresh | opaque random 32 bytes | `REFRESH_TOKEN_TTL_DAYS` (30d) | `HttpOnly` cookie; sha256 hash in `sessions` |

The access token is a JWT because it is verified on every request without a
database round-trip. The refresh token is opaque so it can be revoked — a JWT
cannot.

**Rotation.** Every refresh call issues a new opaque token and invalidates the
previous one. Presenting an already-rotated token is evidence of theft; the
session can be revoked rather than silently renewed.

**Storage.** Only `sha256(refresh_token)` is persisted (`lib/tokens.ts`,
`hashToken`). A database leak does not yield usable sessions.

## Password handling

```
bcrypt(password + PASSWORD_PEPPER, BCRYPT_ROUNDS=12)
```

The pepper is an application secret (`env.PASSWORD_PEPPER`) stored in Doppler,
never in the database. It is appended before hashing so a database-only
compromise cannot be brute-forced offline without also obtaining the pepper.

Comparison uses `safeEqual` (constant-time) for token and hash comparisons.

## Flows

### Registration

1. Validate with a Zod schema.
2. Reject if the email exists (generic response — no account enumeration).
3. Hash password, insert `users`, assign the default role.
4. Insert `auth_tokens` (type `email_verify`, hashed, expiring).
5. Enqueue a verification email.
6. Return access token + set refresh cookie.

### Email verification

`GET /api/auth/verify-email?token=...` hashes the presented token and looks it up.
Tokens are single-use and expire; the row is consumed on success.

Unverified users can log in but `requireVerified` guards sensitive routes.
Practising is permitted to reduce signup friction.

### Login

1. Rate limited globally; `login_attempts` records each attempt.
2. Verify password.
3. Create a `sessions` row, set the refresh cookie, return the access token.

Failure responses are identical for "unknown email" and "wrong password".

### Refresh

Read the cookie → hash → look up a non-revoked, unexpired session → rotate →
issue a new access token.

### Logout

Revoke the session row and clear the cookie. Because sessions are
database-backed, logout is immediate and server-enforced.

### Password reset

`auth_tokens` type `password_reset`, single use, short expiry. On success, **all**
sessions for that user are revoked — a reset implies the old credential may be
compromised.

### Google sign-in

OIDC via `google-auth-library`. The ID token is verified server-side, then the
user is matched or created by verified email. The client secret stays on the
server. Password login still works if Google is unconfigured.

## Guards

From `apps/api/src/lib/guards.ts`:

| Guard | Behaviour |
| --- | --- |
| `optionalAuth` | returns `AuthContext \| null`, never throws |
| `requireAuth` | throws 401 without a valid access token |
| `requireVerified` | throws 403 unless the email is verified |
| `requireAdmin` | throws 403 unless role is admin |
| `requirePermission` | throws 403 unless the user holds a specific permission |

Each route declares its guard explicitly. There is no global "authenticated by
default" — that would be safer but is not what the code does, so **new routes must
add their guard deliberately.**

## Session lifecycle

```
login      → sessions row created
refresh    → row rotated (old hash replaced)
logout     → revoked_at set
password reset → all rows for the user revoked
expiry     → REUSE denied once expires_at passes
```

## Related

- [Authorization](AUTHORIZATION.md)
- [Threat model](THREAT_MODEL.md)
- [Secrets management](SECRETS_MANAGEMENT.md)
- [AUTH.md](../../AUTH.md)
