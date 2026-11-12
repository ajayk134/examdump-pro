# Secrets management

All runtime secrets come from **Doppler** (`project: examdump-pro`,
`config: prd`). Nothing secret is ever committed, baked into an image, or printed.

## Sources of truth

| Where | What |
| --- | --- |
| Doppler `examdump-pro/prd` | every runtime secret |
| `.env.example` | variable **names** and shape only — no values |
| `apps/api/src/config/env.ts` | validation and defaults |
| `deploy/docker-compose.yml` | which variables each container receives |

`doppler.yaml` at the repo root currently points at `agent-keys/dev_personal`
(local development). Production uses the explicit `examdump-pro/prd` reference
shown below — do not rely on the bare `doppler run`.

## Usage

```bash
# development
doppler run --project examdump-pro --config prd -- npm run dev

# production deploy
cd deploy && doppler run --project examdump-pro --config prd -- \
  podman compose -p examdump-pro up -d --build
```

`sudo` **strips exported shell variables**, so `sudo env FOO=$BAR podman compose`
does not inject them reliably. Run compose as your own user with Doppler injecting
the environment, or use `doppler run` under the same user.

## Secret inventory (names only)

| Group | Variables |
| --- | --- |
| JWT / session | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PASSWORD_PEPPER` |
| Database | `POSTGRES_PASSWORD`, `DATABASE_URL` |
| GitHub dataset | `GITHUB_TOKEN` |
| Google OIDC | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| SMTP | `SMTP_USER`, `SMTP_PASS` |
| AI provider | `AI_API_KEY` |
| Hyperswitch | `HYPERSWITCH_API_KEY`, `HYPERSWITCH_ADMIN_API_KEY`, `HYPERSWITCH_WEBHOOK_SECRET` |
| Razorpay | `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| UPI observer | `UPI_GOOGLE_CLIENT_SECRET`, `UPI_GOOGLE_REFRESH_TOKEN`, `UPI_SMS_INGEST_SECRET` |
| Seed admin | `ADMIN_PASSWORD` |

`RAZORPAY_KEY_ID`, `HYPERSWITCH_MERCHANT_ID` and `UPI_PAYEE_VPA` are identifiers,
not secrets, but are still not committed.

## Rules

1. **Never print a secret.** To confirm presence, check the exit status:
   ```bash
   printenv NAME >/dev/null && echo set || echo missing
   ```
2. **Never commit `.env`.** Only `.env.example` is tracked.
3. **Never bake secrets into images.** They arrive via the environment at
   runtime; Docker layer history is readable.
4. **Never log a secret.** Pino redaction is not configured globally — do not log
   `request.body` on auth, payment or ingest routes.
5. **Never echo Doppler values into a shell history or a chat.** Use
   `doppler secrets get NAME --plain` only when piping directly into a command
   that needs it.
6. **gitleaks runs in CI.** A pasted token that reaches a commit is a leak even if
   the commit is later amended.

## Rotation

| Secret | Consequence of rotation |
| --- | --- |
| `JWT_ACCESS_SECRET` | all access tokens invalid immediately (users re-auth on next refresh) |
| `JWT_REFRESH_SECRET` | all refresh flows invalid; every user must log in again |
| `PASSWORD_PEPPER` | **all existing password hashes stop matching.** Only rotate with a coordinated re-hash plan or a forced password reset for everyone |
| `POSTGRES_PASSWORD` | must be changed in Docker, Doppler and `DATABASE_URL` together, then restart |
| `GITHUB_TOKEN` | dataset reads fail with `DatasetError` → 502 until updated |
| `AI_API_KEY` | AI endpoints fail; rest of app unaffected |
| SMTP / webhook secrets | mail or webhook verification fails until updated |

Rotation procedure:

1. Generate the new value and store it in Doppler.
2. Restart the API so it picks up the change (`podman compose up -d api`).
3. Verify: `/api/health`, then the specific feature.
4. Remove the old value at the provider once verified.

Never rotate `PASSWORD_PEPPER` casually — it is the one secret that is not
reversibly rotatable.

## Incident: suspected leak

1. Rotate the affected secret in Doppler.
2. Restart the API.
3. If session secrets leaked, also `revokeAllSessions` for affected users (or all
   users): `select * from sessions where revoked_at is null;`
4. Check `audit_logs` and `login_attempts` for the exposure window.
5. If a token reached a git commit, rotate first, then purge history — rotation
   is what actually stops the leak.

## Related

- [Threat model](THREAT_MODEL.md)
- [Environment variables](../deployment/ENVIRONMENT_VARIABLES.md)
- [Production deployment](../deployment/PRODUCTION.md)
