# UPI collection (self-hosted, no payment gateway)

> **RETIRED — removed from the application.**
>
> The embedded UPI gateway described here was removed from ExamDump Pro. The
> tables (`upi_*`) and migrations `0006`–`0008` are intentionally left in place;
> all of them are empty. No payment gateway is connected to the running
> application today: `PAYMENTS_ENABLED` is `false` and collection stays off.
> This document is kept only as a record of the original design and its
> reasoning. Nothing below is live code.
>
> What remains in the application is the generic `'upi'` *payment method* used by
> the Razorpay/HyperSwitch adapters, which is unrelated to this subsystem.

ExamDump Pro can collect plan payments directly into its own UPI account, without a
payment gateway. A buyer scans a QR (or taps an app intent), transfers money, and our
server learns about the transfer from the bank's own alert — either an email in a
dedicated Gmail inbox or an SMS forwarded by a bridge on a phone.

This document covers what it does, what it deliberately does not claim, how to configure
it, and how to verify it.

---

## 1. What "verified" means here — read this first

**A matched notification is evidence that a bank sent a message. It is not proof from
the bank's settlement ledger that funds are available.**

We cannot make it proof without bank API access, which a self-hosted UPI VPA does not
grant. So the product is built to say so, everywhere:

| Surface | How the limitation appears |
| --- | --- |
| Admin dashboard | A warning banner above every number: approval is notification-based, reconcile against the statement. |
| Overview API | `verification: "notification_based"` plus a `verificationWarning` string. |
| Checkout page | "Payments are confirmed from the bank's own transfer alert for this account." |
| Risk engine | Comments state the same; it never returns a field named `settled` or `confirmed_by_bank`. |

What *is* guaranteed, and tested:

- **Exactly-once entitlement.** Settlement runs inside one transaction that locks the
  order row, claims the notification, writes the match, and calls `settlePayment()`,
  which itself returns `already_settled` on any repeat.
- **Duplicate alerts are suppressed** by a unique hash of the message and a partial
  unique index on the bank UTR.
- **Each payment attempt gets its own payable amount.** The plan price is kept as
  `base_amount_paise`; the amount the customer is asked to send is that price plus a
  random 1-99 paisa suffix (`amount_paise`). Two people buying the same plan at the
  same time therefore never share a number, so a credit maps to one live order.
  PostgreSQL enforces this with a partial unique index on `amount_paise` over
  `pending`/`under_review` orders; a losing concurrent insert retries with a new
  suffix instead of failing the checkout.

  **This is collision avoidance, not proof of payment.** The suffix narrows
  ambiguity so the matcher has less to guess; it never settles anything. Settlement
  still requires a matching credit, a bank reference, and the dedupe rules below,
  and the amount alone is never treated as evidence that money arrived.
- **Ambiguity never auto-approves.** If two live orders somehow share an amount, the
  credit is held for a human, not guessed.
- **A forged request cannot reach the parser.** Ingest requires an HMAC-SHA256
  signature over the raw body, verified with a timing-safe compare.
- **A client cannot change the payee or amount.** The QR and intent links are rendered
  server-side from a frozen URI stored with the order; the browser only displays them.
  The frozen URI quotes the suffixed amount, so the QR, the app intents and the label
  always agree.

---

## 2. How a payment flows

```
buyer opens /checkout/upi
        │
        ├─ POST /api/upi/orders ──────────► price recomputed from plan + coupon
        │                                   pending `payments` row (provider `upi`)
        │                                   `upi_orders` row: reference, frozen URI,
        │                                   expires_at, unique reference
        ▼
   QR + intents rendered from the stored URI
        │
   buyer pays ──► money lands in the VPA
        │
        ▼
 bank sends an alert
        │
        ├─ Gmail observer (poll every N seconds)  ─┐
        └─ POST /api/upi/ingest/sms (bridge)       ─┴─► ingestNotification()
                                                          │
                            ┌─────────────────────────────┼───────────────────────┐
                            ▼                             ▼                       ▼
                   dedupe by hash + UTR        screen (amount, sender,        match candidates
                   → `duplicate`                ceiling) → `rejected`          by exact amount
                                                                                      │
                                          ┌───────────────────────────────────────────┤
                            2+ candidates ─┴─ 1 candidate ─┐                         │
                                    │                      ▼                         │
                                  `unmatched`     assessNotification()               │
                                  (holds)         approve / review / reject          │
                                                        │
                                                  settleFromNotification()
                                                  one txn, order row locked
                                                        │
                                          ┌─────────────┴──────────────┐
                                          ▼                            ▼
                                  match row + order settled      settlePayment(source:'upi')
                                          │                            │
                                          ▼                            ▼
                                  risk event written            entitlement + receipt
```

