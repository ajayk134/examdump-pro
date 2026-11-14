# Database schema

PostgreSQL 16. **52 tables**, all application data. Exam question content is
never stored here — see [ADR-001](../decisions/ADR-001.md).

Schema definition: `apps/api/src/db/schema/`. Migrations:
`apps/api/src/db/migrations/`.

## Table groups

Verify any of this against a live database with:

```bash
sudo -u postgres psql -d examdump -c '\dt'
```

### Identity and access (schema/identity.ts)

| Table | Purpose |
| --- | --- |
| `users` | accounts, hashed password + pepper, role, verification state |
| `sessions` | refresh-token sessions (token stored as sha256 hash) |
| `auth_tokens` | email verification and password reset (hashed, single-use) |
| `login_attempts` | rate limiting and lockout evidence |
| `roles`, `permissions`, `role_permissions`, `user_roles` | RBAC |

### Learning (schema/learning.ts)

| Table | Purpose |
| --- | --- |
| `attempts` | one practice/mock/timed session, graded server-side |
| `question_results` | per-question outcome inside an attempt |
| `exam_progress` | per-user, per-exam aggregate progress |
| `user_stats` | streaks, totals, leaderboard inputs |
| `notes`, `bookmarks`, `goals` | personal study artefacts |
| `daily_usage` | quota accounting (questions seen, AI calls) |

### Billing (schema/billing.ts)

| Table | Purpose |
| --- | --- |
| `plans` | seeded catalogue of subscription plans |
| `subscriptions` | active/expired entitlements tied to a plan |
| `payments` | one row per checkout attempt, provider reference |
| `invoices` | human-facing document, sequential number |
| `invoice_sequences` | gapless invoice numbering per period |
| `refunds` | refund lifecycle, provider reference |
| `coupons`, `coupon_redemptions`, `referrals` | discounts and referral credit |
| `access_grants` | derived entitlement rows read by authorization |
| `webhook_events` | idempotency keys for provider callbacks |

### UPI (schema/upi.ts)

| Table | Purpose |
| --- | --- |
| `upi_orders` | one row per payment attempt, unique payable amount |
| `upi_notifications` | parsed bank alerts (email/SMS), raw payload retained |
| `upi_matches` | notification ↔ order match decisions |
| `upi_refunds` | UPI-specific refunds, offline payout reference |
| `upi_risk_events` | scoring decisions, flags, rejection reasons |
| `upi_observer_state` | Gmail observer cursor / health |
| `upi_config` | operator-editable UPI settings; credentials stored encrypted |
| `gmail_oauth_states` | single-use OAuth `state` tokens for the dashboard Connect flow |

### Mail (schema/mail.ts)

| Table | Purpose |
| --- | --- |
| `email_queue` | durable outbox with lease, attempts, next_attempt_at |
| `email_preferences` | per-user opt-in/out by category |
| `email_suppressions` | hard bounces and complaints |
| `email_templates` | editable templates with subject/body |
| `email_campaigns` | bulk sends, checked against suppression + limits |
| `mail_logs` | one row per send attempt, provider response |

### Platform (schema/platform.ts)

| Table | Purpose |
| --- | --- |
| `settings` | typed key/value application settings |
| `feature_flags` | runtime toggles |
| `announcements` | banner content shown to users |
| `audit_logs` | append-only record of privileged actions |
| `error_events` | captured server errors for triage |
| `catalog_providers`, `catalog_exams` | mirrored metadata (not question content) |
| `notifications` | in-app notification rows |
| `support_tickets`, `ticket_messages` | support threads |
| `ai_conversations`, `ai_messages` | AI tutor history |
| `reconciliation_runs` | payment reconciliation audit |

## Relationship overview

Named foreign keys from the live database:

```
users ──┬── sessions, auth_tokens, login_attempts
        ├── attempts ── question_results
        ├── exam_progress, user_stats, daily_usage, goals, notes, bookmarks
        ├── subscriptions ── plans
        │        └── access_grants, invoices
        ├── payments ──┬── invoices, refunds
        │              └── webhook_events
        ├── coupon_redemptions ── coupons
        ├── referrals (referrer and referee)
        ├── ai_conversations ── ai_messages
        └── email_queue, mail_logs, email_preferences, email_suppressions

roles ── role_permissions ── permissions
     └── user_roles ── users

upi_orders ── upi_matches ── upi_notifications
           ├── upi_refunds
           └── upi_risk_events
```

Delete behaviour matters: user-owned rows cascade; financial rows
(`payments`, `invoices`, `upi_orders`) are retained for audit and must not be
hard-deleted.

## Money representation

All amounts are **integer minor units** (paise for INR):

- `payments.amount_minor`
- `upi_orders.amount_paise`, `upi_orders.base_amount_paise`
- `refunds.amount_minor`, `upi_refunds.amount_paise`

Never `numeric`, `float` or `real` for currency. Arithmetic is integer-only in
`apps/api/src/services/upi/money.ts`.

## UPI invariants (do not break)

```sql
-- no two active orders may share a payable amount
upi_orders_active_amount_idx

-- the suffix must stay within 0..99 paise
upi_orders_amount_suffix_ck

-- every order records its unsuffixed price
base_amount_paise  NOT NULL
```

These exist because settlement matches a bank alert to an order **by amount**. Two
active orders with the same amount would make matching ambiguous.

## Related

- [Relationships](RELATIONSHIPS.md)
- [Indexes](INDEXES.md)
- [Migrations](MIGRATIONS.md)
- [Query optimization](QUERY_OPTIMIZATION.md)
- [DATABASE.md](../../DATABASE.md)
