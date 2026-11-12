# Enabling automated UPI payments — manual checklist

Everything in this document must be done **by a human**. Nothing here is
automatable, and nothing here has been done already.

Source of truth for the flow itself: [UPI.md](UPI.md). Security model:
[PAYMENT_SECURITY.md](PAYMENT_SECURITY.md). Why automation is limited:
[ADR-003](../decisions/ADR-003.md).

---

## 0. Read this first: what "automated" does and does not mean

The system can take a customer from *"I clicked Buy"* to *"my plan is active"*
without a human touching it, **provided** a bank alert reaches one of the two
ingest paths. That is the whole automation. It rests on:

```
customer pays → bank sends an alert (email or SMS)
              → we parse it → match it to exactly one order
              → grant entitlement
```

**The alert is not bank confirmation.** It is a message the bank sent to a mailbox
or a phone. A convincing forgery that parses, carries the right amount and arrives
inside the order window would be accepted. There is no signed callback from a bank
or PSP in this design, and no endpoint that queries a bank's settlement ledger.

Therefore:

- `UPI_AUTO_APPROVE=false` is the **safe** setting and the default.
- `UPI_AUTO_APPROVE=true` is a deliberate risk decision that a human makes after
  enough manual matches have proven the alerts trustworthy. It does not make the
  verification stronger; it removes the human check.
- This document uses the words "matched" and "verified by alert", never
  "confirmed by bank".

---

## 1. Decide your merchant VPA

| Question | Answer |
| --- | --- |
| Which UPI id receives the money? | A personal or business VPA, e.g. `yourname@okhdfcbank` |
| Does it need to be a business account? | No. A personal VPA works. Volume limits are your bank's concern. |
| Can it be changed later? | Yes, but orders already shown to a customer keep the VPA they were quoted (`upi_orders.payee_vpa` is a snapshot). |

Record it. You will set `UPI_PAYEE_VPA` to it in step 4.

## 2. Choose at least one alert source

You need **at least one**. Both is better: they are independent, so a missed email
does not become a missed payment.

### Option A — Gmail observer (recommended primary)

Requirements: a **dedicated** Google account whose only job is receiving bank
alerts from the merchant VPA's bank.

1. Create the Google account, e.g. `payments.yourbrand@gmail.com`.
2. In the bank's app or net-banking, register that address for **credit alerts** on
   the merchant VPA's account. Confirm a test alert arrives.
3. Google Cloud Console:
   1. Create a project.
   2. Enable **Gmail API**.
   3. OAuth consent screen → External → add the payment address as a test user
      (or publish the app; publishing is not required for a single-user setup but
      the refresh token then expires after 7 days, so publish before going live).
   4. Credentials → **OAuth client ID** → Web application.
      Authorised redirect URI: `https://developers.google.com/oauthplayground`
      (the handshake default) **or** whatever you set as
      `UPI_OAUTH_REDIRECT_URI`.
4. Store the client id and secret:

   ```bash
   doppler secrets set UPI_GOOGLE_CLIENT_ID --project examdump-pro --config prd
   doppler secrets set UPI_GOOGLE_CLIENT_SECRET --project examdump-pro --config prd
   doppler secrets set UPI_GMAIL_USER --project examdump-pro --config prd
   ```

5. Run the handshake with the script that exists for exactly this purpose:

   ```bash
   doppler run --project examdump-pro --config prd -- \
     npm run upi:gmail-oauth -w @examdump/api -- print-url
   ```

   Open the printed URL **signed in as the payment account**, approve read-only
   Gmail access, copy the `code` parameter from the redirect, then:

   ```bash
   doppler run --project examdump-pro --config prd -- \
     npm run upi:gmail-oauth -w @examdump/api -- exchange <code>
   ```

   It prints the refresh token once and refuses to continue if the granted scope
   is anything other than `gmail.readonly`. Store it:

   ```bash
   doppler secrets set UPI_GOOGLE_REFRESH_TOKEN --project examdump-pro --config prd
   ```

   The script itself is `apps/api/src/scripts/upi-gmail-oauth.ts`.

**Do not set `UPI_GMAIL_QUERY=is:unread`.** The observer holds only
`gmail.readonly` and never marks mail read, so that filter selects the entire
mailbox oldest-first and silently stops seeing new payments once more than 25
alerts exist. The default `in:anywhere` is correct; a `newer_than:2d` bound is a
safe way to limit cost. Any `is:unread` term is stripped and logged as a warning.

### Option B — SMS bridge

You need a phone that receives the bank's SMS alerts and can forward them.

1. Generate a secret:

   ```bash
   openssl rand -hex 32
   doppler secrets set UPI_SMS_INGEST_SECRET --project examdump-pro --config prd
   ```

2. Configure the bridge on the handset (Tasker, a small Android app, MacroDroid, or
   any SMS-forwarding tool). For each bank SMS it must POST:

   ```
   POST https://your-domain/api/upi/ingest/sms
   Content-Type: application/json
   X-UPI-Timestamp: <epoch milliseconds>
   X-UPI-Signature: <hex HMAC-SHA256 of "<timestamp>.<raw body>" with the secret>

   {"text":"<full SMS body>","timestamp":"<ISO or epoch ms>","sender":"VK-HDFCBK","device":"pixel-1"}
   ```

   The signature **must** be computed over the exact bytes sent, and the timestamp
   must be inside the signed material. A body-only signature is still accepted for
   backwards compatibility but does not get replay protection — use the
   timestamped form.

