# Incident response

Escalation and containment for the situations this system can actually produce.

## Severity

| Sev | Meaning | Examples | Response |
| --- | --- | --- | --- |
| **S1** | site down or payments wrong | 502 for all users, double settlement, data loss | immediate, all hands |
| **S2** | major feature broken | login broken, dataset unavailable, mail not sending | same day |
| **S3** | degraded | slow queries, one admin action failing | next business day |
| **S4** | cosmetic | layout issue, wrong copy | backlog |

## First five minutes

```bash
# 1. are the services up?
systemctl is-active nginx postgresql examdump-api examdump-web

# 2. is the API answering?
curl -s https://<domain>/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/health

# 3. what does the API say?
sudo journalctl -u examdump-api -n 50

# 4. what does nginx say?
sudo journalctl -u nginx -n 20
```

Do not restart anything before capturing logs — a restart destroys the evidence
in the current container's output.

## S1: payments lose integrity

This outranks availability. Losing money is worse than downtime.

1. **Stop the bleeding** — set `PAYMENTS_ENABLED=false` in Doppler, then:
   ```bash
   cd deploy && doppler run -p examdump-pro -c prd -- \
     sudo systemctl restart examdump-api
   ```
2. **Preserve evidence** — do not delete or update any `upi_*`, `payments`,
   `refunds` or `webhook_events` row.
3. **Quantify**:
   ```sql
   select count(*) from upi_matches where decision in ('auto_approved','manual_approved');
   select id, amount_minor, status, created_at from payments where status='captured';
   ```
4. **Contain** — if double settlement is confirmed, revoke the duplicated grants.
5. **Fix forward**, then re-enable only after a verified real test.

## S1: site unreachable

```bash
# container up but 502? nginx has a stale upstream
sudo systemctl reload nginx

# API crash looping?
sudo journalctl -u examdump-api -n 40

# database down?
pg_isready -h 127.0.0.1 -p 5432
```

If the host is gone entirely, move to
[disaster recovery](../deployment/DISASTER_RECOVERY.md).

## S2: dataset unavailable

Symptom: exam pages return 502 with "The question dataset is temporarily
unavailable."

```bash
# is it the token or GitHub?
sudo -u examdump sh -c 'grep -q "^GITHUB_TOKEN=..*" /etc/examdump-pro/production.env' && echo set || echo missing
sudo journalctl -u examdump-api -n 30 | grep -i dataset
```

Causes: expired `GITHUB_TOKEN`, rate limiting, or the repository being renamed.
Rotate the token in Doppler, restart the API.

## S2: email not sending

```sql
select status, count(*) from email_queue group by status;
select recipient, status, error from mail_logs order by created_at desc limit 10;
```

Common causes: SMTP credentials rotated, provider rate limit, address suppressed
after a bounce. Check `email_suppressions` before assuming a bug.

## S2: suspected secret leak

1. Rotate the secret in Doppler.
2. Restart the API.
3. If session secrets leaked, revoke sessions:
   ```sql
   update sessions set revoked_at = now() where revoked_at is null;
   ```
4. Review `audit_logs` and `login_attempts` for the exposure window.
5. Rotate *before* investigating history — stopping the leak comes first.

See [secrets management](../security/SECRETS_MANAGEMENT.md).

## S3: database slow

```sql
select pid, now() - query_start as duration, left(query,80)
from pg_stat_activity where state <> 'idle' and now() - query_start > interval '5 seconds';

select query, round(mean_exec_time::numeric,2), calls from pg_stat_statements
order by mean_exec_time desc limit 10;
```

Look for a missing index before adding a cache. See
[query optimization](../database/QUERY_OPTIMIZATION.md).

## Communication

While an incident is open, state three things and keep them current:

1. **Impact** — who is affected and how.
2. **Current state** — what you have tried and what changed.
3. **Next step** — the single action in progress.

Never declare an incident resolved on the basis of "it looks fine". Verify with a
health check **and** the specific feature that broke.

## Post-incident

Write down, in the same day:

- Timeline of detection → containment → resolution.
- Root cause, distinguished from trigger.
- Why existing checks did not catch it.
- One concrete change that prevents recurrence.
- Whether documentation needs updating (see
  [CONTRIBUTING.md](../../CONTRIBUTING.md)).

Add the prevention item to [TECH_DEBT.md](../../TECH_DEBT.md) if it is not fixed
immediately — an unrecorded action item never happens.

## Related

- [Monitoring](MONITORING.md)
- [Logging](LOGGING.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Rollback](../deployment/ROLLBACK.md)
- [INCIDENT_RUNBOOK.md](../../INCIDENT_RUNBOOK.md)
