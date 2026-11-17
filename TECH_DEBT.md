# Technical debt

Structural weaknesses worth fixing. Distinct from [KNOWN_ISSUES.md](KNOWN_ISSUES.md),
which lists concrete defects.

Ordered by risk, not by effort.

## High

### TD-1 — No off-host backups

`deploy/backup.sh` writes to a local directory on the same VM. A host loss takes the
backups with it. This is the most serious operational gap.

**Fix:** scheduled copy to object storage or a second machine, plus a verification
that the copied archive restores.

### TD-2 — No uptime monitoring or alerting

Nothing notices an outage. Every incident in the runbook would be discovered by a
user.

**Fix:** an external check on `/api/health` with alerting. Smallest change with the
largest risk reduction.

### TD-3 — Workers are coupled to the API process

Cron, mail worker and rate limiting are per process. Horizontal scaling is blocked
until workers are separated.

**Fix:** a single-instance worker process, or cluster-safe job claiming for every
job. Prerequisite for multi-instance.

## Medium

### TD-4 — No data retention pruning

`sessions`, `login_attempts`, `mail_logs`, `email_queue`, `webhook_events` and
`reconciliation_runs` grow without bound. Nothing prunes them.

**Fix:** a scheduled prune with a documented retention window per table. Note that
`audit_logs`, `payments`, `invoices` and `upi_*` must **not** be pruned casually —
they are financial and forensic records.

### TD-5 — No dependency CVE scanning

`npm audit` is not wired into CI. A vulnerable transitive dependency would go
unnoticed.

**Fix:** add `npm audit --omit=dev --audit-level=high` to the CI workflow, or a
Dependabot/Renovate configuration.

### TD-6 — No browser E2E coverage

Login, study flow, checkout rendering and responsive layout have no automated tests.
See [docs/testing/E2E_TESTING.md](docs/testing/E2E_TESTING.md).

**Fix:** a small Playwright suite covering the journeys listed there. Keep it
minimal — E2E is the most brittle layer.

### TD-7 — Manual deployment with a required nginx reload

The `nginx -s reload` step after recreating the API is easy to forget and produces a
502 that looks like a crash.

**Fix:** use `resolver` + a variable in `proxy_pass` so nginx re-resolves
automatically, removing the manual step.

### TD-8 — No resource limits on containers

One runaway container can starve the others on a small VM.

**Fix:** add memory/CPU limits to the systemd units once real usage is
known.

### TD-9 — No automated accessibility testing

Accessibility relies on manual review.

**Fix:** axe-core checks on the main pages, in CI.

## Low

### TD-10 — Two Podman stores on one host

A rootless store coexists with rootful production. It has already caused a false
"production is down" diagnosis.

**Fix:** document the rootful requirement (done) and remove abandoned rootless
containers; avoid creating new ones.

### TD-11 — In-memory rate limiting

Per-process limits multiply with instance count. Acceptable at one instance,
incorrect beyond that.

**Fix:** a shared store if multi-instance is adopted.

### TD-12 — No performance baselines

Budgets exist in [docs/performance/PERFORMANCE_BUDGETS.md](docs/performance/PERFORMANCE_BUDGETS.md)
but none have been measured.

**Fix:** measure and record the "Measured" column.

## Related

- [Known issues](KNOWN_ISSUES.md)
- [ADRs](docs/decisions/README.md)
- [Contributing](CONTRIBUTING.md)
