# Troubleshooting (operations)

Symptom-first index for incidents. The general-purpose entry list lives in
[docs/TROUBLESHOOTING.md](../TROUBLESHOOTING.md); this page covers only what
affects the running system.

## Site is down

```bash
# 1. are containers running?
sudo podman ps

# 2. does the API answer locally?
curl -s https://<domain>/api/health

# 3. is nginx proxying to the right place?
sudo podman logs --tail 20 examdump-pro_nginx_1
```

| Finding | Cause | Fix |
| --- | --- | --- |
| No containers | host rebooted, podman not started | `podman compose up -d` |
| API container "Created"/"Exited" | crash loop | `podman logs examdump-pro_api_1` |
| 502, API healthy | nginx cached old API IP | `podman exec examdump-pro_nginx_1 nginx -s reload` |
| 500 on all routes | database unreachable | check `podman ps`, `DATABASE_URL` |
| Everything missing from `podman ps` | wrong store | check `sudo podman ps` |

### The rootful/rootless trap

The host has **two** Podman stores. Production is rootful:

```bash
sudo podman ps     # production
podman ps          # unrelated / leftovers
```

An empty `podman ps` proves nothing about production. This exact confusion has
caused a false "the stack is down and the database is corrupt" diagnosis while
production was healthy.

## API crashes on start

```bash
sudo podman logs --tail 40 examdump-pro_api_1 | jq -c '{msg, err: .err.message}' 2>/dev/null \
  || sudo podman logs --tail 40 examdump-pro_api_1
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
sudo podman exec examdump-pro_postgres_1 pg_isready -U examdump -d examdump
sudo podman logs --tail 30 examdump-pro_postgres_1
```

**initdb permission error on start** — the volume contains foreign files:

```bash
sudo podman volume inspect pgdata
sudo podman run --rm -v pgdata:/v alpine ls -la /v | head
```

Back up, prove the restore, then recreate the volume. Never delete first.

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
sudo podman system df          # image/container space
sudo podman image prune -f     # dangling layers only
```

Never `podman system prune -a` on the production host — it removes images the
stack needs.

## Related

- [Monitoring](MONITORING.md)
- [Logging](LOGGING.md)
- [Incident response](INCIDENT_RESPONSE.md)
- [OPERATIONS.md](../OPERATIONS.md)
