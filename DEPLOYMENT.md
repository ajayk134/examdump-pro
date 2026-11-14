# Deployment

Single Oracle Cloud VM (`meshcentral`), **native systemd services**, native
PostgreSQL 16, host nginx for TLS, Doppler for secrets. No Docker, no Podman, no
container runtime of any kind.

> **Detailed:** [docs/deployment/PRODUCTION.md](docs/deployment/PRODUCTION.md) ·
> [operations runbook](docs/OPERATIONS.md)

## Services

| Unit | Runs as | Listens | Purpose |
|---|---|---|---|
| `examdump-api.service` | `examdump` | `127.0.0.1:4000` | Fastify API (`node dist/index.js`) |
| `examdump-web.service` | `examdump` | `127.0.0.1:3000` | Next.js frontend (`node apps/web/server.js`) |
| `postgresql.service` | `postgres` | `127.0.0.1:5432` | PostgreSQL 16 cluster |
| `nginx.service` | `nginx` | `0.0.0.0:80,443` | TLS termination + reverse proxy |
| `certbot-renew.timer` | root | — | Let's Encrypt renewal |

Only nginx is reachable from the internet. The API, web server and database bind
to loopback.

## Layout

```
/opt/examdump-pro/node        pinned Node 22 runtime (v22.23.5)
/opt/examdump-pro/api         dist/, migrations/, node_modules/, package.json
/opt/examdump-pro/web         Next.js standalone output
/etc/examdump-pro/production.env   env file, 0640 root:examdump, from Doppler
/var/lib/pgsql/data           PostgreSQL 16 data directory
/var/backups/examdump         nightly pg_dump, 14-day retention
```

## Deploy a new build

```bash
cd ~/projects/examdump-pro
export NVM_DIR=~/.nvm && . ~/.nvm/nvm.sh && nvm use 22

# build
npm run build -w @examdump/shared
npm run build -w @examdump/data-client
npm run build -w @examdump/api
npm run build -w @examdump/web

# API
sudo rm -rf /opt/examdump-pro/api/dist
sudo cp -r apps/api/dist /opt/examdump-pro/api/dist
sudo cp -r apps/api/src/db/migrations /opt/examdump-pro/api/migrations
sudo chown -R examdump:examdump /opt/examdump-pro/api
sudo systemctl restart examdump-api

# Web (standalone)
sudo rm -rf /opt/examdump-pro/web/*
sudo cp -r apps/web/.next/standalone/. /opt/examdump-pro/web/
sudo cp -r apps/web/.next/static /opt/examdump-pro/web/apps/web/.next/static
sudo chown -R examdump:examdump /opt/examdump-pro/web
sudo systemctl restart examdump-web
```

Migrations run automatically at API start (`node dist/migrate.js && node
dist/index.js` is no longer used — the unit runs `dist/index.js`, and the
migration step is run explicitly when a new migration is added):

```bash
sudo -u examdump env $(sudo cat /etc/examdump-pro/production.env | grep -v '^#' | xargs) \
  /opt/examdump-pro/node/bin/node /opt/examdump-pro/api/dist/migrate.js
```

## Environment variables

Values live in **Doppler**, project `examdump-pro`, config `prd`. The file
`/etc/examdump-pro/production.env` is a rendered copy that systemd loads. Refresh
it after changing a Doppler value:

```bash
doppler secrets download --project examdump-pro --config prd --no-file --format env \
  | sed -e 's#^DATABASE_URL=.*#DATABASE_URL=postgres://examdump:<password>@127.0.0.1:5432/examdump#' \
        -e 's#^API_HOST=.*#API_HOST=127.0.0.1#' \
        -e 's#^MIGRATIONS_DIR=.*#MIGRATIONS_DIR=/opt/examdump-pro/api/migrations#' \
  | sudo tee /etc/examdump-pro/production.env >/dev/null
sudo chmod 640 /etc/examdump-pro/production.env
sudo chown root:examdump /etc/examdump-pro/production.env
sudo systemctl restart examdump-api examdump-web
```

Three keys are **not** in Doppler and must be present in the file:
`API_HOST=127.0.0.1`, `API_PORT=4000`, `UPI_AUTO_APPROVE=false`. Payments stay
off: `PAYMENTS_ENABLED=false`.

## Health checks

```bash
systemctl is-active nginx postgresql examdump-api examdump-web
curl -s http://127.0.0.1:4000/api/health      # {"status":"ok","database":"connected"}
curl -s -o /dev/null -w '%{http_code}\n' https://examtopicspro.duckdns.org/
```

## Restart

```bash
sudo systemctl restart examdump-api     # API only
sudo systemctl restart examdump-web     # frontend only
sudo systemctl reload nginx             # config change, no dropped connections
```

## Rollback

```bash
sudo systemctl stop examdump-api examdump-web    # take app out of service
cd ~/projects/examdump-pro && git checkout <previous-commit>
# rebuild and redeploy as above, or restore the database (below)
sudo systemctl start examdump-api examdump-web
```

Database rollback:

```bash
sudo systemctl stop examdump-api examdump-web
sudo -u postgres dropdb examdump && sudo -u postgres createdb -O examdump examdump
cat /var/backups/examdump/<file>.pgdump | sudo -u postgres pg_restore -d examdump \
  --no-owner --no-privileges
sudo systemctl start examdump-api examdump-web
```
