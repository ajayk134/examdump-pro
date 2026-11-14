# Indexes

**154 indexes** across 52 tables (live count, including primary keys). This page
documents the ones whose behaviour matters. Generated from the running database:

```bash
sudo -u postgres psql -d examdump -c \
  "select tablename, indexname, indexdef from pg_indexes
   where schemaname='public' order by tablename;"
```

## Partial unique indexes — correctness, not speed

These enforce invariants. Removing one is a data-integrity bug, not a
performance regression.

### `upi_orders_active_amount_idx`

```sql
CREATE UNIQUE INDEX upi_orders_active_amount_idx ON public.upi_orders
  USING btree (amount_paise)
  WHERE status = ANY (ARRAY['pending'::upi_order_status, 'under_review'::upi_order_status]);
```

No two **live** orders may share a payable amount. Settlement matches a bank
alert to an order by amount, so a collision would make matching ambiguous and
could credit the wrong user. Completed and cancelled orders fall outside the
predicate, so amounts are reusable afterwards.

Creation therefore retries on unique violation — see
`createUpiOrder()` in `services/upi/order.service.ts`.

### `upi_matches_order_settled_idx`

```sql
CREATE UNIQUE INDEX upi_matches_order_settled_idx ON public.upi_matches
  USING btree (order_id)
  WHERE decision = ANY (ARRAY['auto_approved','manual_approved']);
```

An order can be settled **at most once**, by either path. This is the hard
backstop against double-settlement from a replayed notification or two admins
approving concurrently.

### `upi_notifications_utr_idx`

```sql
CREATE UNIQUE INDEX upi_notifications_utr_idx ON public.upi_notifications
  USING btree (bank_reference) WHERE bank_reference IS NOT NULL;
```

A bank UTR is unique per transaction. Re-observing the same email/SMS cannot
create a second notification.

### `email_queue_dedupe_idx`

```sql
CREATE UNIQUE INDEX email_queue_dedupe_idx ON public.email_queue
  USING btree (dedupe_key) WHERE dedupe_key IS NOT NULL;
```

Prevents duplicate transactional mail when a request retries.

### `payments_order_ref_unique`

Partial unique on `order_ref` where not null — one payment row per gateway order.

## Hot-path indexes

| Table | Index | Serves |
| --- | --- | --- |
| `sessions` | `sessions_token_unique` (unique) | every authenticated request's refresh lookup |
| `sessions` | `sessions_user_idx (user_id, revoked_at)` | "revoke all sessions" |
| `users` | unique on email | login |
| `attempts` | `attempts_user_exam_idx (user_id, exam_key, created_at)` | progress history |
| `attempts` | `attempts_user_status_idx` | resume an in-progress attempt |
| `question_results` | by attempt | grading replay |
| `catalog_exams` | `catalog_exams_search_idx (title, code, provider_title)` | browse/search |
| `catalog_exams` | `catalog_exams_provider_idx` | provider listing |
| `daily_usage` | `daily_usage_unique (user_id, date)` | quota check on every request |
| `email_queue` | `email_queue_due_idx (status, scheduled_for)` | worker batch claim |
| `upi_orders` | `upi_orders_status_expiry_idx (status, expires_at)` | expiry sweeper |
| `upi_orders` | `upi_notifications_status_idx (status, received_at)` | review queue |
| `audit_logs` | `audit_logs_created_idx`, `audit_logs_action_idx` | admin investigation |

## Writing new indexes

1. Identify the query first — `EXPLAIN (ANALYZE, BUFFERS)` on real data.
2. Match the **column order** to the query's equality-then-range shape.
   `(user_id, created_at)` serves `where user_id = $1 order by created_at desc`.
3. Prefer a partial index when you only ever query a subset (`status = 'pending'`).
4. Add the index in a migration; never create it by hand on a live database.
5. For a large table, use `CREATE INDEX CONCURRENTLY` in a dedicated migration —
   it cannot run inside a transaction block.

## Detecting waste

```sql
-- indexes never used since the last stats reset
select relname, indexrelname, idx_scan
from pg_stat_user_indexes
where idx_scan = 0 and indexrelname not like '%_pkey'
order by pg_relation_size(indexrelid) desc;
```

Do not drop a partial unique index just because `idx_scan = 0` — it may exist
purely to enforce correctness.

## Related

- [Schema](SCHEMA.md)
- [Query optimization](QUERY_OPTIMIZATION.md)
- [Database performance](../performance/DATABASE.md)
