# Monitoring

What can be observed today, and what cannot. The gaps are stated plainly because
an unmonitored system that looks monitored is worse than one that admits it.

## What exists

| Signal | Source | How to read it |
| --- | --- | --- |
| API liveness + DB connectivity | `GET /api/health` | `curl`, returns `{status, database, uptimeSeconds}` |
| Payment/UPI state | `GET /api/upi/status` | `curl`, returns `available`, `autoApprove` |
| Service status | systemd | `systemctl status examdump-api` |
| API structured logs | Pino JSON | `sudo journalctl -u examdump-api` |
| nginx access/error | container logs | `sudo journalctl -u nginx` |
| Postgres health | `pg_isready` healthcheck | compose healthcheck |
| Reconciliation runs | `reconciliation_runs` table | SQL |
| Error records | `error_events` table | SQL |
| Audit trail | `audit_logs` table | SQL |
| Mail delivery | `mail_logs`, `email_queue` | SQL |

## Health endpoint

```bash
curl -s https://<domain>/api/health
# {"status":"ok","database":"connected","uptimeSeconds":1234}
```

`uptimeSeconds` is the fastest way to tell whether a container restarted during a
deploy — a low number right after a restart is expected; a low number at random
indicates a crash loop.

## Useful queries

```sql
-- recent server errors
select created_at, level, message from error_events
order by created_at desc limit 20;

-- stuck mail
select status, count(*) from email_queue group by status;

-- payments awaiting reconciliation
select id, status, created_at from payments
where status = 'pending' and created_at < now() - interval '10 minutes';

-- UPI orders needing review
select reference, amount_paise, status, created_at from upi_orders
where status = 'under_review' order by created_at;

-- unresolved notifications
select id, amount_paise, status, received_at from upi_notifications
where status not in ('matched','ignored') order by received_at desc limit 20;
```

## What is missing

| Gap | Consequence |
| --- | --- |
| **No external uptime monitor** | if the host dies, nobody is alerted |
| **No metrics pipeline** | no Prometheus/OTel; no time-series history |
| **No alerting** | no threshold on error rate, latency, disk or queue depth |
| **No dashboard** | inspection is manual SQL |
| **No log aggregation** | logs are per-container and rotated at 10 MB × 5 |
| **No disk monitoring** | a full disk silently breaks Postgres |

These are tracked in [TECH_DEBT.md](../../TECH_DEBT.md). The highest-value single
addition is an external uptime check on `/api/health` — it would have caught
every outage scenario in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

## Manual daily check

Until monitoring exists, this is the practical routine:

```bash
systemctl status examdump-api examdump-web nginx postgresql --no-pager
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/health
curl -s https://<domain>/api/upi/status
df -h | grep -E "/$|/var"
sudo journalctl -u examdump-api -n 30 | grep -i error
```

## Related

- [Logging](LOGGING.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Incident response](INCIDENT_RESPONSE.md)
- [MONITORING.md](../../MONITORING.md)
