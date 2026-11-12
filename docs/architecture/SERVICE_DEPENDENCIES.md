# Service dependencies

Which service calls which, and what each one touches. Use this before changing a
service to see what depends on it.

## Layer rules

```
routes/         HTTP only: guards, validation, serialization. No business logic.
services/       Business logic + all database writes. No HTTP types.
db/schema/      Table definitions. No queries.
lib/            Cross-cutting utilities (auth, errors, tx, pagination).
packages/       Pure, framework-free code shared with the frontend.
```

A route must not query the database directly. A service must not import from
`routes/`. Violating this is the most common way this codebase degrades.

## Dependency graph

```
auth.service ──────┬──▶ rbac.service ──▶ roles, permissions, user_roles
                   ├──▶ tokens / passwords
                   └──▶ mail.notify (verification, reset)

entitlement.service ──▶ subscription.service ──▶ payments / invoices / refunds
                   └──▶ settings.service

catalog.service ──▶ data-client (GitHub)
                └──▶ catalog_providers, catalog_exams

dataset.service ──▶ data-client
                └──▶ entitlement.service (slicing)

analytics.service ──▶ attempts, question_results, user_stats
leaderboard.service ──▶ user_stats

ai.service / ai-chat.service ──▶ external provider
                             └──▶ ai_conversations, ai_messages

webhook.service ──▶ payments.registry (adapter)
                └──▶ subscription.service
                └──▶ invoices

upi/order.service ──▶ subscription.service (on settlement)
                  ├──▶ upi/parser, upi/risk, upi/money, upi/uri, upi/qr
                  └──▶ mail.notify

mail/queue.service ──▶ mail/render, placeholders, policy, transport
mail/campaign.service ──▶ mail/queue.service
```

## Service reference

| Service | Responsibility | Writes |
| --- | --- | --- |
| `auth.service` | register, login, refresh, verify, reset | `users`, `sessions`, `auth_tokens`, `login_attempts` |
| `rbac.service` | role→permission resolution | none (reads) |
| `settings.service` | typed settings access | `settings` |
| `catalog.service` | provider/exam catalogue | `catalog_providers`, `catalog_exams` |
| `dataset.service` | question fetching + slicing | none |
| `entitlement.service` | who may see what | none |
| `subscription.service` | plan activation, expiry, grants | `subscriptions`, `access_grants`, `invoices`, `invoice_sequences` |
| `analytics.service` | progress, weak topics, stats | `user_stats`, `exam_progress` |
| `audit.service` | append-only audit trail | `audit_logs` |
| `ai.service` | single-shot AI calls | `ai_conversations`, `ai_messages` |
| `ai-chat.service` | multi-turn tutoring | `ai_conversations`, `ai_messages` |
| `webhook.service` | gateway callbacks, reconciliation | `webhook_events`, `payments`, `subscriptions` |
| `notification.service` | in-app notifications | `notifications` |
| `usage.service` | daily quota accounting | `daily_usage` |
| `upi/order.service` | UPI order lifecycle | `upi_orders`, `upi_notifications`, `upi_matches`, `upi_refunds` |
| `upi/risk` | notification scoring | `upi_risk_events` |
| `payments/registry` | adapter selection | none |
| `payments/*.adapter` | provider-specific API calls | none (returns data) |
| `mail/queue.service` | enqueue, claim, retry | `email_queue`, `mail_logs` |
| `mail/policy.service` | suppression, preferences, rate limits | `email_suppressions` |

## External dependencies

| Dependency | Used by | Failure mode |
| --- | --- | --- |
| GitHub Git Data/Contents API | `data-client` | `DatasetError` → 502 |
| SMTP server | `mail/transport` | queued, retried, exponential backoff |
| AI provider (OpenAI-compatible) | `ai.service`, `ai-chat.service` | request fails, app unaffected |
| Hyperswitch | `payments/hyperswitch.client` | checkout unavailable |
| Razorpay | `payments/razorpay.adapter` | checkout unavailable |
| Gmail API | `upi/gmail-observer` | observer pauses, orders still created |
| Google OIDC | `auth.service` | Google sign-in unavailable, password login still works |

## Database access rules

- **Pool:** `postgres()` in `apps/api/src/db/client.ts`, `max` =
  `DATABASE_POOL_MAX` (default 20).
- **Transactions:** use the `AnyPgTx` type from `apps/api/src/lib/tx.ts` for
  helpers that must run atomically (settlement, refunds, invoice numbering).
- **Never** hold a transaction open across an external HTTP call — the payment
  adapters are called outside the transaction and the result written after.
  This prevents lock contention and pool exhaustion.

## Related

- [System design](SYSTEM_DESIGN.md)
- [Data flow](DATA_FLOW.md)
- [Dependency map](../../DEPENDENCY_MAP.md)
