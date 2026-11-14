# Environment variables (deployment view)

The full grouped reference lives in one place: **[docs/ENVIRONMENT.md](../ENVIRONMENT.md)**.
That file lists every variable with its default and intent. This page covers only
what differs when you are deploying.

## Required in production

Everything marked **R** in the reference, plus at minimum:

```
NODE_ENV=production
WEB_ORIGIN=https://<domain>
PUBLIC_WEB_URL=https://<domain>
PUBLIC_API_URL=https://<domain>/api
DATABASE_URL=postgres://<user>:<pass>@postgres:5432/<db>
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / PASSWORD_PEPPER
COOKIE_SECURE=true
GITHUB_TOKEN
```

`PAYMENTS_ENABLED=false` and `UPI_AUTO_APPROVE=false` unless explicitly going live.

## Injection at deploy time

```bash
cd deploy
doppler run --project examdump-pro --config prd -- \
  sudo systemctl restart examdump-api examdump-web
```

**`sudo` strips exported variables.** Production does not read the calling shell
at all: the systemd units load `/etc/examdump-pro/production.env`. Update that
file and restart the units.

## Hostname coupling

`DATABASE_URL` must use the host **`127.0.0.1`** — the native cluster listens on
loopback only, and `localhost` can resolve to `::1` first.

Two database credentials exist and must not be confused:

| Key | Role | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `examdump` | API runtime. No `SUPERUSER`, no `CREATE`. |
| `MIGRATION_DATABASE_URL` | `examdump_migrator` | `npm run migrate` only. |

The API never reads `MIGRATION_DATABASE_URL`.

## Why Doppler and not `.env`

- No secret file on disk to leak, copy or accidentally commit.
- One source of truth for dev and production.
- Rotation takes effect on the next restart.

`.env` remains supported for local development only and is gitignored.

## Checking a value without revealing it

```bash
printenv NAME >/dev/null && echo set || echo missing
```

Never `cat` an env file or echo a secret into a terminal.

## Adding a new variable

1. Add it to `apps/api/src/config/env.ts` with a Zod rule **and a default** where
   sensible.
2. Add the name (no value) to `.env.example`.
3. Set the real value in Doppler.
4. Add it to `/etc/examdump-pro/production.env` for the service that needs it.
5. Document it in [docs/ENVIRONMENT.md](../ENVIRONMENT.md).
6. Restart the API and verify.

A variable in Doppler that compose does not forward is invisible to the
container — the most common cause of "I set it but nothing changed".

## Related

- [Environment reference](../ENVIRONMENT.md)
- [Production](PRODUCTION.md)
- [Secrets management](../security/SECRETS_MANAGEMENT.md)
