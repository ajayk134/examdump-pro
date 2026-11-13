# YouPI-PG V2 — Pre-Deployment Security Audit

**Date:** 2026-11-13
**Status:** NOT APPROVED FOR DEPLOYMENT. Read-only audit; nothing deployed, started or changed.
**Scope:** `/var/lib/youpi-staging/YouPI-PG` at `405327c27d78ae9d0dccdb1e2d2426cefc359477`

---

## 1. Source revision and integrity

| Property | Value |
| --- | --- |
| Repository | `https://github.com/youpi-pg/YouPI-PG` (canonical org repo) |
| Branch | `main` |
| Commit SHA | `405327c27d78ae9d0dccdb1e2d2426cefc359477` |
| Commit subject | `Merge PR #137: chore(ci) bump docker/login-action` |
| Commit date | 2026-11-01T06:14:09Z |
| Commits | 318 |
| Objects | 3978 (all in-pack) |
| `git fsck --full` | clean, no errors |
| `SECURITY_AUDIT.md` blob | `2a8c345e83b9cb40ebf08e8f50c39d822eff3ace` |

The SHA matches the GitHub API `commits?per_page=1` response exactly. The clone was made
with a token in the remote URL; the remote was immediately reset to the credential-free
HTTPS URL and no token is stored in `.git/config`.

**Fork warning:** six third-party forks carry an identical `SECURITY_AUDIT.md` blob
(`Jayant-1/BakeConnect`, `naughty-ops/youpi-pg`, `lakshya-chourasia/gateway`,
`lakshya-chourasia/payone`, `fsferdows/universal-payment-gateway`). Do not treat fork
copies as authoritative. Only `youpi-pg/YouPI-PG` is the upstream.

---

## 2. What `SECURITY_AUDIT.md` actually says

The file is **40 lines** and is a *status document*, not a findings register. It carries
the headline:

> **Status: EXPERIMENTAL; NOT APPROVED FOR REAL-MONEY PRODUCTION.**

It lists nine "Deployment blockers / unresolved areas" (settlement not proven by
notification parsing, attribution needing adversarial testing, at-least-once webhook
semantics, undeliverable endpoints, SSRF/egress, secrets and Git history, PII/OTP,
compliance, CI unverified).

**It contains no four-critical-findings list, and no severity ratings.** The premise that
`SECURITY_AUDIT.md` documents four critical findings is not supported by the file.

The actual defect corpus lives elsewhere:

- `docs/youpi-phase9b-read-only-audit.md` — 20 controls, 16 PASS, **3 FAIL**, 1 NOT VERIFIED,
  plus **4 defects**: two HIGH, two MEDIUM.
- `docs/youpi-phase9c-remediation-report.md` — claims all Phase 9B findings resolved.

Critically, `SECURITY_AUDIT.md` scopes itself to a branch
`security/webhook-durability-hardening` that **does not exist** in the clone
(`git branch -a` shows only `main` and `attempt/merge-pr-29`). The audit therefore
describes work that is not present at `405327c`.

---

## 3. Reproduced findings

Every claim below was re-derived from the code at `405327c`. Prior documentation was not
taken on trust.

### 3.1 HIGH — Phase 9B Defect 1: unauthenticated `active-window` — **REMEDIATED**

`apps/payment-api/src/auth-guard.js:31` now returns `'observer'` for
`GET /api/v1/pollers/active-window`, and `apps/payment-api/src/routes/pollers.routes.js:41`
independently re-checks:

```js
if (!isAdminRequest(req) && !hasBearer(req, getObserverToken())) { 401 }
```

Tokens are compared with `crypto.timingSafeEqual` and accepted **only** from the
`Authorization` header. Device headers are validated against `android_devices where
is_active = 1` before use. **Not exploitable.**

### 3.2 MEDIUM — Phase 9B Defect 3: missing single-slot unique index — **REMEDIATED**

Both schemas now carry:

```sql
CREATE UNIQUE INDEX idx_one_slot_per_receiving_account
  ON payment_sessions (receiving_account_id)
  WHERE status IN ('ACTIVE','PROCESSING') AND receiving_account_id IS NOT NULL;
```

`schema.sql:140` (Postgres) and `sqlite-schema.sql:143` (SQLite). The invariant no longer
depends on application serialisation. **Not exploitable.**

