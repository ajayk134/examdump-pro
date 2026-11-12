# Logging

Structured JSON via Pino (Fastify's built-in logger). Every log line is
machine-readable.

## Accessing logs

```bash
sudo podman logs --tail 100 examdump-pro_api_1
sudo podman logs -f examdump-pro_api_1          # follow
sudo podman logs --since 30m examdump-pro_api_1
```

`LOG_LEVEL` (default `info`) controls verbosity. `debug` is very verbose — use it
briefly, never leave it on in production.

## Rotation

Configured per service in `deploy/docker-compose.yml`:

```yaml
logging:
  driver: json-file
  options:
    max-size: '10m'
    max-file: '5'
```

That is ~50 MB per service, then the oldest is discarded. **Do not remove these
options** — without them container logs grow until the disk fills. The trade-off
is that history is short; anything older than the last 5 rotations is gone, which
is another reason the monitoring gaps in [MONITORING.md](MONITORING.md) matter.

## Structured fields

Fastify attaches `reqId`, `method`, `url`, `statusCode` and response time
automatically. A typical line:

```json
{"level":30,"time":1794517351149,"reqId":"req-3","method":"GET",
 "url":"/api/exams","statusCode":200,"responseTime":18.4,"msg":"request completed"}
```

Filter with `jq`:

```bash
sudo podman logs --tail 500 examdump-pro_api_1 | \
  jq -c 'select(.level >= 40) | {time, msg, err: .err.message}' | tail -20
```

Levels: `10` trace, `20` debug, `30` info, `40` warn, `50` error, `60` fatal.

## Application log events

Named events make grepping reliable:

| Event | Meaning |
| --- | --- |
| `examdump.api.started` | server listening |
| `examdump.api.shutting_down` | SIGTERM received |
| `unhandled_error` | 500 with stack |
| `mail.worker_started` | mail worker initialised |
| `mail.scheduled_jobs` | campaign/reminder run result |
| `payments.reconciled` | reconciliation repaired something |
| `razorpay.webhook.invalid_signature` | rejected webhook |

## What must never be logged

- Passwords, tokens, cookies, `Authorization` headers
- Payment secrets, webhook secrets, API keys
- Full request bodies on auth, payment or UPI ingest routes
- Raw bank notification text at `info` level (it contains a payer name/VPA)

Pino redaction is **not configured globally**, so this is a code-review
responsibility. If you add logging to a sensitive route, log identifiers and
outcomes, never payloads.

## Checking a deploy from logs

```bash
sudo podman logs examdump-pro_api_1 | grep -E "started|Database is up to date"
```

A healthy start shows migrations up to date, the mail worker started, and the
listening addresses. A crash loop shows the same lines repeating.

## Related

- [Monitoring](MONITORING.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Secrets management](../security/SECRETS_MANAGEMENT.md)
