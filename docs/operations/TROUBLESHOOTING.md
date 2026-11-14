# Troubleshooting (operations)

Symptom-first index for incidents. The general-purpose entry list lives in
[docs/TROUBLESHOOTING.md](../TROUBLESHOOTING.md); this page covers only what
affects the running system.

## Site is down

```bash
# 1. are the units running?
systemctl is-active nginx postgresql examdump-api examdump-web

# 2. does the API answer locally?
curl -s http://127.0.0.1:4000/api/health

# 3. is nginx proxying to the right place?
sudo journalctl -u nginx -n 20
```

| Finding | Cause | Fix |
| --- | --- | --- |
| Unit inactive | host rebooted, crash | `systemctl status examdump-api` |
| API unit restarting | crash loop | `journalctl -u examdump-api -n 50` |
| 502, API healthy | API not listening on 4000 | check `systemctl status examdump-api` |
| 500 on all routes | database unreachable | check `systemctl status postgresql`, `DATABASE_URL` |
| `curl 127.0.0.1:4000` refuses | service bound elsewhere | check `API_HOST=127.0.0.1` in the env file |

### `podman ps` is not production

ExamDump does not use containers. A rootless Podman store exists on this host for
the unrelated Omniroute application, so `podman ps` may show containers that have
nothing to do with ExamDump. Do not diagnose production from it.


## API crashes on start

```bash
sudo journalctl -u examdump-api -n 40 | jq -c '{msg, err: .err.message}' 2>/dev/null \
  || sudo journalctl -u examdump-api -n 40
```

| Error | Cause | Fix |
| --- | --- | --- |
| `getaddrinfo ENOTFOUND postgres` | missing network alias | declare `aliases: [postgres]` |
| `POSTGRES_PASSWORD is required` | compose env missing | use `doppler run` |
| `null value in column "base_amount_paise"` | image older than schema | rebuild API image |
| `ECONNREFUSED 5432` | Postgres not up yet | wait, or check postgres logs |
| env validation error | a required variable missing | see [ENVIRONMENT.md](../ENVIRONMENT.md) |

## Database

```bash
pg_isready -h 127.0.0.1 -p 5432
sudo journalctl -u postgresql -n 30
```

**initdb permission error on start** — the data directory is wrong or has foreign
files (PostgreSQL refuses to run as root, and `initdb` requires a directory owned
correctly):

```bash
sudo ls -la /var/lib/pgsql/data | head
sudo journalctl -u postgresql -n 20
```

Back up, prove the restore, then repair. Never delete the data directory first.

**Too many connections** — pool exceeds `max_connections`:

```sql
select count(*), state from pg_stat_activity group by state;
```

Lower `DATABASE_POOL_MAX` or raise `max_connections`.

## Payments and UPI

| Symptom | Check |
| --- | --- |
| `available:false` | `UPI_PAYEE_VPA` unset, or `PAYMENTS_ENABLED=false` |
| Order created, never matched | alert source down; `select * from upi_observer_state` |
| Notification arrived, no match | amount mismatch; check `upi_risk_events` |
| Two orders, same amount | index missing — `\d upi_orders` |
| Order stuck `under_review` | needs a human; expected with `UPI_AUTO_APPROVE=false` |

```sql
select reference, amount_paise, status, expires_at from upi_orders
order by created_at desc limit 10;
```

## Email

```sql
select status, count(*) from email_queue group by status;
select recipient, status, created_at from mail_logs order by created_at desc limit 10;
```

Queue not draining: the worker logs `mail.worker_started` at boot. If absent, the
worker did not start — check `MAIL_QUEUE_ENABLED`.

## Disk full

```bash
df -h
journalctl --disk-usage
sudo journalctl --vacuum-time=14d   # old service logs
du -sh /var/backups/examdump        # backups, retention handled by the script
```

Do not prune the rootless Podman storage on this host — it belongs to the
unrelated Omniroute application.

## Related

- [Monitoring](MONITORING.md)
- [Logging](LOGGING.md)
- [Incident response](INCIDENT_RESPONSE.md)
- [OPERATIONS.md](../OPERATIONS.md)
