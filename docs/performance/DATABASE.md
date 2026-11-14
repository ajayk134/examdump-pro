# Database performance

PostgreSQL 16, 52 tables, 154 indexes. Operations that matter.

## Configuration

Defaults from the `postgres:16-alpine` image, overridden only by what
the native cluster provides (user, password, database). No `postgresql.conf`
tuning is applied.

If load increases, the first knobs, in order:

| Setting | Effect |
| --- | --- |
| `max_connections` | ceiling for `DATABASE_POOL_MAX`; must exceed it |
| `shared_buffers` | ~25 % of container memory as a starting point |
| `work_mem` | per-sort/hash operation; raise only if plans show external merges |
| `effective_cache_size` | informs the planner about OS cache |
| `random_page_cost` | lower (1.1) on SSD |

Do not change these speculatively. Measure first.

## Transactions

- Keep transactions **short**. The `AnyPgTx` helper exists for atomic multi-step
  writes (settlement, refunds, invoice numbering).
- **Never** hold a transaction across an external HTTP call. Payment gateway calls
  happen outside and are written afterwards.
- Prefer a single `update ... where` over read-then-write; it avoids a lost-update
  window and holds the lock for less time.

## Lock contention

Find blockers:

```sql
select pid, now() - xact_start as age, wait_event_type, wait_event, left(query,60)
from pg_stat_activity
where xact_start is not null
order by age desc;
```

Long transactions block vacuum and inflate tables. There is no monitoring alarm
for this — check it during incidents.

## Vacuum

`autovacuum` is enabled by default. After bulk work (campaign import, subscription
sweep, dataset re-sync) run:

```bash
sudo -u postgres psql -d examdump -c "VACUUM (ANALYZE);"
```

Check for tables that need it:

```sql
select relname, n_dead_tup, last_autovacuum
from pg_stat_user_tables
order by n_dead_tup desc limit 10;
```

## Index maintenance

Rebuild or reindex only with evidence — typically a bloated index on a
heavily-updated table (`sessions`, `email_queue`):

```sql
REINDEX INDEX CONCURRENTLY <index_name>;
```

Dropping an unused index is safe for performance; dropping a **partial unique**
index is not (it enforces correctness). See [Indexes](../database/INDEXES.md).

## Growth management

Tables that grow without bound:

| Table | Growth | Mitigation |
| --- | --- | --- |
| `sessions` | per login/refresh | prune revoked/expired |
| `login_attempts` | per login attempt | prune older than retention window |
| `mail_logs` | per email | prune older than retention window |
| `audit_logs` | permanent (by design) | archive, never delete casually |
| `email_queue` | per send | completed rows prunable |
| `webhook_events`, `reconciliation_runs` | per event | prune old |

**No retention job exists yet.** This is documented as debt in
[TECH_DEBT.md](../../TECH_DEBT.md), not silently ignored.

## Related

- [Query optimization](../database/QUERY_OPTIMIZATION.md)
- [Indexes](../database/INDEXES.md)
- [Backend performance](BACKEND.md)
