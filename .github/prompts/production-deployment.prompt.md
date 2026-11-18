---
description: "Deploy a verified build to the native systemd production host safely"
---

# Production deployment

This workflow changes the live host. Do not start it unless the user explicitly
authorized a production deployment. A normal code task is not deployment
authorization.

## 1. Preconditions

- Confirm the exact commit and branch to deploy.
- Confirm `npm run typecheck` and the relevant tests pass.
- Confirm the worktree is clean and `git fetch` shows the expected commit.
- Identify migrations in the diff. If any exist, confirm a backfill/rollback plan
  and that the database does not need a destructive operation.
- Confirm no payment, gateway, or env-file change is included unless separately
  authorized.
- Confirm the previous `api`/`web` runtime directories are available for rollback.

## 2. Inspect current state (read-only)

```bash
systemctl is-active nginx postgresql examdump-api examdump-web
curl -fsS http://127.0.0.1:4000/api/health/ready
journalctl -u examdump-api -n 50 --no-pager
```

Record the current commit or build id if one is available. Do not restart
anything during inspection.

## 3. Build with the production runtime

Use Node 22, not the local Node 24:

```bash
cd ~/projects/examdump-pro
git fetch origin
git checkout <commit>
NEXT_PUBLIC_API_URL='' npm ci
NEXT_PUBLIC_API_URL='' npm run build
```

## 4. Stage and apply

- Copy API `dist` and migrations to `/opt/examdump-pro/api`.
- Copy Next.js standalone output, static assets, and `public` to
  `/opt/examdump-pro/web`.
- Preserve the previous directory for rollback.
- `chown -R examdump:examdump` on both runtime trees.
- Apply migrations before restarting the API, with
  `MIGRATIONS_DIR=/opt/examdump-pro/api/migrations`. Do not print the env file.

Follow the exact commands in
`.github/instructions/deployment.instructions.md`.

## 5. Restart and verify

```bash
sudo systemctl restart examdump-api
curl -fsS http://127.0.0.1:4000/api/health/ready

sudo systemctl restart examdump-web
curl -fsS -o /dev/null -w '%{http_code}\n' https://examtopicspro.duckdns.org/

systemctl status examdump-api examdump-web --no-pager
journalctl -u examdump-api -n 100 --no-pager
```

Verify the actual change is live (endpoint response, page, log line), not just
that the service is active.

## 6. Rollback

If health or the target behaviour fails:

- restore the previous `dist` or `web` directory;
- restart the affected unit;
- verify health again;
- report the failure and leave the host in the last known-good state.

There is no automated database rollback. Do not drop, restore, or reset the
production database without explicit authorization.

## 7. Report

State the deployed commit, commands run, migration result, health output, public
URL check, and any residual risk or manual follow-up. Never include secret values.