3. The route answers `{"accepted":true,"status":"..."}` and refuses anything whose
   signature does not verify. It cannot be told to mark an order paid.

**Which to choose?** Gmail if you can register an email for alerts (simpler, no
device to keep online). SMS if the bank only sends SMS. Both if you want
redundancy; duplicate suppression makes the overlap harmless.

## 3. Verify the schema is applied

The UPI tables and their correctness indexes come from migrations `0006` and
`0007`. Confirm they exist **in the database**, not just in the repo:

```bash
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c '\d upi_orders'
```

Must be present:

- `upi_orders_active_amount_idx` — unique over live orders, prevents two checkouts
  sharing one payable amount
- `upi_matches_order_settled_idx` — prevents double settlement
- `upi_notifications_dedupe_idx`, `upi_notifications_utr_idx` — prevent replay
- `upi_orders_amount_suffix_ck` — keeps the 1–99 paise suffix honest

If any is missing, run `npm run migrate -w @examdump/api` inside `doppler run`.

## 4. Set the environment

Doppler project `examdump-pro`, config `prd`. Never put these in a file.

Required for checkout to be offered:

```
UPI_PAYEE_VPA=yourname@okhdfcbank
UPI_PAYEE_NAME=Your Brand
```

Required for automation to work (whichever source you chose, step 2).

Keep at their safe defaults for the first deployment:

```
PAYMENTS_ENABLED=false
UPI_AUTO_APPROVE=false
UPI_ORDER_TTL_MINUTES=15
UPI_NOTIFICATION_MAX_PAISE=50000000
UPI_GMAIL_POLL_SECONDS=60
UPI_GMAIL_QUERY=in:anywhere
```

## 5. Deploy with payments still off

Deploy normally ([DEPLOYMENT.md](../DEPLOYMENT.md)). Then check:

```bash
curl -s https://your-domain/api/upi/status
```

Expected: `{"available":false,...,"verification":"notification_based"}`.

`available:false` with `PAYMENTS_ENABLED=false` is correct at this stage. It proves
the route is wired and that checkout is genuinely closed.

## 6. Turn on collection, with review still on

```
PAYMENTS_ENABLED=true
UPI_AUTO_APPROVE=false
```

Deploy, then in Admin → **UPI collections** confirm:

- the observer badge is green (`observerConfigured: true`), or that you are using
  SMS only;
- the warning banner about notification-based confirmation is visible.

## 7. Prove it with one real payment

1. Buy the cheapest plan yourself, from a phone, using the QR.
2. Watch the checkout page change to **"Verifying your payment"** — that is the
   `processing` state, and it means the alert was parsed and the amount matched.
3. Open Admin → UPI collections. The credit appears under *unmatched / needs a
   decision*, and the order is `under_review`.
4. **Compare the amount and time against your actual bank statement.**
5. Approve it in the dashboard. The order settles and the plan activates.
6. Check `GET /api/admin-ops/upi/orders/:id` shows one match and the payment row is
   `succeeded`.

If step 2 never happens, the alert is not arriving. Debug with:

```bash
# force one poll and see what it read
curl -X POST https://your-domain/api/admin-ops/upi/observer/poll -H "cookie: ..."
```

A non-zero `scanned` with `ingested: 0` means mail is arriving but the parser does
not recognise it. Check `upi_notifications` rows with `status='ignored'` for the
raw text.

## 8. Only then consider automation

Run with `UPI_AUTO_APPROVE=false` until you have matched **at least twenty** real
payments by hand and every one appeared as `processing` within a minute. Then:

```
UPI_AUTO_APPROVE=true
```

What you are accepting by doing this: a forged or spoofed bank alert that matches
an open amount and reference will now grant a plan with no human in the loop. The
mitigations are the unique per-order amount, the timing window, the reference
check, and the fact that forging a bank's own alert delivery is not trivial — they
are not a bank guarantee.

Reconcile against your bank statement on a schedule regardless
([RECONCILIATION.md](RECONCILIATION.md)).

---

## What stays manual, permanently

| Task | Why |
| --- | --- |
| Refunds | There is no P2P UPI refund API. A human sends the money and records the UTR. |
| Disputes and chargebacks | UPI transfers are pull-only; disputes are bank processes. |
| Ambiguous matches | Two candidates, wrong reference, or an out-of-window credit are all held for a human by design. |
| Corrections | A wrongly approved order is corrected by a refund, not by rewriting history. |
| Anything above `UPI_NOTIFICATION_MAX_PAISE` | Rejected as noise rather than matched. |

## Exact list of secrets to set

| Secret | Where it comes from |
| --- | --- |
| `UPI_PAYEE_VPA` | Your bank / UPI app |
| `UPI_PAYEE_NAME` | Your choice; shown in the payer's app |
| `UPI_GOOGLE_CLIENT_ID` | Google Cloud Console → Credentials |
| `UPI_GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials |
| `UPI_GOOGLE_REFRESH_TOKEN` | `npm run upi:gmail-oauth` handshake |
| `UPI_GMAIL_USER` | The dedicated payment mailbox address |
| `UPI_SMS_INGEST_SECRET` | `openssl rand -hex 32` |
| `UPI_OAUTH_REDIRECT_URI` | Optional; only if not using the playground URI |

## Related

- [UPI flow and lifecycle](UPI.md)
- [Payment security](../payments/PAYMENT_SECURITY.md)
- [Reconciliation](RECONCILIATION.md)
- [Refunds](REFUNDS.md)
- [Environment reference](../ENVIRONMENT.md)
- [Original design note](../infrastructure/upi-collection.md)
