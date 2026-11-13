# Rollback

There is **no automated down-migration.** Rolling back means one of three things,
in order of preference.

## 1. Redeploy the previous image (preferred)

Because migrations are additive, older code usually runs fine against a newer
schema — new nullable columns are simply ignored.

**Use the script.** It stages the previous image, waits for health, swaps and reloads
nginx — and it is the only path tested on this host:

```bash
cd ~/projects/examdump-pro/deploy
./redeploy-api.sh --rollback
```

`--rollback` reads the image recorded in `/var/lib/examdump-deploy/previous-image`
(written by the last successful deploy). If you need an older image than that one,
tag it as `latest` first and run a normal deploy:

```bash
cd ~/projects/examdump-pro
git checkout <previous-commit>
sudo podman tag <image-id> localhost/examdump-pro_api:latest
cd deploy
./redeploy-api.sh --no-build
```

Do **not** use `podman compose up` for this. The containers are not compose-managed
and compose has been observed reporting success while leaving the old image
running. See [DEPLOYMENT.md](../../DEPLOYMENT.md).

**When this fails:** if the newer migration added a `NOT NULL` column **without a
default**, old code that inserts into that table breaks. This exact case happened
with `0007_upi_amount_suffix.sql` (`base_amount_paise NOT NULL`). In that
situation, either the rollback must also relax the constraint, or you use option 2.

## 2. Restore a backup

Only if data is corrupted or a destructive migration ran.

```bash
cd deploy
sudo podman stop examdump-pro_api_1
./backup.sh                          # safety copy of current state first
./restore.sh /path/to/backup.pgdump
sudo podman start examdump-pro_api_1
sudo podman exec examdump-pro_nginx_1 nginx -s reload
```

Everything written since the backup is lost.

## 3. Targeted forward fix

Faster and safer than a full rollback for a single broken behaviour: leave the
schema alone, ship a small commit that fixes the problem. Preferred when the
issue is isolated.

## What cannot be rolled back

| Change | Reversibility |
| --- | --- |
| A dropped column or table | irreversible without backup |
| A destructive `UPDATE`/`DELETE` | irreversible without backup |
| Rotated `PASSWORD_PEPPER` | **breaks all existing password hashes** |
| Revoked sessions | users must log in again |
| A sent email | cannot be recalled |
| A settled payment | must be refunded, not un-settled |

## Pre-deploy safety

```bash
cd deploy
./backup.sh                     # cheap insurance
./restore.sh --verify-only 2>/dev/null || true
```

Verify the dump restores into a scratch database before a risky change — see
[Backup and restore](BACKUP_RESTORE.md).

## Related

- [Production](PRODUCTION.md)
- [Backup and restore](BACKUP_RESTORE.md)
- [Migrations](../database/MIGRATIONS.md)
- [Incident response](../operations/INCIDENT_RESPONSE.md)
