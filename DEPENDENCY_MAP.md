# Dependency map

Every runtime dependency, what it is for, and what breaks without it. Keep this
current when adding a package.

## Policy

- **No new frontend dependencies** for Markdown or LaTeX rendering.
- Prefer an existing utility over a new package.
- Every dependency must justify itself in a PR description.
- Additions must be production dependencies only if used at runtime; otherwise
  `devDependencies`.

## apps/api

| Package | Purpose | If removed |
| --- | --- | --- |
| `fastify` | HTTP server | no API |
| `@fastify/cookie` | refresh-token cookie parsing | no persistent sessions |
| `@fastify/cors` | origin allow-list | cross-origin requests blocked |
| `@fastify/helmet` | security headers | weakened XSS/clickjacking protection |
| `@fastify/rate-limit` | request throttling | no brute-force resistance |
| `drizzle-orm` | typed SQL + migrations | no database access |
| `postgres` | PostgreSQL driver (pooling) | no database access |
| `zod` | input validation | **all** request validation |
| `bcryptjs` | password hashing | no password auth |
| `jose` | HS256 JWT sign/verify | no access tokens |
| `google-auth-library` | Google OIDC verification | Google sign-in unavailable |
| `nodemailer` | SMTP transport | no mail delivery |
| `node-cron` | scheduled jobs | no sync/expiry/reconciliation |
| `qrcode-generator` | server-side SVG QR | no UPI QR rendering |
| `@examdump/shared` | Zod schemas, types | internal |
| `@examdump/data-client` | GitHub dataset reads | no exam content |

## apps/web

| Package | Purpose |
| --- | --- |
| `next` | framework and server |
| `react`, `react-dom` | UI runtime |
| `@examdump/shared` | shared Zod schemas and types |

Deliberately minimal. Tailwind is a dev dependency compiled at build time.

Note: there is **no** Markdown or LaTeX package. Rendering is implemented in
`apps/web/components/markdown.tsx`. Adding one is explicitly disallowed.

## packages

| Package | Depends on | Purpose |
| --- | --- | --- |
| `@examdump/shared` | `zod` | schemas, types, content parser |
| `@examdump/data-client` | (none runtime) | GitHub dataset fetch + TTL cache |

`data-client` is **server-only** and must never be imported by `apps/web` — it would
bundle the access token path into client code.

## External services

| Service | Used for | Failure mode |
| --- | --- | --- |
| PostgreSQL 16 | all application data | API 500s |
| GitHub (private repo) | exam content | `DatasetError` → 502 |
| SMTP provider | email | queued + retried |
| AI provider (OpenAI-compatible) | explanations | AI endpoints fail only |
| Hyperswitch / Razorpay | card payments | checkout unavailable |
| Gmail API | UPI alert observation | observer pauses |
| Google OIDC | sign-in | password login still works |
| Doppler | secrets at deploy | existing containers keep running |

## CI-only

`vitest`, `tsup`, `tsx`, `typescript`, `prettier`, `npm-run-all`, `drizzle-kit`.

## Related

- [Architecture](ARCHITECTURE.md)
- [Service dependencies](docs/architecture/SERVICE_DEPENDENCIES.md)
- [Tech debt](TECH_DEBT.md)
