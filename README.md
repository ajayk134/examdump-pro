# ExamDump Pro

A production-ready, premium certification exam-preparation SaaS. Practice with
real exam questions, sit timed mock exams, get AI explanations and track every
weak topic across 160+ certification providers.

> **Exam questions live exclusively in GitHub.** MongoDB stores application data
> only (users, sessions, subscriptions, progress, analytics, etc.). Secrets are
> injected by [Doppler](https://doppler.com) and never committed.

---

## Highlights

- **Discovery** — browse/search 1,800+ exams across 160+ providers with filters.
- **Study modes** — practice, reading, random, mock and timed exams.
- **Entitlements** — free accounts unlock 5 questions per exam; Premium unlocks
  everything. Limits are enforced **server-side** and cannot be bypassed by
  pagination, offsets, randomisation or direct question IDs.
- **AI tutor** — premium, on-demand explanations via any OpenAI-compatible API.
- **Progress** — attempts, server-side grading, weak-topic analysis,
  performance charts, streaks, leaderboards and recommendations.
- **Premium** — plans, coupons, referrals, simulated checkout, payment history,
  notifications and a complete admin console.
- **Security** — HttpOnly rotating refresh tokens, email verification, password
  reset, Google sign-in, rate limiting, audit logs, validation, Helmet, CORS.
- **Ops** — Docker, nginx, CI/CD, dataset sync cron, backups, health checks.

## Tech stack

| Layer | Technology |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS |
| API | Fastify 5, TypeScript, Zod, Mongoose |
| Data | MongoDB Atlas (application data) |
| Dataset | Private GitHub repo (`exam-data`) read server-side with a token |
| Auth | JWT access tokens + opaque rotating refresh tokens in HttpOnly cookies, Google OIDC |
| Secrets | Doppler |
| Deploy | Docker / Docker Compose, nginx, Oracle Cloud VM |

## Repository layout

```
apps/
  api/                 Fastify API (routes, services, models, tests)
  web/                 Next.js frontend
packages/
  shared/              Types, Zod schemas, dataset content parser
  data-client/          GitHub dataset client (TTL cache, both branch formats)
deploy/                Dockerfiles, docker-compose, nginx, backup scripts
docs/                  Architecture, API, database, deployment, security, testing
.github/workflows/     CI (typecheck, tests, builds, docker, secret scan)
```

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Configure environment (never commit this file)
cp .env.example .env
#    Fill MONGODB_URI, GITHUB_TOKEN, JWT secrets, etc.
#    Or inject automatically with Doppler:
#    doppler run -- npm run dev

# 3. Build shared packages (once)
npm run build -w @examdump/shared
npm run build -w @examdump/data-client

# 4. Seed plans/settings/admin + sync the exam catalogue
npm run seed

# 5. Run API (:4000) and web (:3000)
npm run dev
```

Then open `http://localhost:3000`. The API reference is at
`http://localhost:4000/api/docs`.

For the web app during local development, copy
`apps/web/.env.local.example` to `apps/web/.env.local` and point
`NEXT_PUBLIC_API_URL` at the API (default `http://localhost:4000`).

### Demo accounts (created by `npm run seed` in non-production)

- Admin: value of `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- User: `demo@examdump.pro` / `DemoPass123`

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API and web together |
| `npm run build` | Build all workspaces |
| `npm run typecheck` | TypeScript across the monorepo |
| `npm test` | Shared + data-client + API tests |
| `npm run test:api` | API integration tests |
| `npm run seed` | Seed plans, settings, admin and catalogue |
| `npm run migrate -w @examdump/api` | Apply pending data migrations |
| `npm run sync:dataset -w @examdump/api` | Re-index the GitHub dataset |

## Environment

See [`.env.example`](.env.example) for every variable. The most important ones:

- `MONGODB_URI`, `MONGODB_DB`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PASSWORD_PEPPER`
- `GITHUB_TOKEN` (read-only access to the private dataset)
- `DATASET_OWNER`, `DATASET_REPO`, `DATASET_BRANCH` (`main` or `masked_main`)
- `PUBLIC_WEB_URL`, `WEB_ORIGIN`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (optional)
- `SMTP_*` (optional; emails are logged when unset)
- `AI_API_KEY` (optional; AI feature is hidden without it)

## Testing

```bash
# Use a throwaway database for integration tests
MONGODB_URI_TEST="mongodb://127.0.0.1:27017/examdump_test" npm test
```

In CI a MongoDB 7 service is provided automatically. The suite covers the
content parser, the GitHub data client (including masked branch keys), auth,
entitlement enforcement, grading, subscriptions/coupons, admin and the audit
trail.

## Deployment

Full instructions for the Oracle Cloud VM (Docker Compose + Doppler + nginx +
Let's Encrypt) are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

```bash
cd deploy
doppler run --project examdump-pro --config prd -- docker compose up -d --build
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Database & data model](docs/DATABASE.md)
- [Deployment runbook](docs/DEPLOYMENT.md)
- [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Development](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

Proprietary. All exam names and trademarks belong to their respective owners.
Study material is provided for educational purposes only.