### 3.3 HIGH — Phase 9B Defect 2: observers guessing the receiving account — **PARTIALLY REMEDIATED**

- **Gmail observer: fixed.** `apps/gmail-observer/src/gmail-poller.js:272` fails closed
  and drops the observation when `receivingAccountId` is unset.
- **SMS observer: still vulnerable.** `apps/sms-observer/src/sms-service.js:28-38` still
  fetches `/api/v1/pollers/active-window` **without any auth header** and returns
  `data.sessions[0].receivingAccountId`, which `processSms` (line 52-54) then prefers over
  the configured account:

  ```js
  const activeAcct = await this.resolveActiveReceivingAccount();
  if (activeAcct) targetAccountId = activeAcct;
  ```

  Because the call sends no bearer token it now 401s, the `catch` swallows the error and
  falls back to `this.receivingAccountId`. So the *cross-account contamination* is
  neutralised by accident, not by design — the guessing code is still present and would
  resume contaminating as soon as a token is added. `apps/sms-observer` is **not** built
  as a running service in our compose (only `gateway`), so it is not reachable in this
  deployment. **Latent, not exploitable here.**

### 3.4 NEW — HIGH: SSRF filter bypass via IPv4-mapped IPv6

Not documented upstream. `packages/common/src/secrets.js:284` `isPrivateAddress()` parses
only dotted-quad IPv4 and a narrow IPv6 regex. It does not handle IPv4-mapped IPv6
literals. Reproduced by importing the real function:

| Input | Verdict |
| --- | --- |
| `http://10.89.0.186/hook` | blocked |
| `http://127.0.0.1/hook` | blocked |
| `http://173605050/hook` (decimal 10.89.0.186) | blocked |
| `http://2130706433/hook` (decimal 127.0.0.1) | blocked |
| `http://[::ffff:10.89.0.186]/hook` | **ALLOWED** |
| `http://[::ffff:127.0.0.1]/hook` | **ALLOWED** |

`[::ffff:10.89.0.186]` connects to `10.89.0.186`. A merchant who can set a webhook URL can
therefore make the gateway POST to any internal address, including ExamDump's API at
`10.89.0.186:4000` and Postgres.

**Mitigating factor in our architecture:** the outbound request originates from
`10.90.0.2`, and `inet youpi_guard` drops `10.90.0.0/24 → 10.89.0.0/24` for `ct state new`.
I verified this rule is active (2 drop rules, service `active`). **The firewall we built
blocks this attack path**, which is a concrete argument for keeping the guard in place.
It does not make the code safe: any future relaxation of the guard, or any other internal
target on `youpi-net`, reopens it.

### 3.5 Informational — `.env` and `.env.production` in Git history

`2c2b491` ("V1") added both files. All values are **published demo placeholders**
(`ENCRYPTION_MASTER_KEY=0123…`, `JWT_SECRET=demo…`, `INITIAL_ADMIN_PASSWORD=1710…`), not
live credentials. No action beyond never reusing them.

---

## 4. Areas audited

| Area | Result |
| --- | --- |
| Authentication | Bearer-only, `timingSafeEqual`, `requiredLevel` default-deny. OK |
| Authorization | Admin vs observer separated; `isAdminRequest` blocks observer token on admin routes. OK |
| Session handling | Single-slot partial unique index in both schemas. OK |
| Webhook signatures | HMAC `sha256`, plus timestamped `X-Gateway-Signature-V2`, `X-Gateway-Delivery-Id`. OK |
| Webhook replay | Durable outbox, one delivery per event, ID preserved across retry. OK |
| Gmail credentials | Refresh token exchanged server-side; OAuth `state` signed, 10-min window, single-use, timing-safe. OK |
| SQLite access | Secrets dir `0o700`, files `0o600`. OK |
| Container privileges | `USER youpi` (non-root), base image digest-pinned `node:24-alpine@sha256:429bdf…`. OK |
| Exposed ports | **`EXPOSE 5000 6001 6002 6003 6100 7000 8090`**; compose publishes 3 publicly + 4 on loopback. **Conflicts with our model** |
| Inter-service comms | Observers called over `127.0.0.1`; `INTERNAL_SERVICE_TOKEN` replaces spoofable header. OK |
| SSRF | **Bypassable via IPv4-mapped IPv6 (§3.4)** |

