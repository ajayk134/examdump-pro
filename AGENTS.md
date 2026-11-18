# AGENTS.md — operating contract for coding agents

This file applies to **every** coding agent working in this repository:
GitHub Copilot, OpenCode, Claude Code, Cursor, aider, and any future tool.
GitHub Copilot also reads [`.github/copilot-instructions.md`](.github/copilot-instructions.md)
and the path-scoped files in `.github/instructions/`; keep them consistent with
this contract.

Read this file before changing code. For architecture and commands, read
[`README.md`](README.md).

---

## 1. What this repository is

ExamDump Pro is a production certification-exam preparation SaaS.

- **Exam question content** lives in a private GitHub repository and is read
  server-side at request time. It must never be copied into PostgreSQL,
  fixtures, tests, seed data, logs, documentation, or commits.
- **Application data** (users, sessions, subscriptions, payments, attempts,
  progress, analytics, audit) lives in PostgreSQL through Drizzle ORM.
- **Secrets** come from Doppler project `examdump-pro`, config `prd`; the host
  renders them into `/etc/examdump-pro/production.env`.
- **Production is the only deployed environment.** There is no staging, QA, or
  test deployment. CI uses an ephemeral PostgreSQL container; that is the only
  sanctioned test database.
- **Production runs natively** under systemd. There is no Docker or Podman path
  for this application.

## 2. Non-negotiable rules

1. **Never put question content in the database, fixtures, tests, logs, docs, or
   commits.** Tests use synthetic question text.
2. **Entitlement is decided server-side** in
   `apps/api/src/services/entitlement.service.ts`. Never trust a client-supplied
   plan, limit, offset, exam key, or question ID. Slice the accessible set before
   filtering or randomising.
3. **Never settle a payment from a browser redirect.** A payment succeeds only
   from a signature-verified webhook or a server-to-server gateway status check.
   For YouPI-PG, only a `RECONCILED` event settles; `OBSERVED_SUCCESS` and
   `MANUAL_REVIEW` never do.
4. **Never enable, reconfigure, or exercise live payments** without explicit
   human authorization. Do not create a real charge, change gateway credentials,
   or replay a production webhook as a test.
5. **Never modify production infrastructure as a side effect of a code task.**
   No service restarts, env-file writes, database resets, or nginx changes unless
   the task is explicitly a deployment/operations task and the user authorized it.
6. **Never touch the production database destructively.** Do not drop, truncate,
   recreate, reset, or run `db:push` against it. Migrations are forward-only.
7. **Never modify or interfere with YouPI-PG or unrelated VPS services.** YouPI-PG
   is a separate application on the same host.
8. **Never commit, print, log, paste, or echo a secret.** Check presence, not
   value. Do not `cat` the production env file. Never weaken log redaction or
   webhook signature verification.
9. **Preserve API contracts** unless the task explicitly changes them. Response
   shapes, status codes, error codes, cookie names, and SSE framing are consumed
   by the web app.
10. **Do not invent features, endpoints, configuration, measurements, or
    deployment steps.** If something does not exist, say so.

## 3. Change workflow

1. **Locate the authority.** Use the map in `README.md` and the relevant
   path-scoped instruction file. Search for an existing helper before adding a
   new abstraction.
2. **Read the subsystem's invariants.** Payments, auth, entitlement, dataset, and
   mail each have non-obvious correctness rules.
3. **Make the smallest coherent change.** Do not refactor unrelated code in the
   same commit. Preserve existing behaviour unless the task changes it.
4. **Follow the layering.** Routes handle HTTP; services hold business logic and
   database writes; `db/schema/` defines tables; `lib/` holds cross-cutting
   utilities. `apps/api/src/routes/attempts.ts` is an existing exception that
   writes directly; do not spread that pattern.
5. **Validate external input** with the Zod schemas in
   `packages/shared/src/schemas.ts`. Use the error helpers in
   `apps/api/src/lib/errors.ts`, not hand-built error payloads.
6. **Add or update tests.** Every bug fix needs a regression test; every new
   behaviour needs a test at the appropriate layer.
7. **Update documentation in the same commit** when behaviour, commands,
   endpoints, schema, env vars, security, or deployment changes.
8. **Review the diff before committing.** No secrets, no question content, no
   build output, no unrelated files.

## 4. Verification

Run the commands that prove the change works. Do not claim success from
inspection alone.

```bash
npm run typecheck          # all workspaces; this is also "lint"
npm run build              # shared → data-client → api → web
npm run test:api           # needs DATABASE_URL_TEST
npm run test -w @examdump/web
npm run test -w @examdump/shared
npm run test -w @examdump/data-client
```

