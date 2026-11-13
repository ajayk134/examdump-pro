# Deployment

Single Oracle Cloud VM, rootful Podman, Doppler for secrets, nginx for TLS.

> **Detailed:** [docs/deployment/](docs/deployment/PRODUCTION.md) ·
> [operations runbook](docs/OPERATIONS.md)

## Deploy

Use the script. It is the only procedure that has been tested against this host.

```bash
cd ~/projects/examdump-pro/deploy

# 1. Settle the environment file from Doppler, then from the live container.
#    Run this whenever a variable changed in Doppler.
doppler run --project examdump-pro --config prd -- ./redeploy-api.sh --sync-env

# 2. Deploy.
sudo ./redeploy-api.sh
```

### Why the two steps are separate

The API container is created with `podman create --env-file`, so its variables
come from **a file**, never from the shell that invoked the script. Prefixing a
deploy with `doppler run` therefore changes nothing — the file always wins, and an
unchanged file means an unchanged environment.

That is how a newly added secret can sit in Doppler while deployment reports
success. `--sync-env` is the step that actually moves values into the file.

`podman create --env-file` also treats every line literally: it does not strip
quotes and does not interpret escapes. Doppler's `secrets download --format env`
emits `LOG_LEVEL="info"`, which the API would receive as the six-character string
`"info"` and reject — so `--sync-env` normalises quoting on the way in.

Two guarantees, both covered by `deploy/test-env-sync.sh`:

- an **empty** incoming value never overwrites a working one — removing a
  variable is a deliberate edit of the file, not a side effect of a leaner
  environment;
- values containing spaces, `=`, `#` or quotes survive unchanged.

`--sync-env` writes the file `0600` and never logs a value.

### First-time setup on a fresh host

```bash
cd deploy
./redeploy-api.sh --sync-env --from-container   # seed from the running container
```

Run this to regenerate `/tmp/examdump-api.env` if it is missing.

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

Useful flags: `--build-only`, `--no-build`, `--dry-run`, `--rollback`,
`--sync-env`, `--sync-env --from-container`.

`--dry-run` applies to **every** mode. Combined with `--rollback`, `--dry-run` or
`--sync-env` it prints the exact steps and image IDs it would use, then stops
without removing, creating, renaming or restarting anything and without writing
the env file. Conflicting modes (`--rollback --sync-env`, `--build-only
--no-build`, `--from-container` without `--sync-env`) are refused before any work
starts rather than silently letting one win. This is pinned down by
`deploy/test-dry-run.sh`. Do not combine `--rollback` with `--dry-run` expecting a
preview in older revisions; that combination used to perform a real rollback.

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
