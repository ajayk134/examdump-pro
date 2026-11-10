# Troubleshooting

## API fails to start with "Invalid environment configuration"

A required variable is missing or malformed. The error lists each problem. The
API requires `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥16 chars) and
`JWT_REFRESH_SECRET` (≥16 chars). In production always inject via Doppler.

## Database connection errors / readiness 503

- Verify `DATABASE_URL` points at a reachable PostgreSQL instance.
- For the bundled compose service, confirm the `postgres` container is healthy
  (`pg_isready`) and `POSTGRES_PASSWORD` matches `DATABASE_URL`.
- For managed databases, allow the VM public IP and set `DATABASE_SSL=true`.
- Ensure migrations have run (`node dist/migrate.js`, or `npm run migrate`).

## Dataset 404 / `DATASET_NOT_FOUND`

- `GITHUB_TOKEN` must be valid and have read access to the private dataset repo.
- Confirm `DATASET_OWNER`, `DATASET_REPO` and `DATASET_BRANCH`.
- The branch must contain `data/index.json` and `data/<provider>/exams.json`.
- Re-run the catalogue sync (admin → Dataset → Sync, or the CLI script).

## `E11000 duplicate key ... googleId`

The unique index must be partial. This repo declares
`{ googleId: { $type: 'string' } }`. If an old database has a conflicting index,
drop it and restart:

```js
db.users.dropIndex('googleId_1')
```

## CORS errors in the browser

`WEB_ORIGIN` must exactly match the browser origin (scheme + host + port), comma
separated for multiple origins. Credentials require an explicit origin, not `*`.

```env
WEB_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
```

## Cookies not being set / user logs out immediately

- In production, `COOKIE_SECURE=true` requires HTTPS.
- Cross-site deployments need `SameSite=None; Secure` (this project is designed
  for same-origin `/api` behind nginx).
- Ensure requests use `credentials: 'include'`.

## Emails not delivered

Configure `SMTP_*`. Without SMTP, emails are logged and — outside production —
verification/reset links are returned in the API response (`devVerificationUrl`,
`devResetUrl`). Never rely on that in production.

## Port already in use

The default web port is 3000 and API 4000. Use another port if occupied:

```bash
npx next start -p 3100        # web
API_PORT=4100 npm run dev:api
```

Oracle VMs may already run other services; do not stop them without approval.

## Next.js: `"next start" does not work with "output: standalone"`

That warning is expected. For local use `next start` still works; for production
run the standalone server (`node apps/web/server.js`) as the Docker image does.

## API tests very slow

Integration tests hit your configured PostgreSQL. On a remote Atlas cluster each
write can take ~1 s. Run a local PostgreSQL (`docker run -p 27017:27017 postgres:16-alpine`) and
set `DATABASE_URL_TEST` for fast runs. CI uses a local PostgreSQL service.

## `npm install` warnings about install scripts (esbuild, mongodb-memory-server)

npm may defer postinstall scripts under newer security defaults. If builds fail,
approve them:

```bash
npm install-scripts approve esbuild mongodb-memory-server
```

## Docker build cannot find `package-lock.json`

Run `npm install` at the repository root first so the lockfile exists, then
rebuild the image.

## Prisma/other? 

This project does not use an ORM other than Drizzle ORM.