---
description: "Review a change for correctness, security, entitlement, payments, and test coverage"
---

# Code review

Review the diff, not the author's summary. Prioritise defects that affect money,
access, data integrity, security, or production availability.

## Checklist

### Correctness

- Does the change preserve existing API contracts, status codes, and error codes?
- Are empty, missing, expired, concurrent, and retry cases handled?
- Is the change in the layer that owns the behaviour (route vs service vs schema)?
- Are database writes transactional where they span tables?
- Are new queries indexed appropriately?

### Access and entitlement

- Is access still decided server-side in `entitlement.service.ts`?
- Can a free user reach locked questions through IDs, offsets, filters,
  randomisation, or pagination?
- Are admin/permission guards present on every privileged route?
- Is any client-supplied user id, plan, role, or limit trusted?

### Payments

- Can the browser settle a payment?
- Is the amount server-quoted and stored in integer minor units?
- Is the webhook signature verified over the exact raw body before settlement?
- Are duplicate deliveries idempotent?
- Are amount/currency mismatches refused?
- For YouPI, is settlement limited to `RECONCILED`?
- Could the change enable a provider, alter gateway config, or create a live
  charge without authorization?

### Security

- Any secret, token, cookie, or env value in code, logs, errors, tests, or docs?
- Any weakened cookie flag, CORS origin, rate limit, log redaction, or signature
  check?
- Any `sql.unsafe` with user input, unvalidated input, or XSS sink?
- Any `dangerouslySetInnerHTML` for untrusted/model content?

### Data and content

- Any exam question content copied into PostgreSQL, fixtures, tests, logs, docs,
  or commits?
- Is the migration forward-only, with a backfill for `NOT NULL`?
- Are existing migrations untouched?
- Are money values integers and timestamps timezone-aware?

### Tests and docs

- Is there a regression test for a fix and a test for new behaviour?
- Do tests use synthetic content and avoid live gateways/AI/network?
- Were the relevant commands actually run?
- Are docs updated for behaviour, env, schema, endpoints, or deployment changes?
- Does any doc claim a feature, script, backup, or deployment path that does not
  exist?

### Production

- Does the change require a migration, restart, env change, or config change?
- Is the deployment procedure safe and reversible?
- Does it touch YouPI-PG, unrelated services, or production data unnecessarily?

## Output

Group findings by severity:

- **Blocking** — correctness, security, money, access, or data loss.
- **Important** — likely bug, missing test, broken contract, stale doc.
- **Nit** — style or clarity only.

For each finding, cite the file and line, explain the impact, and suggest a
concrete fix. If no blocking issue exists, say so explicitly and list what was
not verified.
