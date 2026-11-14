# Monitoring

What exists, and — importantly — what does not.

> **Detailed:** [docs/operations/MONITORING.md](docs/operations/MONITORING.md)

## Available signals

| Signal | How |
| --- | --- |
| API + DB health | `GET /api/health` |
| Payment state | `GET /api/upi/status` |
| Service status | `systemctl status examdump-api examdump-web nginx postgresql` |
| API logs (Pino JSON) | `sudo journalctl -u examdump-api` |
| Reconciliation history | `reconciliation_runs` |
| Error records | `error_events` |
| Audit trail | `audit_logs` |
| Mail delivery | `mail_logs`, `email_queue` |

## Not available

| Gap | Consequence |
| --- | --- |
| **No external uptime monitor** | a host outage goes unnoticed |
| No metrics pipeline | no latency/error history |
| No alerting | nothing pages anyone |
| No dashboard | inspection is manual SQL |
| No log aggregation | per-container, 10 MB × 5 rotation |
| No disk monitoring | a full disk silently breaks Postgres |

**The single highest-value addition is an external check on `/api/health`.** It would
have caught every outage scenario documented in the incident runbook.

## Quick health check

```bash
systemctl is-active nginx postgresql examdump-api examdump-web
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/health
curl -s https://<domain>/api/health
df -h | grep -E "/$"
```

`uptimeSeconds` from `/api/health` reveals a crash loop: a low number at a random
time means restarts, not a recent deploy.

## Related

- [Operations monitoring](docs/operations/MONITORING.md)
- [Logging](docs/operations/LOGGING.md)
- [Incident runbook](INCIDENT_RUNBOOK.md)
- [TECH_DEBT](TECH_DEBT.md)
