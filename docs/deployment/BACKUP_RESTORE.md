# Backup and restore

Scripts: `deploy/backup.sh`, `deploy/restore.sh`. Both shell out to PostgreSQL
inside a container, so they work regardless of whether a local `pg_dump` is
installed.

## Taking a backup

```bash
cd ~/projects/examdump-pro/deploy
./backup.sh                        # writes examdump_<timestamp>.pgdump
BACKUP_RETENTION_DAYS=30 ./backup.sh
```

What it does:

```sh
pg_dump --no-owner --no-privileges --format=custom --file=/backup/<name> "$DATABASE_URL"
find "$BACKUP_DIR" -name 'examdump_*.pgdump' -mtime +14 -delete
```

- **Custom format** (`-f`), not plain SQL: compressed, and restorable
  selectively with `pg_restore --list`.
- `--no-owner --no-privileges`: the dump restores into any role, so it survives a
  changed database user.
- **Retention defaults to 14 days.** Backups older than that are deleted
  automatically — if you need longer history, set `BACKUP_RETENTION_DAYS`.

## Verifying a backup (do this, do not skip)

A file with valid `PGDMP` magic can still fail mid-restore. Only a completed
restore proves it works.

```bash
# 1. it is a real custom-format archive
head -c 5 <file>.pgdump          # expect: PGDMP

# 2. it has content
sudo podman run --rm -e POSTGRES_PASSWORD=postgres -d --name pg-verify \
  -v "$(dirname "$(pwd)/<file>.pgdump")":/dump:z docker.io/library/postgres:16-alpine

sudo podman exec pg-verify sh -c 'pg_restore --list /dump/<file>.pgdump | head -30'
```

Then prove it restores into a scratch database:

```bash
sudo podman exec pg-verify createdb -U postgres scratch
sudo podman exec pg-verify pg_restore -U postgres -d scratch --no-owner /dump/<file>.pgdump
sudo podman exec pg-verify psql -U postgres -d scratch -c '\dt'
sudo podman exec pg-verify psql -U postgres -d scratch -tAc \
  "select count(*) from users;"
sudo podman rm -f pg-verify
```

**Never delete a volume or database until this succeeds.**

## Restoring

```bash
cd ~/projects/examdump-pro/deploy
./restore.sh /path/to/examdump_<timestamp>.pgdump
```

Which runs:

```sh
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" <archive>
```

`--clean --if-exists` **drops existing objects**. This is destructive: anything
written since the backup is lost. Take a fresh dump first if there is any data
worth keeping.

### Restore procedure

1. **Stop the API** so nothing writes during the restore:
   `sudo podman stop examdump-pro_api_1`
2. Take a safety dump of current state: `./backup.sh`
3. Run the restore.
4. Verify:
   ```bash
   sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c '\dt' | head
   sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -tAc \
     "select count(*) from users;"
   ```
5. Start the API: `sudo podman start examdump-pro_api_1`
6. `sudo podman exec examdump-pro_nginx_1 nginx -s reload`
7. `curl -s https://<domain>/api/health`

## What is in a backup

All 52 tables: users, sessions, subscriptions, payments, invoices, UPI records,
mail, audit logs, catalogue metadata.

**Not** in a backup: exam question content (it lives in GitHub) and secrets (they
live in Doppler). A restored database is therefore not a complete system — it needs
`GITHUB_TOKEN` and the rest of the environment to function.

## Backup security

A dump contains password hashes, emails, payment records and audit history.

- Store it outside the web root; never serve the directory.
- Treat it as personal data: encrypt at rest if it leaves the host.
- Do not commit a dump. `.gitignore` covers `*.pgdump`, but check
  `git status` before staging.
- Deleting a backup is permanent; there is no archive tier.

## Off-host copies

The scripts write to a local directory on the same VM. **If the VM is lost, the
backups are lost with it.** Copy dumps off-host (object storage, another machine)
on a schedule. This is a real gap, tracked in
[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

## Related

- [Rollback](ROLLBACK.md)
- [Disaster recovery](DISASTER_RECOVERY.md)
- [Production](PRODUCTION.md)
