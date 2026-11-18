---
description: "Plan and implement a new feature without breaking entitlements, payments, or production"
---

# Feature development

Use this workflow for a new user-visible feature or a cross-cutting change.

## 1. Load context

Read `AGENTS.md`, `README.md`, and the path-scoped instruction file for every
area you will touch. If the change involves payments, auth, database schema, or
deployment, read that file before writing code.

Locate the existing implementation first: routes in `apps/api/src/routes/`,
services in `apps/api/src/services/`, schema in `apps/api/src/db/schema/`, pages
in `apps/web/app/`, shared UI in `apps/web/components/`, validation in
`packages/shared/src/schemas.ts`.

## 2. Define the change

- State the user-visible behaviour and the server-side authority for it.
- Identify the API contract: method, path, request schema, response shape, error
  codes, auth/permission requirements.
- Identify data changes: tables, columns, indexes, migrations.
- Identify frontend states: loading, empty, error, unauthenticated, free-tier
  limit, premium.
- List what must **not** change (entitlement rules, payment settlement, cookie
  behaviour, existing response fields).

## 3. Implement

- Keep the existing layering and naming. Reuse helpers instead of adding a second
  pattern.
- Validate input with Zod and enforce access with the existing guards.
- Keep the amount, plan, and entitlement decisions server-side.
- Add the API route to `app.ts` and update `openapi.ts`.
- Reuse UI primitives and tokens; preserve light/dark parity and 360 px layout.
- Do not add dependencies unless there is no reasonable local alternative.

## 4. Verify

```bash
npm run typecheck
npm run test:api
npm run test -w @examdump/web
npm run build
```

Add tests for the new behaviour at the owning layer. For a migration, apply it to
a scratch database and prove the object exists. Never use production for
verification.

## 5. Document and report

Update the relevant instruction/doc section in the same change. In your final
report, list changed files, the behaviour added, the commands run, and anything
not verified. Do not claim production deployment unless you actually performed it
with authorization.
