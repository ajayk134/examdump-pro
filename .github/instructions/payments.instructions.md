---
applyTo: "apps/api/src/routes/payments.ts,apps/api/src/services/payments/**,apps/api/src/services/subscription.service.ts,apps/api/src/services/webhook.service.ts,apps/api/src/db/schema/billing.ts,apps/api/src/db/migrations/**,apps/web/app/pricing/**,apps/web/app/checkout/**,packages/shared/src/schemas.ts"
---

# Payments instructions

Payments are the highest-risk code in the repository. Read this file before
changing a route, service, adapter, schema, migration, pricing page, or checkout
return page.

## Live production state (verified 2026-11-18)

- `PAYMENTS_ENABLED=true`, `YOUPI_ENABLED=true`, `ALLOW_MOCK_PAYMENTS=false`.
- YouPI-PG is the only checkout path that can currently take money.
- HyperSwitch is labelled as the provider but is not checkout-ready
  (`checkoutReady:false`, `gatewayConfigured:false`); the adapter registry reports
  `adapter_coming_soon`.
- Razorpay is implemented but not selected; `PAYMENT_ADAPTER` defaults to `none`.
- Do not infer state from `.env.example`, which still shows payments disabled.

Never enable a provider, change gateway credentials, create a live order, or
replay a production webhook without explicit human authorization.

## Non-negotiable invariants

1. **The browser never settles a payment.** A redirect, query parameter, or
   client-supplied status is not proof. Settlement comes only from a
   signature-verified webhook or a server-to-server gateway status check.
2. **The amount comes from the server.** Quote the plan/coupon/exam selection
   server-side and store integer minor units (paise). Never trust an amount from
   the request body.
3. **YouPI settles only on `RECONCILED`.** `OBSERVED_SUCCESS` and
   `MANUAL_REVIEW` are recorded and ignored; they never grant entitlement.
4. **Verify the signature before any idempotency shortcut.** Preserve the raw
   request body captured by `app.ts`; do not re-serialise JSON for HMAC checks.
5. **Idempotency is required.** Checkout creation carries an idempotency key;
   webhook events have a unique `(provider, eventId)` constraint; duplicate
   deliveries must not double-settle.
6. **Check amount and currency against the stored order.** A mismatch is recorded
   and refused, never settled.
7. **Settlement is centralised.** All rails converge on
   `subscription.service.settlePayment()` so entitlement, invoices, and audit
   stay consistent.
8. **Refunds are bounded and audited.** Respect `PAYMENT_MAX_REFUNDS` and the
   refund service; never mutate payment status directly.

## YouPI-PG

Files: `services/payments/youpi.client.ts`, `routes/payments.ts`,
`apps/web/app/pricing/page.tsx`, `apps/web/app/checkout/return/page.tsx`.

- Checkout requires **both** `PAYMENTS_ENABLED` and `YOUPI_ENABLED`; the
  deployment-wide switch always wins. The gate runs before auth, quoting, or any
  gateway call.
- The integration uses `MANUAL_UPI`; this deployment runs Gmail-only and has no
  paired SMS observer.
- The order reference is generated server-side and sent as the gateway
  `orderId`. The local `payments` row stores `provider: 'upi'`, `orderRef`, and
  the gateway payment id.
- Webhook: HMAC-SHA256 over the raw body (`X-Gateway-Signature`, with the
  timestamped V2 signature preferred), replay tolerance, delivery-id dedupe,
  amount/currency equality, gateway-payment-id consistency, and `RECONCILED`
  plus `settlementState === 'RECONCILED'`.
- `FAILED`, `EXPIRED`, and `CANCELLED` may close a pending local order, but never
  grant access.
- The return page polls `POST /payments/:id/verify`. For `provider === 'upi'`,
  that endpoint returns the local pending/failed status and must not probe
  HyperSwitch with a YouPI id.

## HyperSwitch

Files: `services/hyperswitch.client.ts`, `services/webhook.service.ts`,
`routes/payments.ts`.

- Checkout is offered only when `checkoutReady(env)` is true.
- Webhooks are verified with the configured HMAC-SHA512 secret over the raw body,
  then the payment is re-fetched server-to-server before settlement.
- Invalid signatures are recorded and rejected with 401.
- Reconciliation runs only when checkout is ready; it repairs missed webhooks and
  drift.

## Razorpay adapter

Files: `services/payments/razorpay.adapter.ts`, `services/payments/registry.ts`.

- A live adapter is selected only when `PAYMENT_ADAPTER` names it,
  `PAYMENTS_ENABLED=true`, and all credentials are present.
- Signature verification plus a server-side status fetch are both required.
- The registry is deliberately conservative: no sandbox fallback, no simulated
  success, no silent provider switch.

## Mock activation

`POST /payments/mock-activate` exists for local development only. It is refused
when checkout is ready, when `NODE_ENV=production`, or when
`ALLOW_MOCK_PAYMENTS` is false. Do not weaken those checks or advertise mock
activation in production.

## Tests

Use local signed payloads and mock gateway clients. Cover:

- successful settlement;
- duplicate webhook delivery;
- invalid/missing signature;
- wrong amount or currency;
- non-settlement YouPI events (`OBSERVED_SUCCESS`, `MANUAL_REVIEW`);
- return-page polling without settlement;
- refund limits and audit.

Never run a test against a live gateway, create a real charge, or replay a
production webhook. `npm run test -w @examdump/api` must never point at the
production database.
