---
description: "Diagnose and fix a bug with a regression test and minimal blast radius"
---

# Bug fix

## 1. Reproduce and bound the problem

- State the observed behaviour, expected behaviour, and exact reproduction steps.
- Identify the layer: browser, API route, service, database, dataset, auth,
  payments, mail, AI, or deployment.
- Check whether the bug is already covered by `apps/api/test` or `apps/web/test`.
- Do not change unrelated code to make the symptom disappear.

## 2. Find the root cause

Trace the request or data path to the authoritative file. Useful starting points:

| Symptom                       | Look at                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| Wrong access / locked content | `services/entitlement.service.ts`, `lib/question-scope.ts`, `routes/attempts.ts`     |
| Login/session loop            | `lib/guards.ts`, `lib/cookies.ts`, `services/auth.service.ts`, `apps/web/lib/api.ts` |
| Payment not unlocking         | `routes/payments.ts`, `services/subscription.service.ts`, `services/payments/*`      |
| Missing/incorrect questions   | `packages/data-client/src/dataset.ts`, `services/dataset.service.ts`                 |
| Mail not delivered            | `services/mail/*`, queue state in `email_queue`                                      |
| AI failure                    | `services/ai.service.ts`, `routes/ai.ts`, nginx SSE settings                         |
| Deploy/runtime failure        | systemd unit, `journalctl`, `/api/health/ready`                                      |

Read the relevant path-scoped instruction file before editing.

## 3. Fix minimally

- Change the smallest code path that owns the bug.
- Preserve API contracts unless the contract itself is wrong; if it is, update
  both sides and call it out.
- Never weaken auth, entitlement, signature verification, or amount checks to
  make a case pass.
- Never “fix” a production data problem by resetting or editing production rows
  without authorization.

## 4. Prove it

- Add a regression test that fails before the fix and passes after it.
- Run the narrow test first, then the relevant suite and typecheck:

```bash
npm run test:api
npm run test -w @examdump/web
npm run typecheck
```

If the bug is production-only, use read-only inspection (`journalctl`, health
endpoints, service status) and explain what could not be reproduced locally.

## 5. Report

State the root cause, the fix, the regression test, commands run, and residual
risk. Do not claim the bug is fixed if the proof did not run.
