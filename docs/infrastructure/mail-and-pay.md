# ExamDump Mail & ExamDump Pay — configuration

This documents every secret the email and payment features need, where it lives,
and how to rotate it. **No secret values belong in this file or anywhere in git.**

Secrets are stored in Doppler:

| Project | Config | Purpose |
| --- | --- | --- |
| `examdump-pro` | `prd` | Production application secrets |
| `agent-keys` | `dev_personal` | Developer-only keys (GitHub PAT, NVIDIA) |

Render production env for a deploy with:

```bash
doppler secrets download --project examdump-pro --config prd --format env --no-file > /tmp/prd.env
```

---

## 1. ExamDump Mail (Gmail SMTP)

Sender identity: **examdump.official@gmail.com**
Transport: `smtp.gmail.com`, port `587`, **STARTTLS**

| Variable | Required | Notes |
| --- | --- | --- |
| `SMTP_HOST` | yes | `smtp.gmail.com` |
| `SMTP_PORT` | yes | `587` |
| `SMTP_SECURE` | yes | **`false`** — 587 upgrades via STARTTLS. `true` means implicit TLS (465). |
| `SMTP_USER` | yes | `examdump.official@gmail.com` |
| `SMTP_PASS` | yes | **Google App Password.** Secret. |
| `MAIL_FROM` | yes | `ExamDump <examdump.official@gmail.com>` |
| `MAIL_REPLY_TO` | no | Defaults to `SMTP_USER` |
| `MAIL_PUBLIC_URL` | no | Base URL for links in emails; defaults to `PUBLIC_WEB_URL` |
| `MAIL_ENABLED` | yes | `true` to send. `false` logs every message as `suppressed`. |
| `MAIL_MAX_ATTEMPTS` | no | Default `3` (first try + 2 retries) |
| `MAIL_RETRY_BASE_MS` | no | Default `500`; doubles per attempt |
| `MAIL_RATE_MAX` | no | Default `5` messages per recipient per window |
| `MAIL_RATE_WINDOW_MS` | no | Default `60000` |
| `MAIL_TIMEOUT_MS` | no | Default `15000` |

### Creating the Google App Password

1. Sign in to `examdump.official@gmail.com`.
2. Enable **2-Step Verification** (App Passwords are unavailable without it).
3. Go to **Google Account → Security → App passwords**.
4. Create a password named `ExamDump Mail`.
5. Copy the 16-character value (shown once, spaces optional).

> A normal account password cannot be used for SMTP. Using one produces
> `535-5.7.8 Username and Password not accepted`, and Google may lock the
> account after repeated attempts. The mail service treats that as a permanent
> failure and does **not** retry it.

### Store it

```bash
doppler secrets set SMTP_PASS --project examdump-pro --config prd
# paste the App Password when prompted; never pass it as an argument

doppler secrets set \
  SMTP_HOST=smtp.gmail.com \
  SMTP_PORT=587 \
  SMTP_SECURE=false \
  SMTP_USER=examdump.official@gmail.com \
  MAIL_FROM='ExamDump <examdump.official@gmail.com>' \
  MAIL_REPLY_TO=examdump.official@gmail.com \
  MAIL_ENABLED=true \
  --project examdump-pro --config prd
```

### Sending limits

A free Gmail account allows roughly **500 recipients per day** (a Workspace
account allows ~2000). For a production launch with more signups, move to a
transactional provider and keep the same interface — only `SMTP_*` changes.

### Verify

```bash
# after deploy, as an admin:
curl -X POST https://<host>/api/admin-ops/infrastructure/mail-test \
  -H 'content-type: application/json' -d '{"to":"you@example.com"}' --cookie "<admin cookie>"

# configuration summary (no secrets returned):
curl https://<host>/api/admin-ops/infrastructure --cookie "<admin cookie>"
```

Delivery attempts are recorded in the `mail_logs` table with status
`sent` / `failed` / `suppressed`, attempt count and the SMTP error text.

### Which emails exist

| Template | Trigger |
| --- | --- |
| `email_verify` | Registration and resend-verification |
| `password_reset` | Forgot-password request |
| `welcome` | First successful email verification |
| `payment_receipt` | Successful payment settlement |
| `subscription_activated` / `subscription_renewed` | Same settlement, new vs. renewal |
| `refund_processed` | Admin-issued refund |
| `test` | Admin diagnostic send |

