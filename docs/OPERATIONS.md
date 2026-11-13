# Operations runbook

Practical, incident-tested procedures for the production host. This file records
what actually went wrong and how it was fixed — not what the design intended.

---

## Host topology (read this first)

One physical host runs **two independent Podman stores**:

| Store | Command | Runs as | Role |
| --- | --- | --- | --- |
| Rootful | `sudo podman ...` | root | **Production** |
| Rootless | `podman ...` | your user | Unrelated / leftover |

They do not share containers, images, volumes or networks. A container in one is
invisible from the other.

**Consequence:** `podman ps` returning nothing does **not** mean production is
down. Always check both:

```bash
sudo podman ps          # production
podman ps               # whatever else is on the box
```

This exact confusion caused a misdiagnosis: a rootless duplicate was reported as
"the stack is down and the database is corrupt" while rootful production was
healthy and serving traffic. Verify with `sudo podman ps` before concluding
anything.

---

## Deploying

```bash
cd ~/projects/examdump-pro
git fetch && git checkout <commit>
cd deploy

# Only when a variable changed in Doppler.
doppler run --project examdump-pro --config prd -- ./redeploy-api.sh --sync-env

sudo ./redeploy-api.sh
```

`deploy/redeploy-api.sh` builds, verifies the image, stages the new container and
waits for `/api/health/ready` **before** stopping the old one, then swaps, reloads
nginx and verifies routing. It rolls back automatically on failure and accepts
`--rollback`, `--build-only`, `--no-build`, `--dry-run`, `--sync-env` and
`--sync-env --from-container`.

`--dry-run` is honoured by every mode, including `--rollback` and `--sync-env`: it
prints the planned steps and the image IDs it would act on, then exits without
touching containers, images or the env file. Two modes at once are rejected. The
property is covered by `deploy/test-dry-run.sh` (`npm run test:deploy`).

**The environment comes from a file, not from the shell.** `podman create
--env-file` reads `/tmp/examdump-api.env`; a `doppler run` prefix on a plain deploy
syncs nothing, so a newly added secret appears to deploy and quietly is not there.
Run `--sync-env` under `doppler run` first. An empty incoming value never blanks a
working one. `npm run test:deploy` covers both guarantees.

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the full procedure.

### Why not `podman compose up`

The running containers were created by individual `podman run` commands, so they
are not compose-managed. `podman compose up` targets a pod they are not members of
and has been observed leaving the API on the **old image while reporting success**.
Compose in this repo reproduces *settings*, not the live stack.

### Why not `sudo podman compose` directly

Compose refuses to start without `POSTGRES_PASSWORD`. Passing it via
`sudo env FOO=$BAR` fails because **`sudo` strips exported shell variables**
unless explicitly allowed. Run compose as your own user with
`DOPPLER`-injected env, or use `doppler run` under the same user.

### The 502 trap

The deployed `nginx.conf` proxies to `server examdump-pro_api_1:4000`, and **nginx
resolves that name once at startup**. Recreating the API container gives it a new
IP; nginx keeps routing to the dead one and returns `502 Bad Gateway`.

After any API recreation:

```bash
sudo podman exec examdump-pro_nginx_1 nginx -s reload
```

Symptoms if you skip it: `/api/health` returns 502, API logs look perfectly
healthy, and `getent hosts examdump-pro_api_1` inside nginx resolves correctly.

`redeploy-api.sh` performs the reload and then verifies routing through nginx, so
the deployed container cannot come up unreachable without the script failing.

### Required network aliases (compose only)

These aliases matter only if the stack is ever recreated *through compose*; the live
containers are addressed by container name. `deploy/docker-compose.yml` declares:

```yaml
# postgres service
networks:
  examdump:
    aliases: [postgres]

# api service
networks:
  examdump:
    aliases: [api]
```

Without them, `DATABASE_URL` (which targets the bare hostname `postgres`) and the
nginx upstream both fail to resolve. The default compose alias is only the
container name, which is not what those consumers ask for.

---

## Health checks

```bash
sudo podman ps --format "{{.Names}} | {{.Status}}"
curl -s -o /dev/null -w '%{http_code}\n' https://examtopicspro.duckdns.org/api/health
curl -s https://examtopicspro.duckdns.org/api/upi/status
```

Expect `200` and `{"available":false,"autoApprove":false,...}` while payments are
dormant.

---

## Verifying a deploy actually landed

A checked-out commit does **not** prove the running container has it — images are
built separately. Check the built bundle:

