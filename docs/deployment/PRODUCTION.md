# Production deployment

How ExamDump Pro actually runs on the production host.

## Topology

```
Internet :80/:443
      │
      ▼
nginx.service                 host nginx 1.20, systemd
  ├── /api/*            → 127.0.0.1:4000   examdump-api.service
  ├── /api/ai/chat/*    → 127.0.0.1:4000   (streaming, buffering off)
  ├── /api/payments/webhook/* → 127.0.0.1:4000
  └── /*                → 127.0.0.1:3000   examdump-web.service
                                    │
                                    ▼
                        postgresql.service  127.0.0.1:5432
                        /var/lib/pgsql/data · database `examdump`
```

Four systemd units, no container runtime. The API and web server bind to
loopback; only nginx holds :80 and :443.

## Components

| Component | Detail |
|---|---|
| API | Node 22.23.5, `/opt/examdump-pro/api/dist/index.js`, user `examdump` |
| Web | Next.js 15 standalone, `/opt/examdump-pro/web`, user `examdump` |
| Database | PostgreSQL 16.15, cluster `/var/lib/pgsql/data`, roles `examdump` (runtime) and `examdump_migrator` (DDL) |
| Proxy | nginx, vhost `/etc/nginx/conf.d/examdump.conf` |
| TLS | Let's Encrypt, `/etc/letsencrypt/live/examtopicspro.duckdns.org` |
| Secrets | Doppler `examdump-pro` / `prd` → `/etc/examdump-pro/production.env` |

## Secrets

Doppler is the single source of truth. The rendered env file is mode `0640`,
owned `root:examdump`, and readable only by the two service users. No secret is
passed on a command line, written to the repository or printed in logs.

`PAYMENTS_ENABLED=false` and `UPI_AUTO_APPROVE=false` in production.

## nginx notes specific to this host

- nginx 1.20 uses `listen 443 ssl http2;` — the `http2 on;` directive is 1.25+.
- SELinux is enforcing. `/etc/letsencrypt` is labelled `cert_t` and
  `/var/www/certbot` is `httpd_sys_content_t`; `httpd_can_network_connect` must be
  on so nginx may proxy to loopback ports.
- The ACME webroot is `/var/www/certbot`, shared with certbot.

## Backups

`/etc/cron.d/examdump-backup` runs `/usr/local/bin/examdump-backup` daily at
02:30. It dumps with `pg_dump --format=custom` over the local socket into
`/var/backups/examdump`, retaining 14 days. A failed dump leaves no partial file.

Manual run and verification:

```bash
sudo /usr/local/bin/examdump-backup
sudo sh -c 'pg_restore --list < /var/backups/examdump/<file>.pgdump' | head
```

Restore:

```bash
sudo systemctl stop examdump-api examdump-web
sudo -u postgres dropdb examdump && sudo -u postgres createdb -O examdump examdump
cat /var/backups/examdump/<file>.pgdump \
  | sudo -u postgres pg_restore -d examdump --no-owner --no-privileges
sudo systemctl start examdump-api examdump-web
```

## Host dependencies kept for another application

Rootless Podman is still installed for **Omniroute**, which runs as
`omniroute` and `omniroute-redis` in the `opc` user's rootless store. ExamDump
does not use it. Do not remove Podman without migrating Omniroute first.

## Database roles and privileges

Two login roles exist. Neither is a superuser and neither can create databases,
create roles, replicate, or bypass row-level security.

| Role | Used by | Grants |
| --- | --- | --- |
| `examdump` | `examdump-api` | `CONNECT` on `examdump`; `USAGE` on `public` and `drizzle`; `SELECT/INSERT/UPDATE/DELETE` on all application tables; `USAGE, SELECT` on all application sequences |
| `examdump_migrator` | `npm run migrate` only | `CONNECT` and `CREATE` on `examdump`; `USAGE, CREATE` on `public` and `drizzle`; `SELECT/INSERT/UPDATE` on `drizzle.__drizzle_migrations` |

Object ownership stays with `postgres`. The application role owns no table,
sequence or schema, so it cannot alter or drop schema objects. `ALTER DEFAULT
PRIVILEGES FOR ROLE postgres` grants the runtime privileges on objects the
migration role creates later, so a new table does not need a manual grant.

Migrations are **not** applied at boot: `examdump-api.service` runs
`dist/index.js` only. Run them explicitly with the migrator credential:

```bash
doppler run --project examdump-pro --config prd -- \
  sh -c 'DATABASE_URL="$MIGRATION_DATABASE_URL" npm run migrate -w @examdump/api'
```

Rotating the runtime password is a two-step change: update `DATABASE_URL` and
`POSTGRES_PASSWORD` in Doppler, re-render `/etc/examdump-pro/production.env`, then
`sudo systemctl restart examdump-api`.
