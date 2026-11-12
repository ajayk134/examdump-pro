# AGENTS.md — instructions for AI coding agents

Applies to **every** coding agent: GitHub Copilot, Claude Code, OpenCode, FreePi,
Cursor, aider, and any future tool. GitHub Copilot also reads
[`.github/copilot-instructions.md`](.github/copilot-instructions.md) and the
path-scoped files in `.github/instructions/`; those must stay consistent with this
file.

---

## 1. Before you write code

1. **Read the architecture.** [ARCHITECTURE.md](ARCHITECTURE.md) and
   [docs/architecture/SYSTEM_DESIGN.md](docs/architecture/SYSTEM_DESIGN.md).
2. **Locate the area you are changing.** [CODEBASE_MAP.md](CODEBASE_MAP.md).
3. **Read the relevant subsystem doc** before touching it — payments and UPI in
   particular. [docs/payments/](docs/payments/UPI.md) explains why the design is
   what it is; changing it without that context breaks money handling.
4. **Prefer existing implementations.** Search first (`grep`, then the map). If a
   helper exists in `apps/api/src/lib/`, use it. Do not add a second way to do the
   same thing.
5. **Understand the invariants** in section 3 before modifying anything related to
   entitlement, payments or the dataset.

## 2. How to make a change

- **Preserve existing behaviour** unless the task explicitly changes it. Do not
  refactor unrelated code in the same commit.
- **Preserve API contracts.** Response shapes, error codes and status codes are
  consumed by the frontend; changing one without updating the client is a bug.
- **Follow the layering.** `routes/` handles HTTP only; `services/` holds business
  logic and all writes; `db/schema/` defines tables; `lib/` holds cross-cutting
  utilities. A route must not query the database directly. A service must not
  import from `routes/`.
- **Follow existing conventions.** TypeScript strict, ESM, `.js` extensions in
  relative imports, Zod schemas in `packages/shared/src/schemas.ts`, errors via
  `apps/api/src/lib/errors.ts`.
- **Validate every external input** with Zod. Never trust `request.body`,
  `params` or `query` unchanged.
- **Handle errors and edge cases.** Empty lists, missing rows, expired state,
  concurrent writes. Never leave a `catch` that silently discards.
- **Add a regression test** for a bug fix, and a test for new behaviour. Put it
  next to the existing suite for that area (`apps/api/test/*.test.ts`).
- **Do not add dependencies** unless there is no reasonable alternative. No
  Markdown/LaTeX libraries on the frontend, and no Redis.
- **Consider security and performance in every change.** Would this leak a
  secret? Can a free user reach it? Does it add an unindexed query or an N+1?
- **Maintain responsive UI.** The exam interface must work at 360 px on touch and
  on desktop, in both light and dark themes.

## 3. Non-negotiable invariants

1. **PostgreSQL holds all application data.** Exam question content never goes into
   the database, fixtures, tests or commits. See
   [ADR-001](docs/decisions/ADR-001.md).
2. **Entitlement is decided server-side**, in
   `apps/api/src/services/entitlement.service.ts` only. UI limits are cosmetic.
   Never trust a client-supplied limit, offset or user id.
3. **The client cannot settle a payment.** Settlement comes only from a
   signature-verified webhook or a parsed bank notification under human review.
4. **Every UPI order gets a unique amount** (`base_amount_paise` + a 0–99 paise
   suffix). Do not remove `upi_orders_active_amount_idx`,
   `upi_matches_order_settled_idx` or `upi_notifications_utr_idx` — they enforce
   correctness, not speed.
5. **Money is integer paise.** Never a float, never a decimal string.
6. **Secrets come from Doppler.** Never hardcode, print, log or commit one. Never
   echo an env file. See [docs/security/SECRETS_MANAGEMENT.md](docs/security/SECRETS_MANAGEMENT.md).
7. **Payments stay off by default**: `PAYMENTS_ENABLED=false`,
   `UPI_AUTO_APPROVE=false`. Never enable production payments without explicit
   human authorization.
8. **No `dangerouslySetInnerHTML`** except the server-rendered own UPI QR SVG.
9. **Never use the word "student"** in code, docs, UI copy, emails or commit
   messages. Use "you", "user", "candidate", "professional" or "learner".
10. **Do not modify** `ajayk134/examdump`, `ajayk134/exam-data`, Cloudflare or
    Netlify resources unless explicitly asked.

## 4. Verify before claiming success

Run the commands that prove your change works:

```bash
npm run typecheck
npm run build
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" \
  npm test
```

