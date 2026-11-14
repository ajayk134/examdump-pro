# Migrations

Forward-only, numbered SQL applied by Drizzle. Directory:
`apps/api/src/db/migrations/`.

## Current set

| # | File | Adds |
| --- | --- | --- |
| 0000 | `outgoing_husk.sql` | baseline schema |
| 0001 | `billing_hyperswitch_multi_exam.sql` | billing, plans, multi-exam entitlement |
| 0002 | `enum_multi_hyperswitch.sql` | enum values for the new billing model |
| 0003 | `ai_tutor_chat.sql` | `ai_conversations`, `ai_messages` |
| 0004 | `mail_logs.sql` | outbound mail logging |
| 0005 | `email_center.sql` | queue, templates, campaigns, preferences, suppression |
| 0006 | `upi_payments.sql` | the UPI collection tables |
| 0007 | `upi_amount_suffix.sql` | unique-amount suffix guarantee |

Migrations 0004–0007 were added as part of the mail and UPI work; 0000–0003 form
the original schema.

## How migrations run

Two paths, both executing `apps/api/src/db/apply-migrations.ts`:

- **Manually:** `npm run migrate -w @examdump/api`
- **Automatically:** the API container command is
  `node dist/migrate.js && node dist/index.js`, so **starting the API applies
  pending migrations**.

That automatic step is convenient and dangerous: it means the database can move
ahead of a container built from an older commit.

### The drift hazard (real incident)

`0007_upi_amount_suffix.sql` adds `base_amount_paise NOT NULL` **with no
default**. An API container built before that commit does not know the column, so
its inserts fail:

```
null value in column "base_amount_paise" of relation "upi_orders"
violates not-null constraint
```

This was invisible in production because `PAYMENTS_ENABLED=false` meant no UPI
order was ever created. **Rule: whenever a migration adds a `NOT NULL` column,
rebuild the API image in the same deployment.**

## Writing a migration

```bash
# 1. edit the schema
vim apps/api/src/db/schema/billing.ts

# 2. generate SQL
npm run db:generate -w @examdump/api

# 3. review it — generated SQL is a draft, not an answer
cat apps/api/src/db/migrations/000N_*.sql

# 4. apply locally
npm run migrate -w @examdump/api
```

Rules:

- **Never edit an applied migration.** Add a new one.
- Adding a `NOT NULL` column requires a default **or** an in-migration backfill:

  ```sql
  ALTER TABLE t ADD COLUMN c integer;
  UPDATE t SET c = <expression> WHERE c IS NULL;
  ALTER TABLE t ALTER COLUMN c SET NOT NULL;
  ```

- Keep enum changes additive; dropping an enum value requires a full table
  rewrite.
- Do not run `CREATE INDEX CONCURRENTLY` in a migration that the API executes at
  boot — it cannot run inside a transaction. Ship it as a manual step.
- Never reference exam question content in a migration.

## Verifying state

```bash
# applied count and last entry
sudo -u postgres psql -d examdump -c \
  "select count(*) from drizzle.__drizzle_migrations;"

# confirm a specific object exists
sudo -u postgres psql -d examdump -c \
  "\d upi_orders"
```

A container that logs `Database is up to date.` has nothing pending.

## Rollback

There is **no automated down-migration.** Rolling back means restoring a backup:

1. Take a fresh dump before any risky deploy (`deploy/backup.sh`).
2. Prove it restores into a scratch database.
3. Only then consider reverting the image.

Because migrations are additive, reverting the *application image* while leaving
the schema forward is usually safe — new nullable columns are ignored by old
code. The exception is a `NOT NULL` addition, which breaks the older image.

See [Rollback](../deployment/ROLLBACK.md).

## Related

- [Schema](SCHEMA.md)
- [Indexes](INDEXES.md)
- [Backup and restore](../deployment/BACKUP_RESTORE.md)