The checkout page polls `GET /api/upi/orders/:id` every 4 seconds. It shows success only
when the server reports `settled`.

---

## 3. Risk decisions

`assessNotification()` scores a candidate out of 100 and maps the score to a decision.

| Signal | Points | Rationale |
| --- | --- | --- |
| Amount matches exactly | 40 | The strongest single signal available offline. |
| Notification is unique (UTR not seen) | 25 | A re-sent alert is a replay, not a new payment. |
| Reference appears in the text | 20 | Some banks echo the `tn` note; corroboration, not required. |
| Observed inside the order window | 15 | Timing gates separate this from stale or future alerts. |

Forced outcomes, regardless of score:

- **Reject** — amount missing or mismatched; observed before the order existed (plus
  clock skew); observed after the order expired; above `UPI_NOTIFICATION_MAX_PAISE`;
  sender VPA equals our own payee VPA (a transfer to yourself).
- **Review** — more than one order has that exact amount. A human decides.
- **Approve** — score ≥ `approveThreshold` (default 80) and exactly one candidate.

Defaults live in `DEFAULT_RISK_CONFIG` in `apps/api/src/services/upi/risk.ts`.

---

## 4. Configuration

All variables are server-side. None are ever sent to the browser.

### Required to enable UPI collection

| Variable | Example | Notes |
| --- | --- | --- |
| `PAYMENTS_ENABLED` | `true` | Nothing in this module is reachable while this is `false`. |
| `UPI_PAYEE_VPA` | `yourname@okhdfcbank` | The VPA that receives money. Validated on boot. |
| `UPI_PAYEE_NAME` | `ExamDump` | Shown in the payer's app. |

### Optional

| Variable | Default | Notes |
| --- | --- | --- |
| `UPI_ORDER_TTL_MINUTES` | `15` | How long a QR stays payable. |
| `UPI_AUTO_APPROVE` | `false` | `true` settles a well-scored credit automatically. When `false` (the default) such a credit is **held**: the order moves to `under_review` and waits for an administrator to confirm it. Keep `false` for the first days. |
| `UPI_NOTIFICATION_MAX_PAISE` | `5000000` | Ceiling per credit (₹50,000). Above this the alert is rejected, not matched. |
| `UPI_SMS_INGEST_SECRET` | — | Shared secret for the SMS bridge. Without it the ingest endpoints refuse everything. |
| `UPI_GMAIL_POLL_SECONDS` | `60` | Observer interval. `0` disables polling. |
| `UPI_GMAIL_USER` | — | The dedicated inbox, e.g. `payments@yourdomain.com`. |
| `UPI_GOOGLE_CLIENT_ID` | — | OAuth client. |
| `UPI_GOOGLE_CLIENT_SECRET` | — | OAuth client secret. |
| `UPI_GOOGLE_REFRESH_TOKEN` | — | Obtained once via the consent URL; stored only in Doppler. |
| `UPI_GMAIL_LABEL` | `INBOX` | Label to watch. |
| `UPI_GMAIL_QUERY` | `from:(alerts|bank)` | Gmail search narrowing the scan. |

### Enabling, in order

