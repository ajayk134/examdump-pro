---
description: "Make a safe database schema change with a reviewed migration and tests"
---

# Database change

## 1. Design

- State the table, columns, types, nullability, defaults, indexes, and
  constraints.
- Confirm the data belongs in PostgreSQL. Never put exam question content,
  answer keys, or dataset payloads in the database.
- Use integer minor units for money. Use timestamps with time zone.
- Add indexes for the query patterns the feature will use. Add unique/partial
  indexes for correctness, not only performance.
- Consider existing rows: a `NOT NULL` column needs a default or an in-migration
  backfill.

## 2. Implement

1. Edit the relevant file in `apps/api/src/db/schema/` and export it from
   `schema/index.ts`.
2. Generate SQL:

```bash
npm run db:generate -w @examdump/api
```

3. Review the generated migration. Check for destructive statements, missing
   backfills, enum ordering, and index names.
4. Never edit an applied migration. Add a new one instead.
5. Never run `db:push` against production.

## 3. Test locally

Use a scratch database, never production:

```bash
createdb examdump_dev
DATABASE_URL="postgres://.../examdump_dev" npm run migrate -w @examdump/api
```

Prove the object exists (`\d <table>`) and add a test that exercises the new
column or constraint. API integration tests use `DATABASE_URL_TEST` and apply
migrations in CI.

## 4. Deploy notes

- Migrations do not run at API boot.
- The deployed SQL folder is `/opt/examdump-pro/api/migrations`, which the runner
  does not search by default. Set `MIGRATIONS_DIR` explicitly.
- Apply migrations before restarting `examdump-api`.
- There is no automated database rollback. Do not drop or restore production
  without explicit authorization.

## 5. Report

List the schema diff, migration file, backfill strategy, indexes/constraints,
tests run, and any deployment step the operator must perform.
