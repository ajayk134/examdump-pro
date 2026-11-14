# Deployment runbook — Oracle Cloud VM

How ExamDump Pro is deployed on the production host: **native systemd services**,
host nginx, native PostgreSQL 16, Doppler for secrets.

The authoritative, host-specific procedure lives in
[PRODUCTION.md](deployment/PRODUCTION.md); this page is the general runbook.

## 0. Prerequisites

- A VM with at least 2 vCPU / 4 GB RAM.
- A domain or subdomain (e.g. `examdump.example.com`) with a DNS **A record** to
  the VM's public IP.
- PostgreSQL 16 installed natively (`dnf module enable postgresql:16`).
- Node.js 22 installed for building and running the application.
- nginx installed natively, owning :80/:443.
- A **read-only** GitHub fine-grained token for the private `exam-data` repo
  (Contents: Read).
- A Doppler account/project. Production values go in `examdump-pro/prd`.

## 1. Install tooling (Oracle Linux / RHEL)

```bash
sudo dnf update -y
sudo dnf install -y git curl nginx certbot python3-certbot-nginx
sudo dnf module enable -y postgresql:16
sudo dnf install -y postgresql-server postgresql
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql nginx
```

Node 22 is installed via nvm for the build user and pinned to
`/opt/examdump-pro/node` for the service runtime.

## 2. Configure secrets in Doppler

Create a project (e.g. `examdump-pro`) and a `prd` config, then set the values
listed in [`deploy/.env.production.example`](../deploy/.env.production.example).
At minimum:

```bash
doppler secrets set \
  DATABASE_URL='postgres://examdump:pass@host:5432/examdump' \
  JWT_ACCESS_SECRET="$(openssl rand -hex 48)" \
  JWT_REFRESH_SECRET="$(openssl rand -hex 48)" \
  PASSWORD_PEPPER="$(openssl rand -hex 32)" \
  GITHUB_TOKEN='...' \
  PUBLIC_WEB_URL='https://examdump.example.com' \
  PUBLIC_API_URL='https://examdump.example.com' \
  WEB_ORIGIN='https://examdump.example.com' \
  ADMIN_EMAIL='admin@example.com' ADMIN_PASSWORD='...' \
  --project examdump-pro --config prd
```

Tip: `doppler secrets upload file.env --project ... --config prd` avoids putting
values in shell history.

## 3. Clone and start

```bash
sudo mkdir -p /opt/examdump && sudo chown "$USER" /opt/examdump
git clone https://github.com/ajayk134/examdump-pro.git /opt/examdump
cd /opt/examdump/deploy

# 3a. First boot over HTTP (default nginx.conf does NOT require certificates)
# build, deploy and restart — see ../../DEPLOYMENT.md for the full sequence
sudo systemctl restart examdump-api examdump-web

# 3b. Verify
curl -fsS http://127.0.0.1/api/health
curl -fsS http://127.0.0.1/api/health/ready
```

The API creates default plans, settings and the admin account on first boot. If
the catalogue is empty it also performs an initial GitHub sync in the
background (watch `journalctl -u examdump-api -f`).

Open `http://<vm-ip>/` to confirm the site loads.

## 4. Enable HTTPS

```bash
# The compose file bind-mounts the host path /var/www/certbot into nginx.
sudo mkdir -p /var/www/certbot

# Issue a certificate using that webroot
sudo certbot certonly --webroot -w /var/www/certbot \
  -d examdump.example.com --email admin@example.com --agree-tos --no-eff-email

# Switch nginx to the TLS config (update server_name first)
cp nginx/nginx.ssl.conf.example nginx/nginx.conf
sed -i 's/your-domain.com/examdump.example.com/g' nginx/nginx.conf
sudo systemctl reload nginx
```

Add a renewal timer:

```bash
echo '0 3 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"' \
  | sudo tee /etc/cron.d/examdump-certbot
```

Update Doppler: `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `WEB_ORIGIN` to `https://…`
and restart the API (`sudo systemctl restart examdump-api`) so cookies use `Secure`.

## 5. Firewall

```bash
# Oracle Cloud: also open 80/443 in the VCN Security List.
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

Do **not** publish ports 4000/3000 publicly — only nginx binds 80/443.

## 6. Operate

```bash
cd /opt/examdump/deploy

# Logs
journalctl -u examdump-api -f
journalctl -u examdump-web -f
journalctl -u nginx -f

# Update to the latest main
cd /opt/examdump && git pull
cd deploy && # build, deploy and restart — see ../../DEPLOYMENT.md for the full sequence
sudo systemctl restart examdump-api examdump-web

# Restart one service
sudo systemctl restart examdump-api
```

### Backups

`/usr/local/bin/examdump-backup` runs native `pg_dump` against the local cluster and keeps
`BACKUP_RETENTION_DAYS` days:

```bash
cd /opt/examdump/deploy
export DATABASE_URL="$(doppler secrets get DATABASE_URL --plain --project examdump-pro --config prd)"
./backup.sh
# cron: 30 2 * * * root /opt/examdump/deploy/backup.sh >> /var/log/examdump-backup.log 2>&1
```

Restore with `./restore.sh <archive>` (see script header).

### Monitoring

- Container healthchecks are defined for the API.
- Point an external uptime monitor at `https://<domain>/api/health/ready`.
- Ship logs to your log platform of choice (systemd journal, JSON via pino).
- The admin console exposes user, revenue, subscription and catalogue counters.

### Migrations

Run pending data migrations as part of a release (before restarting the API):

```bash
cd /opt/examdump
doppler run --project examdump-pro --config prd -- npm ci
doppler run --project examdump-pro --config prd -- npm run migrate -w @examdump/api
```

### Optional: prebuilt images (CD)

`.github/workflows/release.yml` builds and pushes
`ghcr.io/<owner>/examdump-pro-api` and `ghcr.io/<owner>/examdump-pro-web` on
version tags (`v*`) or manual dispatch. To use them instead of building on the VM,
publish the build output and deploy it by copying the artifacts as described in
[PRODUCTION.md](deployment/PRODUCTION.md).

### Scaling

The API is stateless. To scale on a larger VM, run multiple `api` replicas behind
nginx (define an upstream block) and, if GitHub reads become a bottleneck, add a
shared Redis cache.

## Troubleshooting quick checks

```bash
systemctl status examdump-api examdump-web nginx postgresql
journalctl -u examdump-api -n 100
curl -fsS http://127.0.0.1/api/health/ready
```

- `503` readiness → PostgreSQL URI/credentials or Atlas IP allowlist.
- `502 DATASET_*` → invalid/expired `GITHUB_TOKEN`, wrong owner/repo/branch.
- Emails not arriving → configure `SMTP_*`; until then dev links only appear
  outside production.

## Safety notes

- The compose file refuses to read secrets from the repo; they are injected by
  Doppler at run time.
- Never drop the `examdump` database on production unless you intend to delete the
  certbot volume.
- Back up before schema-affecting releases.
- Do not deploy over existing unrelated services on this VM — the stack uses its
  own network and only binds 80/443.