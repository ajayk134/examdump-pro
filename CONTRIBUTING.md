# Contributing

Thanks for helping improve ExamDump Pro.

## Workflow

1. Fork the repository and create a feature branch.
2. Follow the conventions in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
3. Add or update tests for behavioural changes.
4. Run before pushing:

```bash
npm run typecheck
DATABASE_URL_TEST="postgres://postgres:postgres@127.0.0.1:5433/examdump_test" npm test
npm run build
```

5. Open a pull request describing the change and its motivation.

## Documentation is part of the change

A code change is not complete until the documentation that describes it is
updated **in the same commit**. Documentation that drifts from the code is worse
than no documentation, because it is trusted.

| If you change… | Update… |
| --- | --- |
| An endpoint, request/response shape | `API.md`, and `apps/api/src/openapi.ts` |
| The database schema | `DATABASE.md`, `docs/database/SCHEMA.md`, `docs/database/MIGRATIONS.md` |
| Indexes or constraints | `docs/database/INDEXES.md` |
| Auth, guards, RBAC, permissions | `AUTH.md`, `docs/security/AUTHORIZATION.md` |
| Anything payment or UPI related | `PAYMENTS.md`, `docs/payments/*.md` |
| Deployment, compose, nginx, Dockerfile | `DEPLOYMENT.md`, `docs/deployment/*.md` |
| An environment variable | `docs/ENVIRONMENT.md`, `.env.example`, `/etc/examdump-pro/production.env` |
| Architecture or a load-bearing decision | `ARCHITECTURE.md`, and add an ADR under `docs/decisions/` |
| File layout or a new subsystem | `CODEBASE_MAP.md`, `docs/architecture/SERVICE_DEPENDENCIES.md` |
| Frontend rendering or UI behaviour | `FRONTEND.md`, `UI_UX.md` |
| Performance-relevant behaviour | `PERFORMANCE.md`, `docs/performance/*.md` |
| Tests | `TESTING.md`, `docs/testing/*.md` |
| A dependency | `DEPENDENCY_MAP.md` |
| Anything notable for users or operators | `docs/CHANGELOG.md` |

Rules for documentation changes:

- **Never invent behaviour.** If a feature does not exist, do not document it as if
  it does. If something is missing, say so — see `KNOWN_ISSUES.md` and
  `TECH_DEBT.md` for the established style.
- **Delete what is no longer true.** Stale documentation is a defect; remove it
  rather than leaving it to mislead.
- **Name the source.** Reference the file or command that verifies a claim.
- **Do not fabricate measurements.** If a number was not measured, write that it
  was not measured.
- **Do not create duplicate documents.** Link to the existing one instead.
- Only touch documentation related to your change. Unrelated doc churn makes
  review harder.

## Rules

- **Never commit secrets.** Use Doppler or a local `.env` (gitignored).
- **Never add exam questions to this repository.** The dataset belongs in the
  private `exam-data` GitHub repository.
- Keep entitlement and grading logic server-side.
- Preserve accessibility (semantic HTML, labels, keyboard focus, contrast) and
  dark/light theme parity.
- Keep dependencies minimal and justified.
- Never use the word "student" in code, docs, UI copy or commits — the product
  serves candidates and working professionals.
- Payments default to off. Do not enable `PAYMENTS_ENABLED` or
  `UPI_AUTO_APPROVE` in a pull request.
- No `dangerouslySetInnerHTML` except the server-rendered own UPI QR SVG.

## Commit messages

Conventional commits are preferred: `feat:`, `fix:`, `docs:`, `test:`,
`refactor:`, `chore:`, `perf:`, `security:`.

## Reporting security issues

Do not open public issues for vulnerabilities. Contact the maintainers privately
with reproduction steps and impact.