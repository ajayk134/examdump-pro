# Performance budgets

**No benchmark has been run against this system.** Every number below is a target
to measure against, not a measurement. Treat this file as a checklist, and record
real results in it once collected.

## How to measure

```bash
# API latency, rough
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{time_total}\n" \
    https://<host>/api/health
done | sort -n | awk '{a[NR]=$1} END{print "p50",a[int(NR*0.5)],"p95",a[int(NR*0.95)]}'

# database timings
sudo -u postgres psql -d examdump -c \
  "select calls, round(mean_exec_time::numeric,2) mean_ms, left(query,60)
   from pg_stat_statements order by mean_exec_time desc limit 10;"

# container resource use
systemd-cgtop -1
```

Frontend: Chrome DevTools Lighthouse and the Performance panel. Do not add a
dependency for this.

## Proposed budgets

Fill in **Measured** after a real run. A target without a measurement is a wish.

### API

| Endpoint class | Target p95 | Measured |
| --- | --- | --- |
| `GET /api/health` | < 50 ms | — |
| Catalogue/list (`/api/exams`) | < 300 ms | — |
| Question fetch (`/api/exams/:p/:e/questions`) | < 500 ms cold, < 100 ms cached | — |
| Attempt submit (grading) | < 500 ms | — |
| Analytics dashboard | < 800 ms | — |
| Admin list endpoints | < 800 ms | — |
| AI explanation | bounded by provider, not app | — |

### Frontend

| Metric | Target | Measured |
| --- | --- | --- |
| LCP (study page, mobile) | < 2.5 s | — |
| INP | < 200 ms | — |
| CLS | < 0.1 | — |
| Initial JS (per route, gzip) | < 250 kB | — |
| Total CSS | < 60 kB | — |

### Database

| Signal | Target | Measured |
| --- | --- | --- |
| No `Seq Scan` on tables > 10k rows in hot paths | required | — |
| `pg_stat_statements` mean for any query | < 50 ms | — |
| Connections in use / `max_connections` | < 70 % | — |
| Longest transaction | < 1 s | — |

### Infrastructure

| Signal | Target | Measured |
| --- | --- | --- |
| Container memory (api) | < 512 MB steady | — |
| Container memory (web) | < 512 MB steady | — |
| Container memory (postgres) | < 1 GB steady | — |
| Disk for PostgreSQL | < 70 % used | — |

## When a budget is exceeded

1. Reproduce with a measurement, not an impression.
2. `EXPLAIN (ANALYZE, BUFFERS)` the query involved.
3. Check for a missing index before adding a cache.
4. Check for an N+1 before changing the schema.
5. Only then consider caching — and account for invalidation.

Documented regressions belong in [TECH_DEBT.md](../../TECH_DEBT.md), not silently
accepted.

## Load testing

No load test exists. See [LOAD_TESTING.md](../../LOAD_TESTING.md) for the intended
approach and why a single-host deployment bounds the useful results.

## Related

- [Backend](BACKEND.md)
- [Frontend](FRONTEND.md)
- [Database](DATABASE.md)
- [Infrastructure](INFRASTRUCTURE.md)
- [PERFORMANCE.md](../../PERFORMANCE.md)
