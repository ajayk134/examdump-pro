---
applyTo: "apps/api/src/db/**,apps/api/drizzle.config.ts,packages/shared/src/schemas.ts"
---

# Database and migration instructions

PostgreSQL 16 is the only application datastore. Drizzle schema files in
`apps/api/src/db/schema/` are the source of truth; generated SQL lives in
`apps/api/src/db/migrations/`.

## Schema groups

| File          | Domain                                                                                  |
| ------------- | --------------------------------------------------------------------------------------- |
| `identity.ts` | users, sessions, auth tokens, roles/permissions, login attempts, audit                  |
| `learning.ts` | attempts, question results, exam progress, stats, bookmarks, notes, goals, usage        |
| `catalog.ts`  | provider/exam metadata only — never question text                                       |
| `billing.ts`  | plans, subscriptions, grants, payments, refunds, coupons, referrals, webhooks, invoices |
| `platform.ts` | settings, flags, notifications, announcements, tickets, errors                          |
| `mail.ts`     | mail logs, queue, templates, preferences, campaigns, suppressions                       |
| `community.ts`| question votes and threaded question comments                                           |
| `enums.ts`    | shared PostgreSQL enum types                                                            |

Export every new table from `apps/api/src/db/schema/index.ts`.

## Making a change

1. Edit the schema file.
2. Generate SQL: `npm run db:generate -w @examdump/api`.
3. Review the generated file. Drizzle does not know your data or traffic patterns.
4. Add indexes for new query patterns; add unique/partial indexes for correctness
   constraints, not just speed.
5. Apply to a scratch database: `npm run migrate -w @examdump/api`.
6. Prove the object exists with `\d <table>` or an equivalent query.
7. Add or update tests that exercise the new column/table.

Rules:

- Migrations are **forward-only**. Never edit an applied migration.
- Add `NOT NULL` only with a default or an in-migration backfill.
- `ALTER TYPE ... ADD VALUE` must remain a standalone statement; the custom
  runner executes statements individually and guards duplicate enum values.
- Do not run `db:push` against production; it bypasses migration history.
- Do not put question text, answer keys, or dataset payloads in PostgreSQL.
- Money is integer minor units. Never use floats or decimals for money.

## Runner behaviour

`apps/api/src/scripts/migrate.ts` searches `MIGRATIONS_DIR`, then
`src/db/migrations`, `apps/api/src/db/migrations`, and `db/migrations` relative to
the working directory. The deployed SQL is in
`/opt/examdump-pro/api/migrations`, which is not a default candidate — always set
`MIGRATIONS_DIR` when migrating from `/opt/examdump-pro/api`.

Migrations do **not** run at API boot. The production procedure is: apply
migrations explicitly, then restart `examdump-api`.

Production history records progress in `drizzle.__drizzle_migrations`. Do not
delete or rewrite those rows.

## Dormant UPI tables

Migrations `0006`–`0008` create UPI collection tables and Gmail OAuth state.
No current schema module, route, or service reads them. Treat them as historical.
`0007_upi_amount_suffix.sql` has a journal timestamp that sorts before `0005`, so
a fresh database skips it; production already has it. Do not build new features
on these tables without an explicit decision.

## Verification

```bash
npm run db:generate -w @examdump/api
npm run migrate -w @examdump/api
npm run typecheck
npm run test:api
```

CI applies migrations to an ephemeral `postgres:16-alpine` service. Never use the
production database for migration tests.