- API integration tests require a real PostgreSQL via `DATABASE_URL_TEST`. Never
  point them at production.
- CI does not run `apps/web/test`; run it locally for frontend changes.
- If a command cannot be run, say so plainly and state what remains unverified.
- For a migration, prove the object exists in the target database, not just that
  a SQL file was written.
- For a deployment, prove the running service has the change and
  `/api/health/ready` is healthy. A git checkout is not a deployment.

## 5. Production facts and guardrails

- nginx is the only public listener (`:80`/`:443`). Web is
  `127.0.0.1:3000`; API is `127.0.0.1:4000`; PostgreSQL is `127.0.0.1:5432`.
- Services: `nginx`, `examdump-api`, `examdump-web`, `postgresql`.
- Runtime: `/opt/examdump-pro` with pinned Node 22 at
  `/opt/examdump-pro/node/bin/node`.
- API runs `dist/index.js`; web runs `apps/web/server.js` from the Next.js
  standalone output.
- **Migrations do not run at boot.** Apply them explicitly before restarting the
  API. The deployed SQL is in `/opt/examdump-pro/api/migrations`; set
  `MIGRATIONS_DIR` explicitly because the runner does not search that folder.
- Production currently has payments enabled and YouPI available. Do not assume
  the development defaults from `.env.example` apply.
- There is no tracked deploy script, container deployment, or backup schedule.
  Do not invent one or claim one exists.

Use read-only inspection first:

```bash
systemctl status examdump-api examdump-web --no-pager
journalctl -u examdump-api -n 100 --no-pager
curl -fsS http://127.0.0.1:4000/api/health/ready
```

Any state-changing production command requires a clear reason, a rollback path,
and user confirmation.

## 6. Documentation and commits

Documentation drifts are defects. When code changes, update the authoritative
file in the same commit:

- API shape → `apps/api/src/openapi.ts` and the relevant route comments.
- Env var → `apps/api/src/config/env.ts`, `.env.example`, and
  `.github/instructions/deployment.instructions.md` if production-relevant.
- Schema/migration → `README.md` database section and
  `.github/instructions/database.instructions.md`.
- Payments → `.github/instructions/payments.instructions.md`.
- Deployment/CI → `.github/instructions/deployment.instructions.md`.
- Frontend conventions → `.github/instructions/frontend.instructions.md`.
- Agent workflow → this file and `.github/copilot-instructions.md`.

Git rules:

- Verify `git config user.name` and `git config user.email` before committing.
  They must be the repository owner's verified identity, never an agent name or
  invented address.
- Never rewrite history to change authorship.
- Imperative, sentence-case commit messages; explain _why_ when not obvious.
  Never mention that an AI wrote the change.
- Stage explicitly. Do not commit `.env*` (except templates), `node_modules/`,
  `dist/`, `.next/`, logs, database dumps, or local QA artifacts.

## 7. Known traps

- `doppler.yaml` points at `agent-keys` / `dev_personal`, not production. Use
  `--project examdump-pro --config prd`.
- `.env.example` is stale in places (AI provider/model, mock payments, MongoDB
  comment, web port). Source code and `env.ts` win.
- `apps/api/package.json` has `upi:gmail-oauth`, but the target script is missing.
- Migrations `0006`–`0008` create dormant UPI tables that no current code uses;
  `0007` is skipped on a fresh database due to its journal timestamp.
- The `/security` page incorrectly says MongoDB; the application uses PostgreSQL.
- CI does not run web tests.
- Production env contains unused legacy variables (`MONGODB_*`,
  `UPI_AUTO_APPROVE`, `MIGRATION_DATABASE_URL`); do not treat them as live
  configuration. (`YOUPI_*` variables are live.)

## 8. Where to look

| Question                           | File                                              |
| ---------------------------------- | ------------------------------------------------- |
| What is this system?               | `README.md`                                       |
| How do I run and verify it?        | `README.md` § Local development                   |
| What are the API entry points?     | `README.md` § Source entry points                 |
| How is production deployed?        | `.github/instructions/deployment.instructions.md` |
| What are the payment rules?        | `.github/instructions/payments.instructions.md`   |
| What are the security rules?       | `.github/instructions/security.instructions.md`   |
| How do I change the schema?        | `.github/instructions/database.instructions.md`   |
| What are the frontend conventions? | `.github/instructions/frontend.instructions.md`   |
| What are the API conventions?      | `.github/instructions/backend.instructions.md`    |
| How do I test?                     | `.github/instructions/testing.instructions.md`    |
