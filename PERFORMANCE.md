# Performance

**No benchmarks have been run against this system.** This page describes where time
goes and what to measure — it does not invent numbers.

> **Detailed:** [backend](docs/performance/BACKEND.md) ·
> [frontend](docs/performance/FRONTEND.md) ·
> [database](docs/performance/DATABASE.md) ·
> [infrastructure](docs/performance/INFRASTRUCTURE.md) ·
> [budgets](docs/performance/PERFORMANCE_BUDGETS.md)

## Where the time goes

A request passes: nginx → Fastify plugins → auth guard → Zod → service → database
(or GitHub). The expensive parts, in order:

1. **External calls** — GitHub dataset fetch (cached, TTL 300 s), AI provider,
   payment gateway.
2. **Database queries** — anything without a matching index.
3. **Payload size** — large question lists.

JWT verification is intentionally cheap (signature only, no DB).

## The three things that most affect latency

| Lever | Effect |
| --- | --- |
| Dataset cache hit | avoids a GitHub round-trip entirely |
| Correct index | turns a `Seq Scan` into an index scan |
| Page-size clamping | prevents unbounded result sets |

## Known bottlenecks

- **Connection pool is 20** (`DATABASE_POOL_MAX`). A transaction held open across an
  external call starves the pool — this is why payment adapters are called outside
  transactions.
- **Workers share the API event loop.** A large mail campaign competes with request
  handling.
- **`gzip_proxied off`** in nginx means proxied JSON is uncompressed.
- **Cold start** re-populates the dataset cache; first requests per exam are slower.
- **bcrypt at 12 rounds** is deliberately slow — auth endpoints are expensive by
  design.

## Measuring

```bash
# end-to-end latency
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{time_total}\n" https://<domain>/api/health
done | sort -n | awk '{a[NR]=$1} END{print "p50",a[int(NR*0.5)],"p95",a[int(NR*0.95)]}'

# slow queries
sudo -u postgres psql -d examdump -c \
  "select calls, round(mean_exec_time::numeric,2) ms, left(query,60)
   from pg_stat_statements order by mean_exec_time desc limit 10;"

# container resources
sudo podman stats --no-stream
```

## What is missing

No metrics pipeline, no historical latency data, no alerting on performance, no load
test. See [TECH_DEBT.md](TECH_DEBT.md) and [LOAD_TESTING.md](LOAD_TESTING.md).

## Related

- [Performance budgets](docs/performance/PERFORMANCE_BUDGETS.md)
- [Query optimization](docs/database/QUERY_OPTIMIZATION.md)
- [Caching](CACHING.md)
