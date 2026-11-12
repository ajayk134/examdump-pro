# Data flow

How a request moves through the system, and where data is written. Every path
below is implemented — nothing here is aspirational.

---

## 1. Anonymous browsing

```
browser → nginx → web (Next.js server component)
                    → fetch `${PUBLIC_API_URL}/api/exams`
                      → api: entitlement not required
                        → catalog.service: read catalog_providers / catalog_exams
                        → data-client: GitHub metadata (TTL cached)
```

**Writes:** none. Catalogue rows are refreshed by the dataset-sync cron, not by
requests.

---

## 2. Sign-up and login

```
POST /api/auth/register
  → Zod validation (packages/shared/src/schemas.ts)
  → auth.service: bcrypt(password + PASSWORD_PEPPER)
  → insert users
  → insert auth_tokens (email verification, sha256 hash stored)
  → mail queue: verification email
  → response: access JWT (15m) + refresh token (opaque, HttpOnly cookie)

POST /api/auth/login
  → verify hash, record login_attempts
  → sessions row (rotating refresh token, hashed)
  → access JWT in body, refresh cookie set
```

**Writes:** `users`, `sessions`, `auth_tokens`, `login_attempts`, `email_queue`,
`audit_logs`.

Refresh tokens rotate on every use; the previous token is invalidated, which
makes reuse detectable.

---

## 3. Practice / mock exam attempt

```
GET /api/exams/:provider/:exam/questions?mode=mock
  → requireAuth
  → entitlement.resolveEntitlements(user)
      free  → slice to FREE_QUESTIONS_PER_EXAM
      premium → full set, paced by PREMIUM_DAILY_QUESTION_LIMIT
  → data-client fetch (TTL cache, 300s default)
  → toClientQuestion(q, includeAnswer)
      mock/timed → answers omitted
      practice   → answers included
  → track in daily_usage

POST /api/attempts/:id/submit
  → requireAuth
  → attempts.service: grade server-side against dataset
  → insert question_results, attempts
  → update exam_progress, user_stats (streak, totals)
  → analytics rows for weak-topic analysis
```

**Source of truth for correctness:** the GitHub dataset, fetched server-side.
Grading never trusts a client-supplied answer key.

**Writes:** `attempts`, `question_results`, `exam_progress`, `user_stats`,
`daily_usage`, `analytics`.

---

## 4. AI explanation

```
POST /api/ai/explain
  → requireAuth + premium entitlement
  → check AI_DAILY_LIMIT_PREMIUM against daily_usage
  → ai.service → provider (OpenAI-compatible, e.g. NVIDIA NIM)
      header: Authorization: Bearer ${AI_API_KEY}   ← server-side only
  → persist ai_conversations / ai_messages
  → stream/return text
```

The API key never leaves the server. The browser never calls the provider
directly.

**Writes:** `ai_conversations`, `ai_messages`, `daily_usage`, `audit_logs`.

---

## 5. Card / hosted checkout

```
POST /api/payments/checkout
  → requireAuth
  → registry.resolvePaymentAdapter(env)
      PAYMENTS_ENABLED=false → 503, no order created
  → adapter.createOrder() → provider
  → insert payments (status=pending)
  → return redirect URL

provider → POST /api/payments/webhook
  → verify HMAC signature (PAYMENT_WEBHOOK_TOLERANCE_SECONDS window)
  → idempotency: webhook_events unique key
  → subscription.service.activate() → subscriptions, access_grants
  → invoice_sequences + invoices
  → mail queue: receipt
```

Reconciliation (`PAYMENT_RECONCILE_CRON`) re-polls the gateway for anything still
pending and repairs drift from missed webhooks.

**Writes:** `payments`, `webhook_events`, `subscriptions`, `invoices`,
`invoice_sequences`, `access_grants`, `audit_logs`, `email_queue`.

Full lifecycle: [payment lifecycle](../payments/PAYMENT_LIFECYCLE.md).

---

## 6. UPI collection

Two distinct halves — the user never confirms their own payment.

### 6a. Order creation

```
POST /api/upi/orders
  → requireAuth
  → order.service.createUpiOrder()
      base  = plan price in paise
      suffix = random 0..99
      amount_paise = base + suffix
      retry on unique violation of upi_orders_active_amount_idx
  → insert upi_orders (status=pending, expires_at = now + UPI_ORDER_TTL_MINUTES)
  → build upi:// intent (uri.ts) and QR SVG server-side (qr.ts)
```

Every active order holds a **distinct** payable amount. The partial unique index
is what makes bank-alert matching unambiguous.

### 6b. Settlement via notification

```
bank email/SMS → Gmail observer (gmail-observer.ts) or /api/upi/ingest (shared secret)
  → parser.ts extracts amount, UTR, payer, timestamp
  → risk.ts scores the notification
  → order.service.ingestNotification()
      match amount_paise against pending, unexpired orders
      UPI_AUTO_APPROVE=false → status=needs_review, held for a human
      UPI_AUTO_APPROVE=true  → settle immediately (accounting-only)
  → insert upi_notifications, upi_matches, upi_risk_events
```

**Limitation, stated plainly:** matching is based on parsing bank alert
notifications. It is *not* a bank-verified confirmation — there is no signed
callback from the bank or PSP. A forged alert that satisfies the parser and
amount match could therefore be accepted. That is exactly why
`UPI_AUTO_APPROVE` defaults to `false` and every match is queued for human review
against the actual bank statement.

**Writes:** `upi_orders`, `upi_notifications`, `upi_matches`, `upi_risk_events`,
`upi_observer_state`, and on settlement `subscriptions`, `access_grants`,
`invoices`.

Details: [UPI design](../payments/UPI.md) and
[payment security](../payments/PAYMENT_SECURITY.md).

---

## 7. Email delivery

```
any service → mail.service.enqueue() → insert email_queue
worker (in-process timer, 20s default)
  → claim batch with lease (MAIL_LOCK_LEASE_SECONDS)
  → render template (email_templates, placeholders.ts)
  → policy checks (email_suppressions, email_preferences, MAIL_HOURLY_SEND_LIMIT)
  → SMTP send via nodemailer
  → insert mail_logs, update email_queue status
  → on failure: exponential backoff up to MAIL_MAX_ATTEMPTS
```

**Writes:** `email_queue`, `mail_logs`, `email_suppressions`.

---

## Write ownership summary

| Table group | Written by |
| --- | --- |
| `users`, `sessions`, `auth_tokens`, `login_attempts`, `roles`, `permissions`, `user_roles` | auth / rbac |
| `attempts`, `question_results`, `exam_progress`, `user_stats`, `notes`, `bookmarks`, `goals`, `daily_usage` | learning |
| `subscriptions`, `payments`, `invoices`, `invoice_sequences`, `refunds`, `coupons`, `coupon_redemptions`, `referrals`, `access_grants` | billing |
| `upi_orders`, `upi_notifications`, `upi_matches`, `upi_refunds`, `upi_risk_events`, `upi_observer_state` | UPI |
| `email_queue`, `mail_logs`, `email_preferences`, `email_suppressions`, `email_campaigns`, `email_templates` | mail |
| `catalog_providers`, `catalog_exams` | dataset sync cron |
| `audit_logs`, `error_events`, `webhook_events` | cross-cutting |
| `settings`, `feature_flags`, `announcements` | admin |

## Related

- [System design](SYSTEM_DESIGN.md)
- [Service dependencies](SERVICE_DEPENDENCIES.md)
- [Database schema](../database/SCHEMA.md)
- [API reference](../../API.md)
