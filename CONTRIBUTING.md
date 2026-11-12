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