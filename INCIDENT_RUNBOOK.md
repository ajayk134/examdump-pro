# Incident runbook

Fast containment. Full detail:
[docs/operations/INCIDENT_RESPONSE.md](docs/operations/INCIDENT_RESPONSE.md).

## First five minutes

```bash
sudo podman ps                                   # containers up?
curl -s https://<domain>/api/health              # API answering?
sudo podman logs --tail 50 examdump-pro_api_1    # what does it say?
```

**Do not restart before capturing logs** — a restart destroys the evidence.

## Site down

| Symptom | Cause | Fix |
| --- | --- | --- |
| 502, API healthy | nginx cached the old API IP | `sudo podman exec examdump-pro_nginx_1 nginx -s reload` |
| API container restarting | crash loop | read logs; see [Troubleshooting](docs/operations/TROUBLESHOOTING.md) |
| Nothing in `podman ps` | wrong store | check `sudo podman ps` |
| Everything down | host/reboot | [Disaster recovery](docs/deployment/DISASTER_RECOVERY.md) |

## Payments wrong (S1 — outranks downtime)

1. Disable immediately — set `PAYMENTS_ENABLED=false` in Doppler, then:
   ```bash
   cd deploy && doppler run -p examdump-pro -c prd -- \
     podman compose -p examdump-pro up -d api
   ```
2. **Preserve evidence** — never delete or update `payments`, `upi_*`, `refunds`,
   `webhook_events`.
3. Quantify:
   ```sql
   select count(*) from upi_matches where decision in ('auto_approved','manual_approved');
   select id, amount_minor, status, created_at from payments where status='captured';
   ```
4. Fix forward. Re-enable only after a verified real test.

## Suspected secret leak

1. Rotate in Doppler.
2. Restart the API.
3. Revoke sessions: `update sessions set revoked_at = now() where revoked_at is null;`
4. Review `audit_logs` and `login_attempts`.

Rotate **before** investigating history.

## Database problems

```bash
sudo podman exec examdump-pro_postgres_1 pg_isready -U examdump -d examdump
```

| Symptom | Action |
| --- | --- |
| won't start | check logs; volume may contain foreign files — back up before recreating |
| too many connections | lower `DATABASE_POOL_MAX` or raise `max_connections` |
| very slow | `pg_stat_activity` → long transactions; `pg_stat_statements` → expensive queries |

## Restore from backup

```bash
cd deploy
sudo podman stop examdump-pro_api_1
./backup.sh                       # safety copy first
./restore.sh /path/to/backup.pgdump
sudo podman start examdump-pro_api_1
sudo podman exec examdump-pro_nginx_1 nginx -s reload
```

`restore.sh` uses `--clean --if-exists`: it drops existing objects.

## Severity

| Sev | Meaning | Response |
| --- | --- | --- |
| S1 | site down or payments wrong | immediate |
| S2 | major feature broken | same day |
| S3 | degraded | next business day |
| S4 | cosmetic | backlog |

## Post-incident

Record: timeline, root cause (not just trigger), why existing checks missed it, and
one concrete preventive change. Add it to [TECH_DEBT.md](TECH_DEBT.md) if not fixed
immediately.