```bash
sudo podman exec examdump-pro_api_1 \
  sh -c 'grep -l baseAmountPaise /app/dist/*.js | wc -l'
```

`0` means the container predates that change. Rebuild:

```bash
cd deploy && doppler run -p examdump-pro -c prd -- \
  podman compose -p examdump-pro up -d --build api
```

---

## Schema vs. code mismatches

The API container runs `node dist/migrate.js` before `node dist/index.js`, so a
restart applies pending migrations. That creates a hazard: **the database can be
ahead of the running code.**

Real example — `0007_upi_amount_suffix.sql` added `base_amount_paise NOT NULL`
with no default. A container built before that commit tried to insert without the
column and failed:

```
null value in column "base_amount_paise" of relation "upi_orders"
violates not-null constraint
```

It was invisible because `PAYMENTS_ENABLED=false` meant nothing exercised the
path. Whenever a migration adds a `NOT NULL` column, rebuild the image in the same
deployment.

Check for drift:

```bash
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump \
  -c "\d upi_orders"
```

---

## Backups and restore

```bash
# take one
cd deploy && ./backup.sh

# verify a dump is a real PostgreSQL custom-format archive
head -c 5 <file>.dump    # expect: PGDMP

# prove it restores BEFORE trusting it
sudo podman run --rm -e POSTGRES_PASSWORD=postgres -d --name pg-verify \
  -v /path/to/dir:/dump:z docker.io/library/postgres:16-alpine
sudo podman exec pg-verify pg_restore --list /dump/<file>.dump | head
```

A file with valid `PGDMP` magic can still fail mid-restore. Only a completed
`pg_restore` into a scratch database proves the backup is usable.

Never delete a volume until a restore into a throwaway database has succeeded.

---

## Cleaning up

```bash
# dangling layers only — safe
sudo podman image prune -f
podman image prune -f

# list unused volumes — inspect before removing
sudo podman volume ls

# what a running container actually mounts
sudo podman ps -q | xargs -r sudo podman inspect \
  --format '{{range .Mounts}}{{println .Name}}{{end}}' | sort -u
```

Removing a container that has an **anonymous volume** destroys its data
permanently. Some unrelated services on this host keep OAuth credentials and a
SQLite database in such a volume. Back the data up before deleting anything that
is not yours:

```bash
podman cp <container>:/app/data /home/opc/<name>-data-backup
```

---

## Removing the legacy rootless duplicate

Only when confirmed abandoned. It must not be serving traffic.

```bash
podman rm -f examdump-pro_postgres_1 examdump-pro_api_1 \
            examdump-pro_web_1 examdump-pro_nginx_1
podman volume rm examdump-pro_pgdata
podman rmi localhost/examdump-pro_api:latest localhost/examdump-pro_web:latest
```

If `podman rm` complains about "dependent containers", remove the listed IDs
first; a partially created container can block its parent.

---

## UPI: going live

The system ships dormant. To activate, in order:

1. Set `UPI_PAYEE_VPA` and `UPI_PAYEE_NAME`.
2. Configure an alert source: Gmail OAuth (`UPI_GOOGLE_*`) or
   `UPI_SMS_INGEST_SECRET` for forwarded messages.
3. Set `PAYMENTS_ENABLED=true`, keep `UPI_AUTO_APPROVE=false`.
4. Restart the API.
5. Send **one small real transfer**.
6. Confirm it appears in the **admin review queue**, not as auto-settled.
7. Compare against the actual bank statement before approving.
8. Only then consider `UPI_AUTO_APPROVE=true` once matching is proven reliable.

Verification queries:

```bash
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c \
  "select reference, amount_paise, base_amount_paise, status, created_at
   from upi_orders order by created_at desc limit 10;"
```

Each active order must have a distinct `amount_paise`. Duplicates indicate the
partial unique index is missing.

---

## Troubleshooting index

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| 502 from nginx, API healthy | nginx cached old API IP | `nginx -s reload` |
| `getaddrinfo ENOTFOUND postgres` | missing network alias | declare alias in compose |
| `POSTGRES_PASSWORD is required` | compose env not injected | use `doppler run` |
| `not-null constraint base_amount_paise` | stale image vs new schema | rebuild API image |
| `podman ps` empty, site works | rootful vs rootless store | check `sudo podman ps` |
| initdb permission error on volume | volume holds foreign files | recreate the volume |
| UPI status `available:false` | `UPI_PAYEE_VPA` unset | set the payee VPA |
