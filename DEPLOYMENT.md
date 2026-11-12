# Deployment

Single Oracle Cloud VM, rootful Podman, Doppler for secrets, nginx for TLS.

> **Detailed:** [docs/deployment/](docs/deployment/PRODUCTION.md) ·
> [operations runbook](docs/OPERATIONS.md)

## Deploy

```bash
cd ~/projects/examdump-pro
git fetch && git checkout <commit>

cd deploy
doppler run --project examdump-pro --config prd -- \
  podman compose -p examdump-pro up -d --build

# REQUIRED after the api container is recreated
sudo podman exec examdump-pro_nginx_1 nginx -s reload

curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/health
```

## Five things that will bite you

1. **Two Podman stores.** Production is rootful (`sudo podman`). `podman ps` being
   empty means nothing.
2. **nginx caches the API IP.** Recreate the API without `nginx -s reload` and you
   get a 502 while the API is perfectly healthy.
3. **`sudo` strips exported variables.** Use `doppler run`, not `sudo env FOO=$BAR`.
4. **Migrations run at container start.** The database can move ahead of an older
   image; a `NOT NULL` addition breaks the previous build.
5. **Network aliases are required.** `postgres` and `api` are declared in
   `deploy/docker-compose.yml`; without them DNS fails.

## Verify a deploy landed

A checked-out commit does not prove the container has it:

```bash
sudo podman exec examdump-pro_api_1 sh -c 'grep -l baseAmountPaise /app/dist/*.js | wc -l'
```

## Topology

| Service | Exposed | Purpose |
| --- | --- | --- |
| nginx | 80, 443 | TLS, gzip, routing |
| web | internal 3000 | Next.js standalone |
| api | internal 4000 | Fastify + workers + migrations |
| postgres | internal 5432 | application data |

## Related

- [Production](docs/deployment/PRODUCTION.md)
- [Backup and restore](docs/deployment/BACKUP_RESTORE.md)
- [Rollback](docs/deployment/ROLLBACK.md)
- [Disaster recovery](docs/deployment/DISASTER_RECOVERY.md)
- [Environment variables](docs/ENVIRONMENT.md)