1. Set `UPI_PAYEE_VPA` and `UPI_PAYEE_NAME`. Leave `PAYMENTS_ENABLED=false` for now.
2. Add `UPI_SMS_INGEST_SECRET` (32+ random bytes) and/or the Gmail observer variables.
3. Deploy and confirm `GET /api/upi/status` reports `available: false, verification: "notification_based"`.
4. Set `PAYMENTS_ENABLED=true` and `UPI_AUTO_APPROVE=false`.
5. Deploy. In Admin → **UPI collections**, confirm the observer badge is green and the
   warning banner is present.
6. Run one small real payment yourself. Watch it appear in the notification log and
   settle, or hold for review if the amount collided. Reconcile it against your bank
   statement by hand.
7. Only after that, consider `UPI_AUTO_APPROVE=true`.

---

## 5. Gmail observer setup

Use a **dedicated** Google account for payment mail. Its only job is receiving bank
alerts, and its OAuth grant is read-only.

1. Google Cloud Console → create a project → enable **Gmail API**.
2. OAuth consent screen → External → add the payment address as a test user.
3. Credentials → OAuth client (Web application) → note the id and secret.
4. Set `UPI_GOOGLE_CLIENT_ID` / `UPI_GOOGLE_CLIENT_SECRET`.
5. Generate the consent URL once from the server and open it signed in as the payment
   account:

   ```ts
   import { buildGmailConsentUrl } from './services/upi/gmail-observer.js';
   console.log(buildGmailConsentUrl(env));
   ```

   The scope is `https://www.googleapis.com/auth/gmail.readonly` with
   `access_type=offline` and `prompt=consent`, so a refresh token is issued.
6. Exchange the returned `code` for a refresh token and store it as
   `UPI_GOOGLE_REFRESH_TOKEN` in Doppler (`examdump-pro` / `prd`).
7. Add the bank's alert sender to a filter that applies `UPI_GMAIL_LABEL`, and tighten
   `UPI_GMAIL_QUERY` to that sender.

The refresh token is held in memory only, never logged and never returned by any
endpoint. Access tokens are minted on demand and cached until shortly before expiry.

**Least privilege:** `gmail.readonly` cannot send, delete, or modify anything. The
observer marks messages only by not re-reading them (it tracks seen ids), so no write
scope is needed at all.

---

## 6. SMS bridge

The phone that receives bank SMS runs a small forwarder. It must sign every request.

The signature covers a millisecond timestamp **and** the body:
`HMAC_SHA256(secret, "<timestamp>.<body>")`. Sending the timestamp in the header
lets the server refuse stale requests, and because the timestamp is part of the
signed material an attacker cannot move it forward to keep a captured request
alive. Requests carrying only a body signature are still accepted for backwards
compatibility with an already-deployed bridge, but the timestamped form is what
new deployments should use.

```bash
BODY='{"text":"Rs 499.00 credited to a/c XX1234. UPI Ref 123456789012","device":"pixel-7"}'
TS=$(date +%s%3N)
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$UPI_SMS_INGEST_SECRET" | awk '{print $2}')
curl -sS -X POST https://your-host/api/upi/ingest/sms \
  -H 'content-type: application/json' \
  -H "x-upi-signature: $SIG" \
  -H "x-upi-timestamp: $TS" \
  -d "$BODY"
```

Timestamps more than 24 hours from server time are rejected, as is a `timestamp`
field inside the body that is not a usable date. The window is wide because a
handset may be offline for hours; it exists to stop absurd values rather than to
enforce precise phone clocks.

The response is deliberately terse (`{"accepted":true,"status":"..."}`). A compromised
handset learns whether its message was understood, never which order it affected.

The signature covers the raw body bytes, so a proxy that rewrites JSON will invalidate
it. Sign last, send immediately.

---

## 7. Operating it

### Admin → UPI collections

- **Counters** — awaiting payment, settled today, amount collected, unmatched credits.
- **Observer strip** — whether the mailbox observer is configured, whether auto-approve
  is on, the payee VPA, and a "Check mailbox now" button.
- **Needs a human decision** — every held credit with the reason it was held, and a
  *Match to order* action that records the reason in the audit log.
- **Recent orders** — every QR issued and its fate, with a *Refund* action on settled
  ones.
