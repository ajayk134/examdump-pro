# Relationships

Entity relationships as enforced by foreign keys in the running database.

```bash
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c "
select tc.table_name, kcu.column_name, ccu.table_name as references
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
order by 1, 2;"
```

## Identity

```
users 1───n sessions
users 1───n auth_tokens
users 1───n login_attempts
users 1───n user_roles n───1 roles 1───n role_permissions n───1 permissions
```

`users` is the root of almost every relationship. Deleting a user cascades to
their study data; financial rows are retained.

## Learning

```
users 1───n attempts
attempts 1───n question_results
users 1───n exam_progress      (unique per user + exam_key)
users 1───1 user_stats
users 1───n daily_usage        (unique per user + date)
users 1───n notes, bookmarks, goals
```

`question_results` reference a question by dataset identifiers
(`provider_id`, `exam_key`, `question_id`), **not** by a foreign key to a
questions table — because questions do not live in this database. This is the
direct consequence of [ADR-001](../decisions/ADR-001.md): if a question is
removed upstream, historical results keep their identifiers but the content is
gone.

## Billing

```
plans 1───n subscriptions
users 1───n subscriptions
subscriptions 1───n invoices
subscriptions 1───n payments
payments 1───n refunds
payments 1───1 invoices        (invoices_payment_unique)
coupons 1───n coupon_redemptions n───1 users
users 1───n referrals (referrer_id, referee_id)
users 1───n access_grants n───1 subscriptions
```

`access_grants` is the materialised answer to "may this user open this exam?".
It is derived from `subscriptions` and read on every entitlement check, which
keeps the hot path a single indexed lookup rather than a join across billing
history.

`invoice_sequences` has no FK — it is a counter used inside the same transaction
as the invoice insert to keep numbering gapless.

## UPI

```
upi_orders 1───n upi_matches n───1 upi_notifications
upi_orders 1───n upi_refunds
upi_orders 1───n upi_risk_events
```

`upi_orders` deliberately has **no foreign key to `payments`** — the UPI flow is
first-party and does not go through a provider adapter. It is linked by
`payments.id` only when a card payment and a UPI order coexist for the same user,
which is why `upi_orders.payment_id` is nullable.

Notification-to-order matching is recorded in `upi_matches` with a `decision`
enum. A unique partial index allows at most one *approved* match per order.

## Mail

```
users 1───n email_queue
users 1───n email_preferences      (unique per user + category)
users 1───n mail_logs
email_campaigns 1───n email_queue
email_suppressions               (standalone, keyed by email)
```

`email_suppressions` is keyed by **email address, not user id**, because a
suppressed address must stay suppressed even if the account is deleted or the
person re-registers.

`email_queue.recipient` is a denormalised address so a queued message can still
be delivered after the user record changes.

## Platform

```
users 1───n ai_conversations 1───n ai_messages
users 1───n support_tickets 1───n ticket_messages
users 1───n notifications
users 1───n audit_logs (actor_id, nullable for system actions)
```

`audit_logs.actor_id` is nullable so automated actions (cron, reconciliation)
can be recorded without inventing a user.

## Deletion policy

| Class | Behaviour | Rationale |
| --- | --- | --- |
| Study data | cascade with user | no value without the owner |
| Sessions, tokens | cascade / revoke | security |
| Payments, invoices, refunds, UPI orders | **retained** | financial audit, tax |
| Audit logs | **retained** | security forensics |
| Email suppressions | **retained** | deliverability compliance |

Never hard-delete a row in the retained class. Use a status column instead.

## Related

- [Schema](SCHEMA.md)
- [Indexes](INDEXES.md)