### Git history secret scan

`gitleaks detect --log-opts="--all"` (231 commits, 4.98 MB) returned **no leaks found**.
An independent pattern sweep for AWS keys, PEM private keys, `ghp_`, `sk_live_`, `AKIA`,
and Slack tokens also returned nothing. `SECURITY_AUDIT.md`'s blocker 6 asks for an audit
of "every historical commit" — that is now done for this repository and came back clean.

---

## 5. Deployment configuration — conflicts with our architecture

Upstream `docker-compose.yml` is written for a standalone host and **must not be used
as-is**:

1. **It publishes ports.** `6100`, `7000`, `5000` bind `0.0.0.0`; `6001`, `6002`, `6003`,
   `8090` bind `127.0.0.1`. Requirement 7 forbids any published YouPI port.
2. **It sets `YOUPI_BIND_HOST: 0.0.0.0`** and `YOUPI_ALLOW_LOCALHOST_MODE: true`.
3. **Container name is `youpi-pg`**, not the identity we reserved.
4. **It declares its own volume** `youpi-data` and its own network (implicit default).

Required overrides for our deployment:

| Setting | Upstream | Ours |
| --- | --- | --- |
| Network | default bridge | `youpi-net` |
| IP | dynamic | `10.90.0.2` |
| MAC | random | `02:59:4f:11:00:02` |
| Published ports | 7 mappings | **none** |
| `YOUPI_BIND_HOST` | `0.0.0.0` | container-internal only |

The MAC pin is not cosmetic: without it nginx caches a stale ARP entry and connectivity
fails intermittently (measured: 3 of 5 recreations failed; 8 of 8 succeeded when pinned).

### Production state verified unchanged

| Check | Result |
| --- | --- |
| Containers | postgres 38h, web 2h, api 1h, nginx 13m — all up |
| `inet youpi_guard` | active, 2 drop rules |
| nginx YouPI-side IP | `10.90.0.254` |
| nginx ExamDump-side IP | `10.89.0.67` |
| YouPI service started | **no** |
| ExamDump code/DB/nginx config changed | **no** |

---

## 6. Remediation plan, by severity

**P0 — must fix before any deployment**
1. Patch `isPrivateAddress()` to reject IPv4-mapped IPv6 (`::ffff:a.b.c.d`) by normalising
   through `dns.lookup` or an `ipaddr.js` parse before range checks. Add regression tests
   for `[::ffff:10.89.0.186]` and `[::ffff:127.0.0.1]`. Until fixed, keep `youpi_guard` in
   force — it is the only control currently stopping this.

**P1 — must fix before real money**
2. Remove the `sessions[0]` fallback from `apps/sms-observer/src/sms-service.js:33` and
   make it fail closed like the Gmail observer, so a future token cannot silently
   reintroduce cross-account attribution.
3. Override compose to publish **zero** ports and bind to `youpi-net` only.
4. Supply production secrets from Doppler — never the demo values in `.env.production`.
   Generate fresh `ENCRYPTION_MASTER_KEY`, `JWT_SECRET`, `ADMIN_API_TOKEN`,
   `OBSERVER_TOKEN`, `INITIAL_ADMIN_PASSWORD`.

**P2 — before enabling the payment hostname**
5. Webhook egress allow-list (deny-by-default egress), not just URL validation.
6. Operator dashboards, backlog alerting and manual replay for the outbox
   (`SECURITY_AUDIT.md` blocker 4).
7. Run `npm ci && npm run typecheck && npm run build && npm test && npm audit --omit=dev`.

**P3 — operational**
8. Settlement reconciliation remains unproven; `SECURITY_AUDIT.md` itself says notification
   parsing does not establish settlement. Keep `PAYMENTS_ENABLED=false`.
9. Reconcile the `security/webhook-durability-hardening` scope branch — it is missing, so
   the audit's "implemented" table describes code not at HEAD.

No finding above is waived, suppressed or marked resolved without the code evidence cited.

---

## 7. Recommendation

**Do not deploy yet.** P0 is a genuine, reproduced vulnerability with a clean bypass; it is
currently masked only by firewall rules, which is defence in depth rather than a fix. The
source is securely staged at a verified SHA and the network identity is prepared and
tested. Awaiting approval before any container is created.