`subscription_expiring` and `subscription_cancelled` templates exist and are
wired in the render layer; they are sent by the lifecycle jobs when those are
enabled.

---

## 2. ExamDump Pay

Payments stay **disabled** until a payment provider authorises this merchant
account. While disabled the platform is free-tier only: the API reports
`pay.available: false` and the UI offers no checkout. Nothing simulates a
successful payment.

| Variable | Required | Notes |
| --- | --- | --- |
| `PAYMENTS_ENABLED` | yes | `false` until a provider is live |
| `PAYMENT_ADAPTER` | yes | `none` / `razorpay` / `hyperswitch` |
| `PAYMENT_METHODS` | no | Default `upi,card` |
| `PAYMENT_MIN_AMOUNT_MINOR` | no | Default `100` (₹1.00) |
| `PAYMENT_MAX_AMOUNT_MINOR` | no | Default `10000000` (₹1,00,000) |
| `RAZORPAY_KEY_ID` | when adapter=razorpay | Public key id |
| `RAZORPAY_KEY_SECRET` | when adapter=razorpay | **Secret.** Server only. |
| `RAZORPAY_WEBHOOK_SECRET` | when adapter=razorpay | **Secret.** HMAC-SHA256 key. |

### Enabling Razorpay (UPI + cards)

```bash
doppler secrets set PAYMENT_ADAPTER=razorpay --project examdump-pro --config prd
doppler secrets set RAZORPAY_KEY_ID=... --project examdump-pro --config prd
doppler secrets set RAZORPAY_KEY_SECRET --project examdump-pro --config prd
doppler secrets set RAZORPAY_WEBHOOK_SECRET --project examdump-pro --config prd
doppler secrets set PAYMENTS_ENABLED=true --project examdump-pro --config prd
```

Then point the Razorpay dashboard webhook at:

```
POST https://<host>/api/payments/webhook/razorpay
```

Subscribe to `payment.captured`, `payment.failed`, `order.paid`, and
`refund.processed`.

Order of operations matters: set the credentials **before**
`PAYMENTS_ENABLED=true`, otherwise customers see a Pay button whose adapter is
not yet configured. The adapter is only reported as available when every
credential is present.

### HyperSwitch

`PAYMENT_ADAPTER=hyperswitch` is accepted but reports `adapter_coming_soon`.
Running HyperSwitch needs a router, a control centre and its own database, which
this 2-vCPU deployment does not have. The legacy HyperSwitch client is left
untouched so the existing reconciliation code keeps compiling.

### How settlement works (and what is never done)

1. Price is quoted **server-side** from plans + coupons in Postgres. The request
   body never carries an amount.
2. `assertAmountAllowed` rejects out-of-range totals.
3. A duplicate checkout request for the same plan/amount within 20 minutes
   reuses the existing pending order instead of creating a second charge.
4. The customer pays at the provider.
5. **Only** a server-verified signal settles a payment: either the webhook
   (HMAC-verified signature, then a server-to-server status re-fetch) or the
   return-page verify call. The browser's query string is never trusted.
6. `settlePayment` runs inside a transaction with a row lock; duplicate
   webhooks are idempotent and cannot double-grant a subscription.
7. If the gateway reports an amount that differs from the stored order, the
   webhook returns `409 AMOUNT_MISMATCH` and does not settle.

---

## 3. Rotation checklist

- **App Password leaked or mailbox compromised:** delete the App Password in
  Google Account settings, create a new one, `doppler secrets set SMTP_PASS`,
  redeploy. Deleting it invalidates the old value immediately.
- **Razorpay keys leaked:** roll the key pair in the Razorpay dashboard, then
  update `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`, then redeploy. Roll the
  webhook secret and update the dashboard at the same time.
- Never copy secrets into `.env.example`, a commit, a ticket, or a chat message.

## 4. Local development

Without SMTP credentials the mail service logs each message and writes a
`suppressed` row, so registration and password-reset flows still work locally —
the verification link is returned in the API response as `devVerificationUrl`
in non-production. Payments with `PAYMENT_ADAPTER=none` keep every account on
the free tier.
