# YouPI-PG deployment & ExamDump Pro integration

Status: **non-commercial test deployment.** Real-money collection is disabled on
both sides. See [Licensing](#licensing--permission) — permission from the upstream
authors is not yet established.

## 1. Architecture

```
ExamDump Pro (this repo)                 YouPI-PG (standalone)
─────────────────────────                ─────────────────────
POST /api/payments/pay/youpi/checkout
   │  server-side amount (quote)                POST /api/v1/payments
   ├────────── HTTPS merchant API ─────────────▶  (pay-api.examdumppay.duckdns.org)
   │                                               creates MANUAL_UPI session
   │  ◀────────── checkoutUrl ──────────────────┐
   ▼                                             │
customer redirected to YouPI hosted checkout ◀──┘
   (pay.examdumppay.duckdns.org/checkout/:id)

YouPI forces settlement only via operator bank-statement import
   │  signed webhook (HMAC-SHA256, raw body)
   └──────────▶ POST https://examtopicspro.duckdns.org/api/payments/webhook/youpi
                 verify → dedupe → validate → settle ONLY if RECONCILED
```

YouPI-PG is a **separate application**: its own OS user (`youpi`), Node.js
runtime, SQLite database, configuration, systemd units and Nginx vhost. It never
touches ExamDump's PostgreSQL database.

## 2. Deployed YouPI-PG commit

`405327c27d78ae9d0dccdb1e2d2426cefc359477` (branch `main`).
Pinned at `/opt/youpi-pg/app`.

## 3. Services and ports (all loopback)

| systemd unit | App | Port |
| --- | --- | --- |
| `youpi-payment-api` | merchant API, state machine, webhooks, SSE | 6100 |
| `youpi-checkout` | customer checkout + SDK, `/api` proxy | 7000 |
| `youpi-admin` | merchant admin / setup UI | 6001 |
| `youpi-gmail` | Gmail OAuth + observation | 6003 |
| `youpi-control-center` | process supervisor API (loopback only, not published) | 8090 |

Deliberately not run: `sms-observer` (legacy Chrome CDP), `coin-wallet-store`
(demo), Android APK.

## 4. Directory layout

| Path | Purpose |
| --- | --- |
| `/opt/youpi-pg/app` | application (git checkout at the pinned commit) |
| `/opt/youpi-pg/node` | dedicated Node.js runtime (v24.22.3) |
| `/opt/youpi-pg/ops` | operator scripts (merchant seeding) |
| `/var/lib/youpi-pg/youpi_pg.sqlite` | persistent SQLite database (WAL) |
| `/var/lib/youpi-pg/examdump-merchant.env` | ExamDump merchant credentials (0600) |
| `/etc/youpi-pg/production.env` | service environment incl. secrets (0640 root:youpi) |
| `/etc/youpi-pg/admin-access.txt` | admin host basic-auth credential (0600 root) |
| `/etc/nginx/conf.d/youpi-pg.conf` | YouPI vhost (separate from `examdump.conf`) |
| `/etc/letsencrypt/live/examdumppay.duckdns.org` | TLS certificate |

## 5. Environment variables (names only)

Set in `/etc/youpi-pg/production.env`:
`NODE_ENV, YOUPI_MODE, CLOUDFLARE_DOMAIN, DEPLOYMENT_PREFIX, YOUPI_BIND_HOST,
*_PORT, PAYMENT_API_URL, BASE_PAYMENT_API_URL, CHECKOUT_PORTAL_URL,
CONTROL_CENTER_URL, GMAIL_OBSERVER_URL, SMS_OBSERVER_URL, BASE_CHECKOUT_URL,
CHECKOUT_PUBLIC_URL, BASE_ADMIN_URL, BASE_DEMO_STORE_URL, YOUPI_ALLOWED_ORIGINS,
YOUPI_ALLOWED_RETURN_ORIGINS, CHECKOUT_FRAME_ANCESTORS, GMAIL_REDIRECT_URI,
GMAIL_POLL_INTERVAL_MS, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, SQLITE_DB_PATH,
USE_SQLITE_FALLBACK, WEBHOOK_MAX_RETRIES, WEBHOOK_RETRY_INTERVAL_MS,
WEBHOOK_INITIAL_BACKOFF_MS, ALLOW_TEST_AUTOACTIVATE, YOUPI_ALLOW_DEV_TOOLS,
RECEIVING_ACCOUNT_ID, ADMIN_API_TOKEN, OBSERVER_API_TOKEN,
COIN_STORE_WEBHOOK_SECRET, INTERNAL_SERVICE_TOKEN, DEVICE_CREDENTIAL_KEY,
BLIND_INDEX_KEY, ENCRYPTION_MASTER_KEY`.

ExamDump side (`/etc/examdump-pro/production.env`): `YOUPI_ENABLED, YOUPI_API_URL,
YOUPI_MERCHANT_ID, YOUPI_MERCHANT_KEY, YOUPI_WEBHOOK_SECRET,
YOUPI_WEBHOOK_TOLERANCE_SECONDS`. `PAYMENTS_ENABLED` stays `false`.

## 6. DNS and HTTPS

DuckDNS wildcard `*.examdumppay.duckdns.org` resolves to the host. Certificate:
single Let's Encrypt cert for `examdumppay.duckdns.org`, `pay.examdumppay.duckdns.org`,
`pay-api.…`, `pay-admin.…`, `pay-gmail.…` (webroot `/var/www/certbot`, auto-renew).
Nginx vhost `youpi-pg.conf` is independent of `examdump.conf`.

| URL | Purpose |
| --- | --- |
| `https://pay.examdumppay.duckdns.org` | checkout |
| `https://pay-api.examdumppay.duckdns.org` | merchant API (server-to-server) |
| `https://pay-admin.examdumppay.duckdns.org` | setup UI (HTTP Basic + admin token) |
| `https://pay-gmail.examdumppay.duckdns.org/oauth/callback` | Google OAuth redirect |

## 7. Merchant integration (ExamDump side)

- `POST /api/payments/pay/youpi/checkout` (auth) → server-quoted amount →
  YouPI `MANUAL_UPI` session → `payments` row (`provider='upi'`,
  `metadata.provider='youpi'`) → returns `checkoutUrl`.
- `POST /api/payments/webhook/youpi` (no auth header; signature-authenticated):
  1. HMAC-SHA256 over the **raw body** with `YOUPI_WEBHOOK_SECRET`
     (`X-Gateway-Signature-V2`, timestamped; V1 fallback).
  2. Replay window `YOUPI_WEBHOOK_TOLERANCE_SECONDS`.
  3. Persist to `webhook_events` keyed by `(provider='youpi', event_id=delivery id)`
     — duplicates acknowledged without reprocessing.
  4. Validate order (`payments.order_ref`), amount (paise) and currency.
  5. Fulfil **only** on `event=RECONCILED` **and** `settlementState=RECONCILED`,
     via idempotent `settlePayment(...,{source:'upi'})`.

`OBSERVED_SUCCESS` and `MANUAL_REVIEW` are recorded and ignored — never fulfil.

## 8. Payment behaviour audit (YouPI)

- **No bank API.** Status comes from Gmail/SMS observers and, decisively, an
  operator bank-statement CSV import (`RECONCILED`). `OBSERVED_SUCCESS` means a
  bank *alert* was attributed, not that funds cleared.
- **Webhooks**: HMAC-SHA256 with `X-Gateway-Delivery-Id`; durable outbox,
  at-least-once, retried; merchants must dedupe by delivery id.
- **Automated UPI is gated** on a live SMS-observer heartbeat; Gmail alone is
  supporting evidence. This deployment therefore uses `MANUAL_UPI` (no observer
  gate) and reconciles via statement import.

## 9. Merchant setup

- Merchant: `ExamDump Pro` (`11111111-1111-1111-1111-111111111111`, slug
  `examdump`), receiving account `examdumptest@upi` (placeholder — no real VPA).
- Webhook target: `https://examtopicspro.duckdns.org/api/payments/webhook/youpi`.
- Credentials live only in the two env files above; never in Git, logs or chat.

## 10. Backup / restore

- **YouPI DB**: `sqlite3 /var/lib/youpi-pg/youpi_pg.sqlite ".backup /path/copy.sqlite"`
  (WAL-safe), or stop the services and copy the file. Secrets file
  `/etc/youpi-pg/production.env` must be backed up with it (the master key
  decrypts stored webhook secrets).
- **ExamDump**: `pg_dump -Fc examdump` (see `deploy/backup.sh`).
- Restore: stop services, restore the SQLite file and env, start services.

## 11. Service management

```bash
systemctl status youpi-payment-api youpi-checkout youpi-admin youpi-gmail
systemctl restart youpi-payment-api            # etc.
journalctl -u youpi-payment-api -f
nginx -t && systemctl reload nginx
```

## 12. Upgrade

```bash
cd /opt/youpi-pg/app
sudo -u youpi git fetch --depth 1 origin main
sudo -u youpi git checkout <new-commit>
sudo -u youpi /opt/youpi-pg/node/bin/npm ci
sudo -u youpi /opt/youpi-pg/node/bin/npm run build
sudo systemctl restart youpi-payment-api youpi-checkout youpi-admin youpi-gmail
```

## 13. Rollback

- YouPI: `git checkout 405327c27d78ae9d0dccdb1e2d2426cefc359477`, rebuild, restart.
- ExamDump: restore `/opt/examdump-pro/api/dist` from
  `/var/lib/examdump-backup/api-dist-pre-youpi-*.tar.gz`, restore the env file
  from its `.pre-youpi.*` copy, then `systemctl restart examdump-api`.

## 14. Known security / operational limitations

- Settlement is **never** fully automatic: a human must import and match a bank
  statement. Not suitable for unattended real-money fulfilment.
- `ALLOW_TEST_AUTOACTIVATE=true` and `YOUPI_ALLOW_DEV_TOOLS=true` are set **for
  testing only** and must be turned off before any real use.
- The ExamDump checkout path is enabled via `YOUPI_ENABLED=true` while
  `PAYMENTS_ENABLED=false`. No bank credentials exist on either side.
- YouPI's own `SECURITY_AUDIT.md` marks it "EXPERIMENTAL; NOT APPROVED FOR
  REAL-MONEY PRODUCTION".

## 15. Licensing / permission

The upstream repository declares `"license": "Commercial"` in `package.json` but
**ships no LICENSE file** (GitHub reports no detected licence). No grant
permitting self-hosting or commercial use has been obtained. This deployment is
therefore a **non-commercial, controlled test only**; a written permission
request to the maintainers is required before any commercial use or real-money
collection. See `docs/decisions/` for the record.
