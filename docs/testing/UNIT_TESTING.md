# Unit testing

Pure logic with no I/O. Fast, no database required.

## Location

| Package | File | Covers |
| --- | --- | --- |
| `packages/shared` | `src/content.test.ts` | dataset content parser, masked-branch key formats |
| `packages/data-client` | `src/dataset.test.ts` | dataset client, TTL cache, error mapping |

```bash
npm test -w @examdump/shared
npm test -w @examdump/data-client
```

## What belongs here

- Parsers (`packages/shared` content parser, `services/upi/parser.ts`)
- Money arithmetic (`services/upi/money.ts`)
- UPI URI construction (`services/upi/uri.ts`)
- Risk scoring (`services/upi/risk.ts`)
- Template rendering and placeholders (`services/mail/rendering`)
- Zod schema behaviour (`packages/shared/src/schemas.ts`)

## What does not

Anything needing a database, HTTP, SMTP or a provider. Those belong in
[integration tests](INTEGRATION_TESTING.md). A unit test that mocks Drizzle is
testing the mock.

## Example shape

```ts
import { describe, expect, it } from 'vitest';
import { extractAmount } from '../src/services/upi/parser.js';

describe('extractAmount', () => {
  it('prefers the credited amount over the running balance', () => {
    const text = 'Rs.499.37 credited to A/c XX1234. Available balance Rs.10,000.00';
    expect(extractAmount(text)?.amountPaise).toBe(49937);
  });

  it('returns null when no amount is present', () => {
    expect(extractAmount('Your statement is ready')).toBeNull();
  });
});
```

## Determinism

Randomness is injectable so tests can pin it:

```ts
setSuffixRandom(() => 37);   // force the 37-paise suffix
// ... assert ...
setSuffixRandom(null);       // restore
```

Never seed a test on real randomness — a flaky test that fails 1 in 100 runs is
worse than no test.

## Writing a good unit test

- Name the behaviour, not the function: `'rejects a notification without a UTR'`.
- One reason to fail per test.
- Include the boundary cases: zero, maximum, off-by-one
  (`suffix 0` and `suffix 99` both matter for `upi_orders_amount_suffix_ck`).
- Assert on the returned value, not on internal calls.

## Related

- [Integration testing](INTEGRATION_TESTING.md)
- [Concurrency testing](CONCURRENCY_TESTING.md)
- [Testing overview](README.md)
