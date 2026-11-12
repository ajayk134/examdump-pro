# End-to-end testing

**No E2E suite exists in this repository.** This page documents what that means
and how to add one, rather than describing tests that are not there.

## Current coverage gap

| Layer | Covered | Where |
| --- | --- | --- |
| Pure logic | yes | `packages/*/src/*.test.ts` |
| HTTP + database | yes | `apps/api/test/` |
| Concurrency invariants | yes | `upi.test.ts`, `payments.test.ts` |
| **Browser rendering** | **no** | — |
| **Full user journey** | **no** | — |
| **Cross-browser** | **no** | — |

## What is therefore unverified

These have no automated coverage:

- Login → browse → start attempt → answer → see results, as a real browser flow.
- The UPI QR page rendering and checkout return handling.
- Client-side form validation and error display.
- Responsive layout at mobile widths.
- Anything involving cookies set across the API and web origins — `inject()` tests
  bypass the real cookie jar and CORS.

A regression in any of these would be caught only manually.

## Adding an E2E suite

Constraints worth respecting if you do:

1. **Do not add a heavy dependency gratuitously.** Playwright is the realistic
   choice; it is a dev dependency and does not affect the production bundle.
2. **Run against a real stack.** Compose up on a test database, not mocks.
3. **No real payments.** Keep `PAYMENTS_ENABLED=false`. Never exercise a live
   gateway in a test.
4. **No real dataset content.** Point `DATASET_*` at fixtures.
5. **Keep it small.** E2E tests are the slowest and most brittle layer. Cover the
   journeys that matter — login, one study flow, one checkout page render — not
   every button.

## Suggested minimal scope

If added, a first suite should cover exactly:

- Register → verify → login → dashboard loads.
- Open an exam → start a practice attempt → answer → submit → results render.
- Free user sees at most `FREE_QUESTIONS_PER_EXAM` questions.
- Pricing page loads and the UPI button reflects `available:false`.
- Admin console loads for an admin and is rejected for a normal user.

## Related

- [Integration testing](INTEGRATION_TESTING.md)
- [Concurrency testing](CONCURRENCY_TESTING.md)
- [Testing overview](README.md)
- [TECH_DEBT.md](../../TECH_DEBT.md)
