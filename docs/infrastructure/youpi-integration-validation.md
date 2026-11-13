# YouPI-PG V2 — Integration and Synthetic Validation

Recorded 2026-11-13 after configuring external integrations and running the synthetic payment
suite. Real-money processing remains **disabled**.

## Payment provider credentials

**There are none, and none are needed for the gateway to function.** This was an assumption
worth correcting: YouPI-PG V2 is not a multi-provider checkout. It is a UPI/COD collection
gateway that confirms payments by observing bank notifications. Source evidence:

```bash
grep -rniE "razorpay|stripe|paypal|phonepe|cashfree" --include=*.js apps/ packages/
# matches only test fixtures and the Android observer's package-name list
```

There is no provider adapter layer (`packages/core/src/` has no `providers/` directory), no
provider API key, and no provider SDK. The credentials the gateway actually needs are its own
signing and encryption secrets, already in Doppler `youpi-pg`/`prd`:

| Secret | Purpose |
| --- | --- |
| `ENCRYPTION_MASTER_KEY` | Encrypts stored bank/Gmail credentials |
| `JWT_SECRET` | Session tokens |
| `ADMIN_API_TOKEN` | Admin API bearer |
| `OBSERVER_API_TOKEN` | Observer API bearer |
| `INTERNAL_SERVICE_TOKEN` | Service-to-service |
| `DEVICE_CREDENTIAL_KEY` | Android device signing |
| `BLIND_INDEX_KEY` | Blind index for lookups |
| `COIN_STORE_WEBHOOK_SECRET` | Coin store webhook HMAC |
| `ANDROID_ENROLLMENT_SECRET` | Android observer pairing |

**Razorpay/card checkout is untouched.** It lives in ExamDump's own API and is not part of
this deployment.

A merchant is created via `POST /api/v1/admin/merchants`, which returns that merchant's
`apiKey` and `webhookSecret`. Those are per-merchant values stored in the database, not
Doppler secrets. A synthetic merchant exists for testing and must be removed before real use.

## Gmail OAuth

Configurable, not yet authorised. Credentials are stored in the merchant's `branding.gmailConfig`
in the database, not in environment variables.

Required: a Google Cloud OAuth 2.0 client (type *Web application*) with the authorised redirect
URI exactly:

```
https://examdumppay.duckdns.org/oauth/callback
```

`GMAIL_REDIRECT_URI` pins this, overriding the code's localhost default — without it the
callback resolves to `http://localhost:6003/oauth/callback`, which Google cannot reach and
which would make the flow impossible to complete.

nginx previously had **no** route for `/oauth/`, so the callback returned 404 and OAuth could
never complete. A `/oauth/` location now proxies to the Gmail observer on `10.90.0.2:6003`.
This is the only observer port reachable publicly, and only for that path.

Status: callback reachable (HTTP 400 with no `code`, which is the correct response), but
`clientId`/`clientSecret`/`refreshToken` are empty — no mailbox is polled. OAuth state is
signed, single-use, 10-minute, and compared with `timingSafeEqual`.

## Bank observer enrollment

Android SMS observer pairing, from `apps/payment-api/src/routes/pollers.routes.js`:

```
POST /api/v1/pollers/android/pair
{ "enrollmentToken": "<ANDROID_ENROLLMENT_SECRET>", "merchantId": "...",
  "deviceName": "...", "deviceModel": "...", "version": "v1" }
```

Returns `deviceId` and a `signingKey` (shown once). The device then posts observations to
`/api/v1/pollers/events` and heartbeats to `/api/v1/pollers/android/heartbeat`. An
`ANDROID_ENROLLMENT_SECRET` must never be shipped inside a client app.

**New UPI sessions are refused until an SMS observer heartbeat is under 5 minutes old**
(`OBSERVERS_UNHEALTHY`, HTTP 503). Gmail alone does not satisfy this gate — single-channel
evidence cannot open a payment session. This is correct fail-closed behaviour, not a fault.

Status: a synthetic device is paired for testing and must be deactivated before real use.

## Webhook egress

Outbound webhooks are validated twice: `validateOutboundWebhookUrl` at write/parse time and
`assertResolvedAddressIsPublic` immediately before **each** delivery, so a hostname that
rebinds after validation is refused. Redirects are `manual`, so a 302 cannot walk the request
to an internal address.

