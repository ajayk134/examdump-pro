# Business logic

How the product makes money and what the rules are. Distinct from
[ARCHITECTURE.md](ARCHITECTURE.md), which describes how it is built.

## The commercial model

Freemium subscription.

| Tier | Price | Gets |
| --- | --- | --- |
| Free | 0 | all exams, first `FREE_QUESTIONS_PER_EXAM` (5) questions each |
| Premium | per plan in `plans` | full question sets, AI tutor, unlimited exams |

The free tier is a real product, not a crippled demo: it shows enough of an exam
to be useful and to demonstrate quality. Conversion depends on the user hitting the
5-question wall inside a genuinely useful exam.

## Entitlement rules

These are the actual business rules, implemented in
`apps/api/src/services/entitlement.service.ts`.

1. **Free users** may open any exam and see the first 5 questions.
2. **Premium users** see the full set, paced by `PREMIUM_DAILY_QUESTION_LIMIT`
   (default 2000/day) to bound scraping.
3. **Grants are per exam.** A plan may cover one exam (`exam_key`) or everything
   (`access_grants` with no exam filter). This is what allows per-certification
   pricing.
4. **Subscription state is checked at read time**, not only by the daily expiry
   cron. A missed job cannot leave a lapsed user with access.
5. **Answers are withheld** in mock and timed modes until submission. Practice
   mode reveals them inline.
6. **AI is premium-only.** `AI_DAILY_LIMIT_FREE=0` by default.

Violating any of these in code is a product bug, not a style issue — it either
gives away paid content or breaks a paying customer.

## Plans

`plans` is seeded by `npm run seed` and managed from the admin console. A plan
carries duration, price in paise, and scope. Prices are integers — see
[money representation](docs/database/SCHEMA.md#money-representation).

## Discounts and growth

| Mechanism | Behaviour |
| --- | --- |
| **Coupons** | percentage or fixed discount, optional expiry, one redemption per user (`coupon_redemptions_unique`) |
| **Referrals** | a referrer earns credit when a referred user converts; recorded in `referrals` with both parties |
| **Free trials** | not implemented — no trial period logic exists |

Referral credit and coupon stacking are deliberately limited: one coupon per
purchase, and referral credit is applied at checkout rather than accumulating.

## Payment channels

| Channel | State | Notes |
| --- | --- | --- |
| Mock checkout | enabled only when `ALLOW_MOCK_PAYMENTS=true` and never in production | for local development |
| Hosted provider (Hyperswitch / Razorpay) | implemented, disabled | requires `PAYMENTS_ENABLED=true` and provider credentials |
| UPI (first-party) | implemented, disabled | unique amounts + human review; see [UPI](docs/payments/UPI.md) |

**All rails are off by default.** `PAYMENTS_ENABLED=false` means checkout returns
503 and no order is created. This is intentional and must not be changed without an
explicit business decision.

## Revenue integrity

The things that actually protect revenue:

1. Entitlement is server-side and single-sourced.
2. The client can never mark a payment as successful.
3. Every UPI order has a unique amount; the database enforces it.
4. An order settles at most once — enforced by a partial unique index.
5. Refund amounts are bounded by what was captured.
6. Everything privileged is audited.

Weak points, stated honestly: UPI matching is notification-based, not
bank-verified ([ADR-003](docs/decisions/ADR-003.md)); `PAYMENT_MAX_REFUNDS` is not
enforced ([KNOWN_ISSUES](KNOWN_ISSUES.md)).

## Content economics

Exam content is licensed and lives in a private repository. The business constraint
that follows: content must never be committed to this repository or copied into the
database, because both would spread licensed material outside its controlled
source. This is enforced by convention and review, not by tooling.

## Metrics that matter

None are currently collected. What should exist, in priority order:

1. Free → premium conversion rate.
2. Free-tier wall hits (how many users exhaust 5 questions).
3. Payment success rate by channel.
4. UPI match rate (paid orders that were successfully matched).
5. Refund rate.
6. Churn at renewal.

Without these, pricing and conversion decisions are guesses. Tracked in
[TECH_DEBT.md](TECH_DEBT.md).

## Related

- [Architecture](ARCHITECTURE.md)
- [Entitlement rules (security)](docs/security/AUTHORIZATION.md)
- [Payments](PAYMENTS.md)
- [Data flow](docs/architecture/DATA_FLOW.md)
