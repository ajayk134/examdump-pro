---
applyTo: "deploy/**"
---
# Deployment rules (deploy/)

Production is a single host on Oracle Cloud running **native systemd services**:
`nginx`, `examdump-api`, `examdump-web`, `postgresql`. No containers. A rootless
Podman store exists on the same machine for the unrelated Omniroute app and has
nothing to do with ExamDump.

## Deploy

```bash
cd deploy
doppler run --project examdump-pro --config prd -- \
  sudo systemctl restart examdump-api examdump-web
```

- Secrets come from Doppler. Never write them into compose, Dockerfiles or
  `.env` files that get committed.
- Production runs under systemd; the legacy compose file is unused. Historic note: it declares network aliases `postgres` and
  `api`. Removing them breaks `DATABASE_URL` resolution and nginx's upstream.
- `POSTGRES_PASSWORD` must be injectable or compose aborts. Note that `sudo`
  strips exported shell variables, so do not rely on `sudo env FOO=$BAR`.

## After recreating the API container

nginx resolves `server api:4000` **once at startup** and caches the IP. Recreate
the API without reloading nginx and the site 502s while the API itself is healthy.

```bash
sudo systemctl reload nginx
```

## Safety

- Never delete a volume before proving a restore into a throwaway database works.
- Never touch containers or volumes belonging to other services on the host.
  Some hold unrecoverable OAuth credentials.
- Keep `PAYMENTS_ENABLED=false` and `UPI_AUTO_APPROVE=false` unless a human
  explicitly asks to enable them.
- Dockerfiles must run as a non-root user and avoid baking secrets into layers.

Full procedures: `docs/OPERATIONS.md` and `docs/DEPLOYMENT.md`.
