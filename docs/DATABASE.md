# Database

ExamDump Pro stores **all application data in PostgreSQL** using
[Drizzle ORM](https://orm.drizzle.team). Exam **questions** are **never** stored
in the database — they are fetched from the private GitHub dataset at request
time. Only searchable catalogue *metadata* (providers/exams) is mirrored into
PostgreSQL for fast discovery.

## Connection

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` (primary connection). |
| `DATABASE_SSL` | `true` to require TLS (managed databases). |
| `DATABASE_POOL_MAX` | Maximum pooled connections (default `20`). |
| `DATABASE_APP_NAME` | `application_name` reported to Postgres. |
| `DATABASE_URL_TEST` | Isolated database used by the test suite. |

The client lives in `apps/api/src/db/client.ts` and uses `postgres.js`.

## Schema

The schema is defined as TypeScript in `apps/api/src/db/schema/` and split by
domain:

| Module | Tables |
| --- | --- |
| `identity.ts` | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `auth_tokens`, `login_attempts`, `audit_logs` |
| `learning.ts` | `attempts`, `question_results`, `exam_progress`, `user_stats`, `bookmarks`, `notes`, `daily_usage`, `goals` |
| `catalog.ts` | `catalog_providers`, `catalog_exams` |
| `billing.ts` | `plans`, `subscriptions`, `access_grants`, `payments`, `refunds`, `coupons`, `coupon_redemptions`, `referrals` |
| `platform.ts` | `notifications`, `settings`, `feature_flags`, `email_templates` |

### Billing & entitlements

- **Plans** carry `scope` (`single` | `all`), `durationDays`, `earlyAccess` and
  `priceMinor` (₹ paise). Prices are never accepted from the client.
- **Subscriptions** link a user to a plan. Single-exam subscriptions store the
  exact `examKey`/`providerId`.
- **Access grants** let admins grant or revoke `single`/`all` access directly
  (with optional expiry), independently of a subscription.
- **Entitlements** are resolved server-side (`entitlement.service.ts`) from
  active subscriptions + grants only. `users.plan`/`premium_until` are a
  denormalised cache for listing/sorting.

## Migrations

Migrations are generated with drizzle-kit from the schema and applied with the
bundled runner:

```bash
# generate after a schema change
npm run db:generate -w @examdump/api

# apply (dev)
npm run migrate -w @examdump/api
```

The API container runs `node dist/migrate.js` automatically on boot before
starting the server. Migration SQL lives in `apps/api/src/db/migrations/`.

## Seeding

```bash
npm run seed -w @examdump/api
```

Seeds the built-in roles/permissions, the four INR plans, settings, feature
flags, email templates, a `WELCOME20` coupon, the admin account, and (in
non-production) a demo learner. Set `ENABLE_DATASET_SYNC=true` to also sync the
GitHub catalogue.

## Backup & restore

`deploy/backup.sh` produces a custom-format `pg_dump` and `deploy/restore.sh`
restores it. Both run `postgres:16-alpine` via podman/docker.

```bash
export DATABASE_URL="$(doppler secrets get DATABASE_URL --plain --project examdump-pro --config prd)"
./deploy/backup.sh
./deploy/restore.sh ./backups/examdump_20260101T020000Z.pgdump
```
