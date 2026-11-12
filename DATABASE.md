# Database

PostgreSQL 16. **52 tables**, all application data. Exam question content is never
stored here — it lives in GitHub.

> **Detailed:** [schema](docs/database/SCHEMA.md) ·
> [relationships](docs/database/RELATIONSHIPS.md) ·
> [indexes](docs/database/INDEXES.md) ·
> [migrations](docs/database/MIGRATIONS.md) ·
> [query optimisation](docs/database/QUERY_OPTIMIZATION.md)

## Quick facts

| | |
| --- | --- |
| Engine | PostgreSQL 16 (`postgres:16-alpine`) |
| Tables | 52 |
| Indexes | 154 |
| Migrations | `0000`–`0007` |
| Schema source | `apps/api/src/db/schema/` (Drizzle) |
| Connection | `apps/api/src/db/client.ts`, pool `DATABASE_POOL_MAX` (20) |

## Table groups

| Group | Tables | File |
| --- | --- | --- |
| Identity | `users`, `sessions`, `auth_tokens`, `login_attempts`, `roles`, `permissions`, `role_permissions`, `user_roles` | `identity.ts` |
| Learning | `attempts`, `question_results`, `exam_progress`, `user_stats`, `notes`, `bookmarks`, `goals`, `daily_usage` | `learning.ts` |
| Billing | `plans`, `subscriptions`, `payments`, `invoices`, `invoice_sequences`, `refunds`, `coupons`, `coupon_redemptions`, `referrals`, `access_grants`, `webhook_events` | `billing.ts` |
| UPI | `upi_orders`, `upi_notifications`, `upi_matches`, `upi_refunds`, `upi_risk_events`, `upi_observer_state` | `upi.ts` |
| Mail | `email_queue`, `email_preferences`, `email_suppressions`, `email_templates`, `email_campaigns`, `mail_logs` | `mail.ts` |
| Platform | `settings`, `feature_flags`, `announcements`, `audit_logs`, `error_events`, `catalog_providers`, `catalog_exams`, `notifications`, `support_tickets`, `ticket_messages`, `ai_conversations`, `ai_messages`, `reconciliation_runs` | `platform.ts` |

## Money

All amounts are **integer paise** (`amount_paise`, `base_amount_paise`,
`amount_minor`, `refunded_minor`). Never floating point. Arithmetic is delegated to
`services/upi/money.ts`.

## Correctness constraints

Three partial unique indexes enforce money-related invariants. They are not
performance indexes and must not be dropped:

```sql
upi_orders_active_amount_idx    -- no two active orders share an amount
upi_matches_order_settled_idx   -- an order settles at most once
upi_notifications_utr_idx       -- a bank UTR is counted once
```

## Migrations

```bash
npm run db:generate -w @examdump/api   # after editing schema
npm run migrate -w @examdump/api       # apply
```

The API container runs `node dist/migrate.js` before starting, so **a restart
applies pending migrations**. Consequence: the database can move ahead of an older
image. A `NOT NULL` column without a default will break the previous build —
rebuild the image in the same deployment. This happened with
`0007_upi_amount_suffix.sql`.

There is no automated down-migration; rollback means the previous image or a
restore. See [ROLLBACK.md](docs/deployment/ROLLBACK.md).

## Verification

```bash
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c '\dt'
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -tAc \
  "select count(*) from drizzle.__drizzle_migrations;"
```

## Related

- [Migration policy](docs/database/MIGRATIONS.md)
- [Backup and restore](docs/deployment/BACKUP_RESTORE.md)
- [Database performance](docs/performance/DATABASE.md)
