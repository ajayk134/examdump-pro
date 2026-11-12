# Load testing

**No load test has been run against this system.** This page describes the intended
approach and the real limits, rather than reporting numbers that do not exist.

## What load testing would usefully answer

1. How many concurrent study sessions one API process sustains before p95 latency
   degrades?
2. Where does the connection pool (20) saturate?
3. Does the mail worker starve request handling under load?
4. What is the dataset cache hit ratio at realistic traffic?

## Why results would be bounded

The deployment is a single host with no redundancy
([ADR-005](docs/decisions/ADR-005.md)):

- **One API process** — workers share its event loop.
- **One PostgreSQL** — no read replicas.
- **In-memory rate limiting** — results from one instance do not generalise to many.

A load test measures *this box*, not the architecture's ceiling. Treat the result as
a capacity number for one VM, not a scalability claim.

## Approach

Use a tool already available rather than adding a dependency: `autocannon` via
`npx`, or a shell loop for a coarse check.

```bash
# coarse baseline
for i in $(seq 1 100); do
  curl -s -o /dev/null -w "%{time_total}\n" https://<domain>/api/exams/providers
done | sort -n | awk '{a[NR]=$1} END{print "p50",a[int(NR*0.5)],"p95",a[int(NR*0.95)],"p99",a[int(NR*0.99)]}'

# load, authenticated read path
npx autocannon -c 50 -d 30 -H "Authorization: Bearer <token>" \
  https://<domain>/api/exams/providers
```

## Rules

- **Never load test production** while real users are active. Use a staging instance
  or a maintenance window.
- **Never load test the payment or UPI ingest endpoints against a live gateway.** Use
  `PAYMENTS_ENABLED=false` and fakes.
- **Watch the database during the run** — pool usage and slow queries matter more than
  request throughput:
  ```sql
  select count(*), state from pg_stat_activity group by state;
  ```
- Record the container resource ceiling (`podman stats`) alongside the result; a
  result without a memory/CPU ceiling is meaningless.

## Scenarios worth testing

| Scenario | Focus |
| --- | --- |
| Catalogue browse | read-heavy, cache miss on first hit |
| Question fetch | dataset cache behaviour, entitlement path |
| Attempt submit | write-heavy, transaction length |
| Mixed study session | realistic blend, 70 % read / 30 % write |

Do not test auth login at volume without accepting that bcrypt is deliberately
expensive — that cost is a feature, not a bug.

## Recording results

Add measured numbers to
[docs/performance/PERFORMANCE_BUDGETS.md](docs/performance/PERFORMANCE_BUDGETS.md),
including the VM size and container limits used.

## Related

- [Performance budgets](docs/performance/PERFORMANCE_BUDGETS.md)
- [Backend performance](docs/performance/BACKEND.md)
- [Testing](TESTING.md)
