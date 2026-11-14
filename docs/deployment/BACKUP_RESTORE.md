# Backup and restore

Backups run natively: `pg_dump` against the local PostgreSQL 16 cluster, driven by
`/usr/local/bin/examdump-backup` and scheduled in `/etc/cron.d/examdump-backup`.

## Automatic backups

```
30 2 * * * root /usr/local/bin/examdump-backup >> /var/log/examdump-backup.log 2>&1
```

- Destination: `/var/backups/examdump/examdump_<UTC timestamp>.pgdump`
- Format: PostgreSQL custom format, `--no-owner --no-privileges`
- Retention: 14 days (`BACKUP_RETENTION_DAYS`)
- A dump is written to a temp file and moved into place on success, so a failed
  run never replaces a good backup with a truncated one.

## Taking one manually

```bash
sudo /usr/local/bin/examdump-backup
sudo tail -5 /var/log/examdump-backup.log
```

## Verifying a backup

A dump is only useful if its catalogue can be read. This checks structure without
touching any database:

```bash
sudo sh -c 'pg_restore --list < /var/backups/examdump/<file>.pgdump' | head -10
```

A healthy archive reports `Format: CUSTOM` and a `TOC Entries` count above 300.

## Restoring

Restoring replaces the whole database. Stop the application first.

```bash
sudo systemctl stop examdump-api examdump-web

sudo -u postgres dropdb examdump
sudo -u postgres createdb -O examdump examdump

cat /var/backups/examdump/<file>.pgdump \
  | sudo -u postgres pg_restore -d examdump --no-owner --no-privileges --exit-on-error

sudo systemctl start examdump-api examdump-web
curl -s http://127.0.0.1:4000/api/health
```

The dump is piped rather than passed by path because the backup files are
`0600 root` and the `postgres` user cannot read them directly.

## Restoring to a different database

Useful for inspecting an old backup without disturbing production:

```bash
sudo -u postgres createdb -O examdump examdump_inspect
cat /var/backups/examdump/<file>.pgdump \
  | sudo -u postgres pg_restore -d examdump_inspect --no-owner --no-privileges
# inspect, then:
sudo -u postgres dropdb examdump_inspect
```

Only one database is production: `examdump`.
