---
applyTo: ".github/workflows/**,package.json,apps/api/package.json,apps/web/package.json,apps/api/tsup.config.ts,apps/web/next.config.mjs,doppler.yaml,.env.example"
---

# Deployment and operations instructions

Production is a single Oracle Cloud host running **native systemd services**.
There is no staging, no container path for this app, and no backup automation in
the repository.

## Live topology

```text
nginx :80/:443
  └── web  127.0.0.1:3000   Next.js standalone (node apps/web/server.js)
  └── api  127.0.0.1:4000   Fastify (node dist/index.js)
        └── PostgreSQL 16  127.0.0.1:5432
```

- Units: `nginx`, `examdump-api`, `examdump-web`, `postgresql`.
- Runtime root: `/opt/examdump-pro`.
- Pinned Node: `/opt/examdump-pro/node/bin/node` (v22.23.5).
- API: `/opt/examdump-pro/api/{dist,migrations,node_modules}`.
- Web: `/opt/examdump-pro/web/apps/web/server.js`.
- Env: `/etc/examdump-pro/production.env` (`0640 root:examdump`), rendered from
  Doppler `examdump-pro/prd`.

Do not look for a Docker/Podman container for this app. Rootless Podman on the
host belongs to an unrelated service.

## Build

Use Node 22 for parity with production. Build from a clean checkout:

```bash
npm ci
NEXT_PUBLIC_API_URL='' npm run build
```

`npm run build` builds shared → data-client → API → web. The API uses `tsup`
(`dist/index.js`, `dist/migrate.js`, `dist/seed.js`). The web app uses Next.js
`output: 'standalone'`.

Never bake a loopback `NEXT_PUBLIC_API_URL` into a production bundle.
`apps/web/lib/api-base.ts` ignores loopback values when `NODE_ENV=production`, but
the build should not contain one in the first place.

## Deploy (manual; no tracked script)

1. Confirm the target commit and that `npm run typecheck` and the relevant tests
   pass.
2. Build with Node 22.
3. Back up the current `dist`/`web` directory (the host keeps timestamped
   `api.prev-dist-*` and `web.prev-*` copies).
4. Copy `apps/api/dist` and `apps/api/src/db/migrations` into
   `/opt/examdump-pro/api`, then `chown -R examdump:examdump`.
5. Copy `apps/web/.next/standalone` into `/opt/examdump-pro/web`, plus
   `.next/static` into `web/apps/web/.next/static` and `public` if present.
6. Apply migrations **before** restarting the API. The production `examdump`
   role cannot create tables or write the Drizzle history, so apply the pending
   SQL as `postgres` and record the journal row in the same transaction.
7. `systemctl restart examdump-api`, verify `/api/health/ready`.
8. `systemctl restart examdump-web`, verify the public site.

Run one pending migration with the exact journal timestamp and file hash:

```bash
migration=0009_community
hash=$(sha256sum "/opt/examdump-pro/api/migrations/$migration.sql" | cut -d' ' -f1)
when=$(node -p "require('/opt/examdump-pro/api/migrations/meta/_journal.json').entries.find(e => e.tag === '$migration').when")

sudo -u postgres psql -d examdump -v ON_ERROR_STOP=1 -1 <<SQL
\i /opt/examdump-pro/api/migrations/$migration.sql
insert into drizzle.__drizzle_migrations ("hash", "created_at") values ('$hash', $when);
SQL
```

A plain service-env run of `dist/migrate.js` fails with
`permission denied for database examdump` because the application role is not
the database owner. Do not grant it broad DDL rights just to run a migration.

## Verify

```bash
systemctl is-active nginx postgresql examdump-api examdump-web
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:4000/api/health/ready
curl -fsS -o /dev/null -w '%{http_code}\n' https://examtopicspro.duckdns.org/
journalctl -u examdump-api -n 100 --no-pager
```

A git checkout is not a deployment. Prove the running service has the change.

## Guardrails

- Do not change production payments, gateway credentials, or enable a provider
  without explicit authorization.
- Do not modify `/etc/examdump-pro/production.env` or Doppler values as part of a
  code change. Never overwrite production config from a template.
- Do not drop, truncate, restore, or reset the production database.
- Do not restart or modify `postgresql`, `nginx`, or YouPI-PG unless the task
  requires it.
- Do not touch `ajayk134/examdump`, `ajayk134/exam-data`, Cloudflare, Netlify, or
  unrelated host services.
- Rollback is manual: restore the previous app directory and restart the unit.
  There is no automated database rollback.

## CI

`.github/workflows/ci.yml`:

- installs with `npm ci`;
- builds shared/data-client;
- runs `npm run typecheck`;
- runs shared, data-client, and API tests against ephemeral
  `postgres:16-alpine`;
- builds API and web with `NEXT_PUBLIC_API_URL=''`;
- runs gitleaks.

CI does **not** run `apps/web/test`. Run web tests locally for frontend changes.
