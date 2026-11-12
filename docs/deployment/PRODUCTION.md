# Production deployment

Oracle Cloud VM, rootful Podman, single host. Secrets via Doppler.

## Prerequisites

- Podman (rootful available via `sudo`), `podman-compose`, `doppler` CLI
- nginx config with a valid TLS certificate for the public domain
- Doppler project `examdump-pro`, config `prd`, with every variable in
  [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)

## First deploy

```bash
git clone https://github.com/ajayk134/examdump-pro.git ~/projects/examdump-pro
cd ~/projects/examdump-pro

npm ci
npm run build -w @examdump/shared
npm run build -w @examdump/data-client

cd deploy
doppler run --project examdump-pro --config prd -- \
  podman compose -p examdump-pro up -d --build

sleep 20
sudo podman ps
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/health
```

The API container runs `node dist/migrate.js && node dist/index.js`, so the first
start applies all migrations.

## Routine deploy

```bash
cd ~/projects/examdump-pro
git fetch && git checkout <commit>

cd deploy
doppler run --project examdump-pro --config prd -- \
  podman compose -p examdump-pro up -d --build

# ALWAYS after the api container is recreated
sudo podman exec examdump-pro_nginx_1 nginx -s reload

curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/health
```

Skipping the `nginx -s reload` produces a 502 while the API logs look healthy.
This is the most common deploy mistake on this host.

## Verifying the deploy actually took effect

A checked-out commit does **not** prove the running container has it. Check the
built bundle, not the repository:

```bash
sudo podman exec examdump-pro_api_1 \
  sh -c 'grep -l baseAmountPaise /app/dist/*.js | wc -l'
```

`0` means the image predates that change.

```bash
# what commit is deployed
git rev-parse HEAD

# schema state
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -tAc \
  "select count(*) from drizzle.__drizzle_migrations;"
```

## Two Podman stores — check before concluding anything

| Store | Command | Role |
| --- | --- | --- |
| Rootful | `sudo podman` | **production** |
| Rootless | `podman` | unrelated / leftovers |

`podman ps` showing nothing does **not** mean production is down.

## Secrets

Never place a value in compose or an image. `doppler run` injects the environment.

`sudo` strips exported shell variables, so `sudo env FOO=$BAR podman compose` does
not reliably work. Run compose as your own user with Doppler injecting variables.

## Health verification

```bash
curl -s https://<domain>/api/health
# {"status":"ok","database":"connected","uptimeSeconds":N}

curl -s https://<domain>/api/upi/status
# {"available":false,"autoApprove":false,...}   while payments are dormant
```

## Compose service notes

| Service | Restart | Logging |
| --- | --- | --- |
| postgres | `unless-stopped` | json-file 10m × 5 |
| api | `unless-stopped` | json-file 10m × 5 |
| web | `unless-stopped` | json-file 10m × 5 |
| nginx | `unless-stopped` | json-file 10m × 5 |

No CPU/memory limits are set. On a small VM, one runaway container can starve the
others; adding limits is worthwhile hardening once usage is understood.

## Network aliases

`deploy/docker-compose.yml` declares explicit aliases:

```yaml
networks:
  examdump:
    aliases: [postgres]    # postgres service
    aliases: [api]         # api service
```

`DATABASE_URL` targets hostname `postgres` and nginx proxies to `server api:4000`.
Compose's default alias is the *container name*, which is not what those
consumers ask for. Removing these aliases breaks DNS on the next recreate.

## Related

- [Environment variables](ENVIRONMENT_VARIABLES.md)
- [Backup and restore](BACKUP_RESTORE.md)
- [Rollback](ROLLBACK.md)
- [Disaster recovery](DISASTER_RECOVERY.md)
- [Operations runbook](../OPERATIONS.md)
