# Disaster recovery

What survives what. Be honest about the gaps — this deployment has no redundancy.

## Failure scenarios

| Scenario | Impact | Recovery | RTO |
| --- | --- | --- | --- |
| API container crashes | site 500s | `restart: unless-stopped` restarts it | seconds |
| API container OOM/unhealthy | 500 or 502 | restart; check `podman logs` | minutes |
| nginx restart | brief 502 | start nginx | seconds |
| Postgres container crashes | 500s, no data loss | container restarts, WAL replays | minutes |
| Postgres volume corrupt | total data loss without backup | restore latest dump | 30–60 min |
| Disk full | writes fail, Postgres may stop | free space, then verify integrity | 30 min |
| Host reboot | all down | containers restart automatically; verify Postgres first | 5 min |
| **Host lost entirely** | **everything** | rebuild + restore, **if** an off-host backup exists | hours |
| DNS/TLS expiry | site unreachable | renew certificate, reload nginx | 15 min |
| Doppler unavailable | existing containers keep running; new starts fail | restore from a local copy, or pause deploys | n/a |

## The critical gap: backups are on the same host

`deploy/backup.sh` writes to a local directory on the same VM. **If the VM is
lost, the backups are lost.** This is the single most serious operational risk in
the current setup.

Mitigation, in priority order:

1. Copy dumps off-host on a schedule (object storage or a second machine).
2. Verify the off-host copy restores — an untested copy is not a backup.
3. Keep the last N dumps somewhere the deployment credentials cannot delete.

## Rebuilding from zero

Rough sequence on a new host:

```bash
# 1. base host
sudo dnf install -y podman podman-compose git
#    install doppler CLI, nginx, obtain TLS certificates

# 2. code
git clone https://github.com/ajayk134/examdump-pro.git ~/projects/examdump-pro
cd ~/projects/examdump-pro && npm ci
npm run build -w @examdump/shared && npm run build -w @examdump/data-client

# 3. database first — restore BEFORE starting the API
cd deploy
sudo podman compose -p examdump-pro up -d postgres
sudo podman cp <dump> examdump-pro_postgres_1:/tmp/restore.pgdump
sudo podman exec examdump-pro_postgres_1 \
  pg_restore --clean --if-exists --no-owner -U examdump -d examdump /tmp/restore.pgdump

# 4. application
doppler run --project examdump-pro --config prd -- \
  podman compose -p examdump-pro up -d --build
sudo podman exec examdump-pro_nginx_1 nginx -s reload

# 5. verify
curl -s https://<domain>/api/health
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -tAc \
  "select count(*) from users;"
```

Order matters: restoring into a database the API is already writing to causes
conflicts and lost rows.

## What a restore does not bring back

| Item | Where it lives | Recovery |
| --- | --- | --- |
| Exam question content | GitHub (`exam-data`) | available, just needs `GITHUB_TOKEN` |
| Secrets | Doppler | available, needs a working token |
| TLS certificates | host filesystem | reissue via Let's Encrypt |
| DNS records | registrar | unchanged unless the domain is lost |
| Container images | local Podman store | rebuild from Dockerfiles |
| Uploaded files | none exist | n/a |

A restored database alone is **not** a working system.

## Recovery checklist

- [ ] New host provisioned, Podman + compose installed
- [ ] Doppler token available on the host
- [ ] Backup dump copied to the host
- [ ] Dump verified (`pg_restore --list` succeeds)
- [ ] Postgres running, restore completed
- [ ] Row counts sanity-checked (`users`, `subscriptions`, `payments`)
- [ ] Application containers started
- [ ] `nginx -s reload` executed
- [ ] `/api/health` returns ok with database connected
- [ ] `/api/upi/status` shows the intended flags
- [ ] A real login works end to end
- [ ] One exam page loads and a question is served
- [ ] Off-host backup schedule re-established

## Related

- [Backup and restore](BACKUP_RESTORE.md)
- [Rollback](ROLLBACK.md)
- [Incident response](../operations/INCIDENT_RESPONSE.md)
- [Production](PRODUCTION.md)