Verified with `YOUPI_ALLOW_PRIVATE_WEBHOOKS` unset (production condition), 9/9:

| Target | Result |
| --- | --- |
| `https://example.com/hook` | allowed |
| `http://127.0.0.1/hook` | blocked |
| `http://[::ffff:10.89.0.186]/hook` | blocked |
| `http://[::ffff:127.0.0.1]/hook` | blocked |
| `http://10.90.0.2:6100/hook` | blocked |
| `http://169.254.169.254/latest` | blocked |
| `http://2130706433/hook` | blocked |
| `http://localhost/hook` | blocked |
| `http://[::1]/hook` | blocked |

Note `validateOutboundWebhookUrl` **returns** `{valid:false}` rather than throwing. A test that
only catches exceptions will report every URL as allowed — a mistake made and corrected during
this validation.

There is no deny-by-default egress allowlist. Blocking is address-based, so any public host is
permitted. A destination allowlist remains outstanding.

**Webhooks to ExamDump must use the public URL** `https://examtopicspro.duckdns.org`, not the
container address `10.89.0.186:4000`: `youpi_guard` drops new flows from `10.90.0.0/24` into
`10.89.0.0/24`, and the SSRF guard would reject a private target anyway. The public path through
nginx works and was verified.

## YOUPI_MODE

| Mode | Behaviour |
| --- | --- |
| `production` (default) | Requires a Cloudflare domain in `CLOUDFLARE_DOMAIN` / branding, else `process.exit(1)` at startup. Derives public URLs from that domain. |
| `localhost` | Permitted only with `YOUPI_ALLOW_LOCALHOST_MODE=true`. Bypasses the domain requirement and uses localhost URLs. |

We run `localhost` mode because this host has no Cloudflare zone; nginx provides the public
TLS boundary instead. One trap: `scripts/start.js` sets `NODE_ENV = NODE_ENV || 'development'`
in localhost mode, so a container started without `NODE_ENV=production` silently runs as
development. This deployment passes `NODE_ENV=production` explicitly and it holds (verified
inside the container).

Dev tools are gated independently of the mode: `/api/v1/admin/dev/*` returns
`DEV_TOOLS_DISABLED` (403) in production.

## Synthetic payment validation

`scripts/synthetic-payment-validation.sh` — **32 passed, 0 failed**. No money moves; every
notification is a fixture posted by the script.

Covers intent creation and amount in paise, receiving-account binding, order-level amount
tamper rejection, idempotency, merchant/admin/observer auth, parser gates
(`MISSING_RAW_TEXT`, `MISSING_12_DIGIT_REFERENCE`/`MISSING_CREDIT_INDICATOR`), verified
attribution to the exact session, duplicate-UTR single-storage, amount-mismatch rejection,
expiry, late-credit handling, COD intent, dev-tool blocking, and observation durability across
a container restart.

Two behaviours worth recording:

- A single SMS channel is attributed but held at `PROCESSING`/`ACTIVE` awaiting a second source
  (dual-channel policy). `verificationPolicy` is never assigned, so the engine takes the
  dual-channel branch. One unconfirmed channel must not finalise a payment.
- A credit arriving after its session ends becomes `LATE_UNMATCHED` and raises a
  `LATE_UNMATCHED` support ticket for merchant reconciliation. It is never silently settled.

Sessions are released between blocks because the pipeline matches by amount within the
receiving account; a leftover `ACTIVE` session absorbs later observations and makes the
assertions meaningless. This happened during validation and was fixed, not worked around.

App suite: **59/59 suites pass**. Typecheck clean.

## Conditions before real money

1. Authorise a real Gmail OAuth client (or pair a real Android observer) so `smsHealthy` is
   genuinely true rather than synthetic.
2. Remove the synthetic merchant, receiving account and paired test device.
3. Supply production merchant credentials through the admin API, never the demo `.env` values.
4. Add a webhook egress destination allowlist.
5. Decide whether dual-channel is required, and configure `verificationPolicy` explicitly
   rather than leaving it undefined.
6. Configure the ExamDump webhook target as the public HTTPS URL and confirm signed delivery,
   retry and idempotency end to end between the two systems.
7. Obtain explicit human authorisation. `PAYMENTS_ENABLED` remains `false`.