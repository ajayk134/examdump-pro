# Query optimization

How to find and fix slow queries. Only techniques that apply to this codebase are
listed; no benchmark numbers are claimed because none have been measured.

## Measure before changing anything

```bash
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c "
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
select id, created_at from attempts
where user_id = '...' and exam_key = '...'
order by created_at desc limit 20;"
```

Read the plan for:

| Signal | Meaning |
| --- | --- |
| `Seq Scan` on a large table | missing or unused index |
| `Rows Removed by Filter` high | index does not match the predicate |
| `Nested Loop` over many rows | N+1 in SQL form |
| `Sort` with `external merge` | `work_mem` too small for the sort |
| Heap Fetches high on an index scan | needs `VACUUM`, or a wider index |

## Finding slow queries

Enable `pg_stat_statements` and inspect it:

```sql
select queryid, calls, round(total_exec_time::numeric,1) as total_ms,
       round(mean_exec_time::numeric,2) as mean_ms, rows, query
from pg_stat_statements
order by total_exec_time desc
limit 20;
```

Find currently-running long queries:

```sql
select pid, now() - query_start as duration, state, left(query, 80)
from pg_stat_activity
where state <> 'idle' and now() - query_start > interval '5 seconds'
order by duration desc;
```

## Patterns used in this codebase

### Cursor-free pagination with limits

List endpoints use `apps/api/src/lib/pagination.ts` and always cap the page size.
An unbounded `select` on `attempts`, `mail_logs` or `audit_logs` will eventually
time out.

### Index-aligned ordering

`attempts_user_exam_idx (user_id, exam_key, created_at)` exists so this is an
index scan with no sort:

```sql
where user_id = $1 and exam_key = $2 order by created_at desc limit 20
```

Ordering by a column **not** in the index forces a sort. If a new sort order is
needed, add a matching index rather than relying on `work_mem`.

### Existence checks instead of counts

For "does this user have an active subscription", prefer `limit 1`:

```sql
select 1 from access_grants
where user_id = $1 and exam_key = $2 and revoked_at is null limit 1;
```

`count(*)` scans every matching row to produce a number nobody displays.

### Batch queue claims

The mail worker claims a batch in one statement with `FOR UPDATE SKIP LOCKED`, so
concurrent workers never block each other:

```sql
update email_queue set status = 'sending', locked_until = now() + interval '...'
where id in (
  select id from email_queue
  where status = 'pending' and scheduled_for <= now()
  order by scheduled_for
  limit $1
  for update skip locked
)
returning *;
```

Do not replace this with `select` then `update` — that reintroduces double-send.

## Anti-patterns to avoid

**N+1 in application code.** A loop that fetches per row inside a request. Batch
with `inArray`:

```ts
// avoid
for (const id of ids) await db.select().from(users).where(eq(users.id, id));

// prefer
await db.select().from(users).where(inArray(users.id, ids));
```

**Transactions held across HTTP calls.** Payment adapters are called *outside*
the transaction and the result written after. Holding a transaction open during
a 20 s gateway call exhausts the pool (`DATABASE_POOL_MAX`, default 20) and holds
locks.

**JSON aggregation in the database.** Grouping is done in TypeScript; the database
returns flat rows. Keeps plans simple and avoids surprises when shapes change.

## Maintenance

`autovacuum` handles normal bloat. After a bulk operation (campaign import,
subscription sweep) it is worth running:

```bash
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c "VACUUM (ANALYZE)";
```

Check bloat and long-running transactions:

```sql
select pid, now() - xact_start as age, state, left(query, 60)
from pg_stat_activity
where xact_start is not null and now() - xact_start > interval '1 minute';
```

A long-lived transaction blocks vacuum and inflates every table it touches.

## Related

- [Indexes](INDEXES.md)
- [Database performance](../performance/DATABASE.md)
- [Schema](SCHEMA.md)
