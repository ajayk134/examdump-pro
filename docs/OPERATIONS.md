# Operations runbook

Practical, incident-tested procedures for the production host. This file records
what actually went wrong and how it was fixed — not what the design intended.

---

## Host topology (read this first)

ExamDump Pro runs **natively under systemd**. There is no container for it.

| Unit | Listens | Role |
| --- | --- | --- |
| `nginx.service` | `0.0.0.0:80,443` | TLS termination, reverse proxy |
| `examdump-api.service` | `127.0.0.1:4000` | Fastify API |
| `examdump-web.service` | `127.0.0.1:3000` | Next.js frontend |
| `postgresql.service` | `127.0.0.1:5432` | PostgreSQL 16 |

**Consequence:** `podman ps` tells you nothing about ExamDump. A rootless Podman
store still exists on this host for the unrelated **Omniroute** application
(`omniroute`, `omniroute-redis`), so `podman ps` may return containers that have
nothing to do with production.

Check the real stack with:

```bash
systemctl is-active nginx postgresql examdump-api examdump-web
curl -s http://127.0.0.1:4000/api/health
```

Do not conclude that production is down from `podman ps` alone.

---

## Deploying

```bash
cd ~/projects/examdump-pro
git fetch && git checkout <commit>
# build and copy artifacts, then:
sudo systemctl restart examdump-api examdump-web
```

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the full procedure.

### Why there is no compose step

The stack is four systemd units. Restarting a unit restarts exactly that process,
so a deploy cannot leave the API on an old build while reporting success.

### Secrets

The units read `/etc/examdump-pro/production.env`, rendered from Doppler. Update
that file and restart the units; exporting a variable in a shell changes nothing,
and `sudo env FOO=$BAR` fails because `sudo` strips exported variables.

### 502 Bad Gateway

nginx proxies to `127.0.0.1:4000` and `127.0.0.1:3000`. A `502` means the upstream
process is not listening, not that nginx needs reloading:

```bash
systemctl status examdump-api examdump-web
journalctl -u examdump-api -n 50
```

Symptoms if you skip it: `/api/health` returns 502 while the API log looks
healthy — the upstream simply is not listening on `127.0.0.1:4000`.

---

---

## Health checks

```bash
systemctl is-active nginx postgresql examdump-api examdump-web
curl -s https://examtopicspro.duckdns.org/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://examtopicspro.duckdns.org/
```

Expect `200` and `{"status":"ok","database":"connected"}`.

---

## Verifying a deploy actually landed

A checked-out commit does **not** prove the running service has it — the build
output must have been copied to `/opt/examdump-pro`. Check the built bundle:

```bash
grep -l <symbol> /opt/examdump-pro/api/dist/*.js | wc -l
```

`0` means the deployed build predates that change. Rebuild and redeploy, then:

```bash
sudo systemctl restart examdump-api
systemctl status examdump-api
```

---

## Schema vs. code mismatches

Migrations are **not** applied automatically at boot. Run them explicitly during a
deploy, which creates the same hazard: **the database can be ahead of the running
code.**

Real example — `0007_upi_amount_suffix.sql` added `base_amount_paise NOT NULL`
with no default. A build made before that commit tried to insert without the
column and failed:

```
null value in column "base_amount_paise" of relation "upi_orders"
violates not-null constraint
```

It was invisible because `PAYMENTS_ENABLED=false` meant nothing exercised the
path. Whenever a migration adds a `NOT NULL` column, rebuild and redeploy in the
same change.

Check for drift:

```bash
sudo -u postgres psql -d examdump \
  -c "\d upi_orders"
```

---

## Backups and restore

```bash
# take one
sudo /usr/local/bin/examdump-backup

# verify a dump is a real PostgreSQL custom-format archive
sudo sh -c 'pg_restore --list < /var/backups/examdump/<file>.pgdump' | head
```

A file with valid `PGDMP` magic can still fail mid-restore. Only a completed
`pg_restore` into a scratch database proves the backup is usable.

Never delete a backup until a restore into a scratch database has succeeded.

---

## Cleaning up

```bash
# journal disk usage
journalctl --disk-usage
sudo journalctl --vacuum-time=14d

# old backups beyond the retention window are removed by the backup script
ls -la /var/backups/examdump
```

Rootless Podman storage on this host belongs to Omniroute; do not prune it.
