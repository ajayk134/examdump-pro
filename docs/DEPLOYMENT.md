# Deployment runbook — Oracle Cloud VM

This describes a single-VM deployment with Docker/Podman Compose, nginx, Doppler
and MongoDB Atlas. Nothing here overwrites existing services; choose free ports
and a dedicated directory.

## 0. Prerequisites

- A VM with at least 2 vCPU / 4 GB RAM (Oracle Ampere or AMD is fine).
- A domain or subdomain (e.g. `examdump.example.com`) with a DNS **A record** to
  the VM's public IP.
- A MongoDB Atlas cluster and database user. In Atlas → *Network Access*, allow
  the VM's public IP.
- A **read-only** GitHub fine-grained token for the private `exam-data` repo
  (Contents: Read).
- A Doppler account/project. Production values go in `examdump-pro/prd`.

## 1. Install tooling (Oracle Linux / RHEL)

```bash
sudo dnf update -y
sudo dnf install -y git curl podman podman-compose
# Optional (recommended): native Docker Engine + compose plugin instead of podman.
# sudo dnf install -y dnf-plugins-core && ... (follow Docker's RHEL guide)

# Doppler CLI
curl -Ls https://cli.doppler.com/install.sh | sudo sh

# Certbot (for TLS)
sudo dnf install -y certbot
```

Log in to Doppler: `doppler login` (or use a service token).

## 2. Configure secrets in Doppler

Create a project (e.g. `examdump-pro`) and a `prd` config, then set the values
listed in [`deploy/.env.production.example`](../deploy/.env.production.example).
At minimum:

```bash
doppler secrets set \
  MONGODB_URI='...' MONGODB_DB='examdump' \
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
doppler run --project examdump-pro --config prd -- podman compose up -d --build

# 3b. Verify
curl -fsS http://127.0.0.1/api/health
curl -fsS http://127.0.0.1/api/health/ready
```

The API creates default plans, settings and the admin account on first boot. If
the catalogue is empty it also performs an initial GitHub sync in the
background (watch `podman compose logs -f api`).

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
podman compose restart nginx
```

Add a renewal timer:

```bash
echo '0 3 * * * root certbot renew --quiet && cd /opt/examdump/deploy && podman compose exec nginx nginx -s reload' \
  | sudo tee /etc/cron.d/examdump-certbot
```

Update Doppler: `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `WEB_ORIGIN` to `https://…`
and restart the API (`podman compose up -d api`) so cookies use `Secure`.

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
podman compose logs -f api
podman compose logs -f web
podman compose logs -f nginx

# Update to the latest main
cd /opt/examdump && git pull
cd deploy && doppler run --project examdump-pro --config prd -- podman compose up -d --build

# Restart one service
podman compose restart api
```

### Backups

`deploy/backup.sh` uses `mongodump` via a disposable `mongo:7` container and keeps
`BACKUP_RETENTION_DAYS` days:

```bash
cd /opt/examdump/deploy
export MONGODB_URI="$(doppler secrets get MONGODB_URI --plain --project examdump-pro --config prd)"
./backup.sh
# cron: 30 2 * * * root /opt/examdump/deploy/backup.sh >> /var/log/examdump-backup.log 2>&1
```

Restore with `./restore.sh <archive>` (see script header).

### Monitoring

- Container healthchecks are defined for the API.
- Point an external uptime monitor at `https://<domain>/api/health/ready`.
- Ship container logs to your log platform of choice (JSON logs via pino).
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
replace the `build:` sections in `docker-compose.yml` with `image:` references
and run `podman compose pull`.

### Scaling

The API is stateless. To scale on a larger VM, run multiple `api` replicas behind
nginx (define an upstream block) and, if GitHub reads become a bottleneck, add a
shared Redis cache.

## Troubleshooting quick checks

```bash
podman compose ps
podman compose logs --tail=100 api
curl -fsS http://127.0.0.1/api/health/ready
```

- `503` readiness → MongoDB URI/credentials or Atlas IP allowlist.
- `502 DATASET_*` → invalid/expired `GITHUB_TOKEN`, wrong owner/repo/branch.
- Emails not arriving → configure `SMTP_*`; until then dev links only appear
  outside production.

## Safety notes

- The compose file refuses to read secrets from the repo; they are injected by
  Doppler at run time.
- Never run `podman compose down -v` on production unless you intend to delete the
  certbot volume.
- Back up before schema-affecting releases.
- Do not deploy over existing unrelated services on this VM — the stack uses its
  own network and only binds 80/443.