# Database & data model

MongoDB (Atlas) stores **only application data**. Exam questions live in a
private GitHub repository and are fetched at request time.

Database name is controlled by `MONGODB_DB` (default `examdump`).

## Collections

### `users`
| Field | Notes |
| --- | --- |
| `email` (unique), `name` | lowercased email |
| `passwordHash` | bcrypt + pepper, `select: false` |
| `googleId` | partial unique index (only when a string) |
| `role` | `user` \| `admin` |
| `plan` | `free` \| `premium` |
| `premiumUntil` | source of truth for effective premium |
| `emailVerified`, `suspended`, `deletedAt` | lifecycle flags |
| `referralCode` (unique), `referredBy` | referral graph |
| `preferences` | theme + notification toggles |
| `lastLoginAt`, `passwordChangedAt` | security metadata |

Indexes: `email`, `role`, `plan`, `emailVerified`, `suspended`, `createdAt`,
`googleId` (partial unique), `referralCode` (unique).

### `sessions`
Refresh sessions. `refreshTokenHash` unique; `expiresAt` has a TTL index;
`revokedAt` supports immediate logout. Indexed by `userId + revokedAt`.

### `authtokens`
Email-verification and password-reset tokens. `tokenHash` unique; `expiresAt`
TTL; `usedAt` prevents replay.

### `loginattempts`
Brute-force tracking (`email`, `ip`, `success`) with a 30-day TTL.

### `attempts`
One document per practice/mock/timed session: provider, exam key/code, mode,
status, `questionIds`, graded `answers`, counts, score, timing. Indexed by
`userId + createdAt`, `userId + examKey`, `userId + status`.

### `questionresults`
Per-user, per-question aggregate (`attempts`, `correct`, `lastCorrect`, `topic`).
Unique on `userId + examKey + questionId`; indexed by `userId + topic` for weak
topic analysis.

### `examprogress`
Per-user, per-exam progress (`questionsSeen`, `correct`, `wrong`, `bestScore`,
`lastStudiedAt`). Unique on `userId + examKey`.

### `userstats`
Global totals, streaks and study time. Unique on `userId`.

### `bookmarks`, `notes`
User annotations. Unique on `userId + examKey + questionId`; recent-first
indexes for listing.

### `dailyusage`
Daily counters (`questionsViewed`, `mockExams`, `randomQuestions`,
`aiExplanations`) enforcing quotas. Unique on `userId + date`.

### `plans`, `subscriptions`, `payments`
Plan catalogue, subscription lifecycle (`active|trialing|past_due|canceled|expired`)
and payment history (currently `provider: mock`). Subscriptions indexed by
`userId + status` and `currentPeriodEnd`.

### `coupons`, `couponredemptions`
Coupon catalogue and per-user redemption (unique `couponId + userId`) to prevent
reuse.

### `referrals`
Referrer → referee graph, completed on email verification, with reward days.

### `notifications`
In-app notifications, indexed by `userId + read + createdAt`.

### `auditlogs`
Security and admin events (`action`, actor, target, IP, user-agent, metadata).
Indexed by `createdAt` and `action + createdAt`.

### `settings`
Singleton document (`key: "global"`) with entitlement limits, registration and
maintenance toggles, and an announcement string.

### `catalogproviders`, `catalogsexams` (`catalog_exams`)
Metadata index synced from GitHub: provider title/file/slug, exam key/code/title,
question counts. **No question bodies.** Text + compound indexes power discovery
and search. Unique on `providerId + key`.

## Why questions are not stored

The dataset is large (~70 MB, thousands of files) and is the project's protected
asset. Keeping it in GitHub with server-side access means:

- the raw data is never duplicated into application backups;
- the token and repository stay private;
- updates are picked up without migrations;
- per-plan gating happens in a single place (the API).

## Indexes & TTLs

Indexes are declared on the schemas and created automatically (`autoIndex`).
In production you may disable `autoIndex` and run index creation during deploy.
TTL indexes exist on `sessions.expiresAt`, `authtokens.expiresAt` and
`loginattempts.createdAt`.

## Backup & restore

Use `deploy/backup.sh` (cron-friendly) and `deploy/restore.sh`. Backups are
`mongodump` archives compressed with gzip and pruned by age. Test restores
periodically against a scratch database.

## Migrations

Migrations are declared in `apps/api/src/scripts/migrate.ts` and recorded in a
`migrations` collection so each runs exactly once. Run them before deploying
schema-affecting changes:

```bash
doppler run --project examdump-pro --config prd -- npm run migrate -w @examdump/api
# or, from a checkout with env vars set:
npm run migrate -w @examdump/api
```

Add a new entry to the `migrations` array (id, description, `up(db)`) and test it
against a scratch database first. Most schema changes are additive and applied
automatically by Mongoose; use migrations for data backfills or destructive
changes.