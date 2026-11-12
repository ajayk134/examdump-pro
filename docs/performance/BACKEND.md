# Backend performance

Fastify request handling, database access and background work.

> No latency figures are quoted here. None have been measured under load — see
> [performance budgets](PERFORMANCE_BUDGETS.md) for what to measure and how.

## Request lifecycle cost

Per request, in order (`apps/api/src/app.ts`):

| Step | Cost | Notes |
| --- | --- | --- |
| `@fastify/cookie` | negligible | header parse |
| `@fastify/cors` | negligible | allow-list compare |
| `@fastify/helmet` | negligible | header setting |
| `@fastify/rate-limit` | one counter op | in-process by default |
| guard (`requireAuth`) | **one JWT verify** (HS256, no DB) | cheap |
| `requirePermission` | **one DB query** | RBAC resolution |
| handler | varies | 0–N queries |
| serialisation | negligible | plain objects |

The expensive parts are DB queries and any external HTTP call. Keep both out of
loops.

## Connection pooling

`apps/api/src/db/client.ts` — `postgres()` with `max: DATABASE_POOL_MAX`
(default 20).

The pool is the hard ceiling on concurrency. Consequences:

- A long transaction holds a connection. N concurrent slow transactions starve
  every other request.
- **Never hold a transaction open across an external HTTP call.** Payment
  adapters are called outside the transaction and the result written after
  (`services/subscription.service.ts`).
- `DATABASE_POOL_MAX` must stay below PostgreSQL's `max_connections` minus
  headroom for admin sessions. Raising it without raising `max_connections`
  produces `too many clients` errors under load.

## Pagination

`apps/api/src/lib/pagination.ts` clamps page size to `MAX_PAGE_SIZE`. Unbounded
list endpoints are the most common way this API degrades — `attempts`,
`mail_logs`, `audit_logs` and `upi_notifications` all grow without bound.

## Background work

Workers run **in the API process** (`apps/api/src/index.ts`):

| Worker | Interval | Contention protection |
| --- | --- | --- |
| Mail drain | `MAIL_WORKER_INTERVAL_SECONDS` (20s) | `FOR UPDATE SKIP LOCKED` batch claim |
| Dataset sync | `DATASET_SYNC_CRON` | single cron leader per process |
| Subscription expiry | daily | idempotent update |
| Payment reconciliation | `PAYMENT_RECONCILE_CRON` | `reconciliation_runs` record |

`FOR UPDATE SKIP LOCKED` means two workers never claim the same email and never
block each other. This is also why the design survives a restart: the lease
(`MAIL_LOCK_LEASE_SECONDS`) expires and the row becomes claimable again.

`timer.unref()` is used so an idle queue does not keep the process alive.

## Caching

Only one cache exists: the dataset `TtlCache` in
`packages/data-client/src/cache.ts` (TTL + LRU, default 300 s, 400 entries). It
is in-process, so each API instance has its own.

There is no HTTP response cache and no Redis. `settings` and RBAC lookups hit the
database; they are small and indexed, and adding a cache would introduce
invalidation problems for little gain at current scale.

## Rate limiting

`@fastify/rate-limit` with `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW`. The default
store is in-memory, so limits are **per process**. With more than one API
instance, effective limits multiply — a known scaling limitation.

## Memory and CPU

- Streaming is not used for dataset reads; a full question payload is buffered.
  `DATASET_MAX_QUESTIONS_PER_REQUEST` bounds it.
- Avoid `JSON.parse(JSON.stringify(x))` for deep copies on hot paths.
- Prefer `limit 1` existence checks over `count(*)`.
- The API is single-threaded; a synchronous CPU-heavy operation blocks every
  other request. Image or PDF processing would need to move off-process — nothing
  currently does this.

## Profiling

```bash
# event-loop lag (add temporarily)
node --cpu-prof dist/index.js

# slow queries
psql -c "select query, mean_exec_time from pg_stat_statements order by mean_exec_time desc limit 10;"
```

`LOG_LEVEL=debug` increases log volume significantly; do not leave it on in
production.

## Related

- [Database performance](DATABASE.md)
- [Infrastructure](INFRASTRUCTURE.md)
- [Query optimization](../database/QUERY_OPTIMIZATION.md)
- [Performance budgets](PERFORMANCE_BUDGETS.md)
