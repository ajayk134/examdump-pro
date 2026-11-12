---
applyTo: "apps/api/src/db/**/*.{ts,sql},apps/api/src/db/migrations/**"
---
# Database rules

- PostgreSQL 16 only. All application data lives here; exam question content
  never does.
- Schema is defined in Drizzle (`apps/api/src/db/schema/`). Generate migrations;
  do not hand-write then hand-apply SQL.

```bash
npm run db:generate -w @examdump/api   # after editing schema
npm run migrate -w @examdump/api       # apply
```

- Migrations are **forward-only** and numbered. Never edit a migration that has
  already been applied anywhere.
- Adding a `NOT NULL` column requires a default or an in-migration backfill.
  A `NOT NULL` column with no default will break any container built before the
  migration — rebuild the image in the same deployment.
- Money is stored as integer paise (`amount_paise`, `base_amount_paise`). Never
  `numeric` floats for currency.
- UPI invariants that must not regress:
  - `upi_orders_active_amount_idx` — partial unique index preventing two active
    orders from sharing `amount_paise`.
  - `upi_orders_amount_suffix_ck` — CHECK constraining the suffix to 0–99 paise.
  - `base_amount_paise` is `NOT NULL`.
- Add an index for every new query pattern; verify with `EXPLAIN`.
- Never commit database dumps or files containing real user data.