- **Notification log** — every alert read, including refusals and duplicates.

The view refreshes every 20 seconds; the observer itself runs continuously.

### Reconciliation discipline

Because approval is notification-based, do this every day:

1. Open your bank statement for the day.
2. Compare the credits against Admin → UPI collections → Recent orders (settled).
3. Investigate any credit in the statement with no matching order — check the
   notification log for a `rejected` or `unmatched` entry first.

A credit that reached the bank but was never observed is the failure mode this design
cannot rule out on its own.

### Refunds

A refund is a two-step record, never a single click:

1. *Refund* on a settled order creates a `upi_refunds` row with status pending. The order
   stays `settled` — no money has moved.
2. Send the money by hand from the UPI app.
3. Record the payout reference via `POST /api/admin-ops/upi/refunds/:id/complete`. Only
   then does the order become `refunded`.

---

## 8. Data model

| Table | Purpose | Key constraint |
| --- | --- | --- |
| `upi_orders` | One QR per checkout. | unique `reference` |
| `upi_notifications` | Every alert read, with its decision. | unique `dedupe_key`; partial unique `bank_reference` |
| `upi_matches` | Links a notification to an order. | unique `notification_id`; partial unique `order_id` where approved |
| `upi_risk_events` | Scoring trace for every decision. | — |
| `upi_observer_state` | Poll bookkeeping and last error. | primary key `id` |
| `upi_refunds` | Pending and completed refunds. | — |

Those two partial unique indexes on `upi_matches` are what make double settlement
impossible at the database level, not merely unlikely in code.

The `payments.provider` enum gained the value `upi`, so UPI payments share the same
settlement, receipt, and invoice path as every other provider.

---

## 9. Test coverage

`apps/api/test/upi.test.ts` (60 tests) covers parsing against real bank message shapes,
risk scoring, URI/QR construction, and — against real Postgres — settlement, double
settlement, duplicate suppression, amount mismatch, expiry, ambiguous amounts, concurrent
ingest, manual approval, and refunds. It also covers unique amounts specifically:
distinct live amounts, suffix range, collision retry, concurrent checkouts, amount release
on expiry, exact-amount matching (paying the base price does not settle), no suffix
compounding on retry, and refund caps.

`apps/api/test/upi-api.test.ts` (23 tests) covers the HTTP layer: auth-before-config
ordering, admin-only access, signature verification (missing, wrong, tampered body), the
timestamp-bound signature, and the signed happy path. It asserts that the checkout
response quotes the suffixed amount consistently in the QR, every app intent and the
label.

Run both:

```bash
cd apps/api
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" npx vitest run test/upi
```

---

## 10. Known limitations

- **Not bank-verified.** Stated throughout; see §1. This is the main one.
- **Suffixes reduce, not remove, ambiguity.** 99 amounts per price, so more than 99
  simultaneous live checkouts of the same plan would exhaust the space and the checkout
  fails with `amount_reservation_failed` rather than reusing an amount. That is the safe
  failure: it never silently merges two payments.
- **Email delivery latency.** Bank alerts can arrive seconds to minutes late. The order
  window is 15 minutes by default; a payment made at the last second may be observed
  after expiry and rejected. The buyer is told to refresh before paying again.
- **A recovered account can forge alerts.** If the payment mailbox or the SMS phone is
  compromised, an attacker who knows an open order's amount can claim it. Mitigations:
  the mailbox is dedicated and read-only; the SMS secret can be rotated; the reference
  echo and timing signals raise the bar; and with `UPI_AUTO_APPROVE=false` every credit
  is still looked at by a person.
- **Single poller.** The observer runs in-process. Two API replicas would both poll; the
  dedupe index keeps that harmless, but a leader lock is the clean fix if you scale out.
- **Amount-only candidate matching.** Two open orders for the same amount always hold
  for review. That is a deliberate trade: a human decision beats a wrong grant.
- **No automatic refund to the payer.** UPI does not allow a pull once money has landed;
  refunds are manual, and the record reflects that.
