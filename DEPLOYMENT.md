# Deployment

Single Oracle Cloud VM, rootful Podman, Doppler for secrets, nginx for TLS.

> **Detailed:** [docs/deployment/](docs/deployment/PRODUCTION.md) ·
> [operations runbook](docs/OPERATIONS.md)

## Deploy

Use the script. It is the only procedure that has been tested against this host.

```bash
cd ~/projects/examdump-pro
sudo podman inspect examdump-pro_api_1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -v '^PATH=' \
  > /tmp/examdump-api.env && sudo chmod 600 /tmp/examdump-api.env

cd deploy
./redeploy-api.sh            # build, verify image, stage, health-check, swap, nginx
```

The script:

1. refuses to run unless postgres is up **on the `pgdata` volume**, the network
   exists and nginx is present;
2. builds the image and verifies it contains a plausible bundle;
3. starts the new container under a temporary name and waits for
   `/api/health/ready` — the old container keeps serving meanwhile;
4. only then swaps names, restarts, reloads nginx and verifies routing *through*
   nginx;
5. records the replaced image in `/var/lib/examdump-deploy/previous-image`.

Measured on this host: ~28 s for an unchanged build, ~41 s after an API source
change. It exits non-zero and leaves the running API untouched if any check fails.

Useful flags: `--build-only`, `--no-build`, `--dry-run`, `--rollback`.

### Why not `podman-compose up`

The running containers were created by individual `podman run` commands, not by
compose. `podman-compose up` compares a stored config-hash, tries to recreate
containers inside a pod it no longer owns, and has left the API running the **old
image while reporting success**. Compose in this repository now reproduces
*settings*; it does not reproduce the live stack. Do not use it to deploy.

## Five things that will bite you

1. **Two Podman stores.** Production is rootful (`sudo podman`). `podman ps` being
   empty means nothing.
2. **nginx caches the API IP.** Recreate the API without `nginx -s reload` and you
   get a 502 while the API is perfectly healthy. `redeploy-api.sh` does this for
   you and then verifies routing.
3. **`sudo` strips exported variables.** Use `doppler run`, not `sudo env FOO=$BAR`.
4. **Migrations run at container start.** The database can move ahead of an older
   image; a `NOT NULL` addition breaks the previous build.
5. **There are two `pgdata` volumes.** The live database is the **unprefixed**
   `pgdata` volume. `examdump_pro_pgdata` is a stale copy from an earlier
   migration and also contains 19 users, so it looks real. Nothing may mount it.
   `deploy/docker-compose.yml` pins `name: pgdata` for this reason, and
   `redeploy-api.sh` refuses to run if postgres is on any other volume.

## Verify a deploy landed

A checked-out commit does not prove the container has it:

```bash
sudo podman exec examdump-pro_api_1 sh -c 'grep -l baseAmountPaise /app/dist/*.js | wc -l'
```

And confirm the running image is the one just built:

```bash
sudo podman inspect examdump-pro_api_1 --format '{{.Image}}'
sudo podman inspect localhost/examdump-pro_api:latest --format '{{.Id}}'
```

The two must match. `redeploy-api.sh` prints this comparison on completion.

## Topology

All four containers run directly on the `examdump-pro_examdump` bridge network.
There is no pod; an empty `pod_examdump-pro` left over from a failed compose run
was removed.

| Service | Container | Exposed | Purpose |
| --- | --- | --- | --- |
| nginx | `examdump-pro_nginx_1` | 80, 443 | TLS, gzip, routing |
| web | `examdump-pro_web_1` | internal 3000 | Next.js standalone |
| api | `examdump-pro_api_1` | internal 4000 | Fastify + workers + migrations |
| postgres | `examdump-pro_postgres_1` | internal 5432 | application data |

The deployed nginx config upstreams **container names**
(`examdump-pro_api_1:4000`), not compose aliases. The in-repo
`deploy/nginx/nginx.conf` uses `api:4000`/`web:3000` and is therefore not identical
to what runs; see the comment in that file before copying it to the host.

## Related

- [Production](docs/deployment/PRODUCTION.md)
- [Backup and restore](docs/deployment/BACKUP_RESTORE.md)
- [Rollback](docs/deployment/ROLLBACK.md)
- [Disaster recovery](docs/deployment/DISASTER_RECOVERY.md)
- [Environment variables](docs/ENVIRONMENT.md)