- "Should work" is not verification. Run it.
- If a command cannot be run, say so plainly and explain what remains unverified.
- For a migration, confirm the object exists in the database, not just that the
  file was written:

  ```bash
  sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c '\d <table>'
  ```

- For a deploy, confirm the **running image** contains the change — a checked-out
  commit does not prove it:

  ```bash
  sudo podman exec examdump-pro_api_1 sh -c 'grep -l <symbol> /app/dist/*.js | wc -l'
  ```

## 5. Update documentation in the same commit

Documentation that drifts from the code is a defect. A code change is incomplete
until the docs describing it are updated.

| Change | Update |
| --- | --- |
| Endpoint or payload | `API.md`, `apps/api/src/openapi.ts` |
| Schema or migration | `DATABASE.md`, `docs/database/SCHEMA.md`, `docs/database/MIGRATIONS.md` |
| Index or constraint | `docs/database/INDEXES.md` |
| Auth, guards, permissions | `AUTH.md`, `docs/security/AUTHORIZATION.md` |
| Payments / UPI | `PAYMENTS.md`, `docs/payments/*.md` |
| Deployment, compose, nginx | `DEPLOYMENT.md`, `docs/deployment/*.md` |
| Environment variable | `docs/ENVIRONMENT.md`, `.env.example`, `deploy/docker-compose.yml` |
| Architecture, or a decision with lasting consequences | `ARCHITECTURE.md` + a new ADR in `docs/decisions/` |
| File layout, new subsystem | `CODEBASE_MAP.md`, `docs/architecture/SERVICE_DEPENDENCIES.md` |
| Frontend behaviour | `FRONTEND.md`, `UI_UX.md` |
| Performance-relevant change | `PERFORMANCE.md`, `docs/performance/*.md` |
| Test coverage | `TESTING.md`, `docs/testing/*.md` |
| Dependency | `DEPENDENCY_MAP.md` |
| Notable user/operator-visible change | `docs/CHANGELOG.md` |

Rules:

- **Never invent features, endpoints, configuration or behaviour** to make
  documentation look complete.
- **Remove or correct** documentation the change made inaccurate.
- **Name the source** (file path or command) for any factual claim.
- **Never fabricate measurements.** If it was not measured, say so.
- **Do not touch unrelated docs.** Keep the diff focused.

## 6. Git identity and commits

The repository must carry the owner's GitHub identity, never an agent's.

- **Before committing**, verify the local identity:
  ```bash
  git config user.name && git config user.email
  ```
  It must be the owner's. Never use "Copilot", "Claude", "OpenAI", an agent name,
  or an invented address.
- **Never change global git configuration.** Repository-local only.
- **Never rewrite existing commit history** to change authorship.
- **Never claim a commit belongs to the owner** merely because git accepted a
  name and email. Attribution, not acceptance, is the standard.
- **Review staged changes** before committing (`git diff --cached`): no secrets,
  no question data, no build output.
- **Commit messages**: imperative, sentence case, explaining *why* when not
  obvious. Never mention that an AI wrote it.
- **Stop and ask** if the correct identity cannot be verified.

## 7. Repository state warnings

Things that have caused real incidents on this project:

- **Two Podman stores exist.** Production is rootful (`sudo podman`). `podman ps`
  being empty does not mean the stack is down.
- **nginx caches the API container IP.** After recreating the API, run
  `sudo podman exec examdump-pro_nginx_1 nginx -s reload` or the site returns 502
  while the API is healthy.
- **Migrations run at container start.** The database can move ahead of an older
  image; a `NOT NULL` column without a default breaks the previous build.
- **`sudo` strips exported variables.** Use `doppler run`, not
  `sudo env FOO=$BAR`.

## 8. Commands

```bash
npm install
npm run build -w @examdump/shared && npm run build -w @examdump/data-client
npm run dev                       # api :4000 + web :3000
npm run typecheck
npm run migrate -w @examdump/api
npm run seed

# throwaway database for tests
podman run -d --name examdump-pg \
  -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16-alpine
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" npm test

# with secrets injected
doppler run --project examdump-pro --config prd -- npm run dev
```

## 9. Where to look

| Question | File |
| --- | --- |
| What does this repo do? | `README.md` |
| Where is file X? | `CODEBASE_MAP.md` |
| How is it structured? | `ARCHITECTURE.md` |
| What are the business rules? | `BUSINESS_LOGIC.md` |
| What is broken today? | `KNOWN_ISSUES.md`, `TECH_DEBT.md` |
| Why was it built this way? | `docs/decisions/` |
| Full documentation index | `docs/README.md` |
