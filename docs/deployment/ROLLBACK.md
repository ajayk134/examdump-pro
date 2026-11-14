# Rollback

There is **no automated down-migration.** Rolling back means one of two things,
in order of preference.

## 1. Redeploy the previous commit (preferred)

Because migrations are additive, older code usually runs fine against a newer
schema — new nullable columns are simply ignored.

```bash
cd ~/projects/examdump-pro
git log --oneline -5                 # find the last known-good commit
git checkout <previous-commit>

export NVM_DIR=~/.nvm && . ~/.nvm/nvm.sh && nvm use 22
npm run build -w @examdump/shared
npm run build -w @examdump/data-client
npm run build -w @examdump/api
npm run build -w @examdump/web

sudo rm -rf /opt/examdump-pro/api/dist
sudo cp -r apps/api/dist /opt/examdump-pro/api/dist
sudo chown -R examdump:examdump /opt/examdump-pro/api
sudo systemctl restart examdump-api
```

For the frontend, rebuild `apps/web` and repeat the standalone copy steps in
[DEPLOYMENT](../DEPLOYMENT.md), then `sudo systemctl restart examdump-web`.

Verify:

```bash
curl -s http://127.0.0.1:4000/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://examtopicspro.duckdns.org/
```

## 2. Restore the database

Only when a migration is destructive or data was lost. This discards everything
since the backup.

```bash
sudo systemctl stop examdump-api examdump-web
sudo -u postgres dropdb examdump
sudo -u postgres createdb -O examdump examdump
cat /var/backups/examdump/<file>.pgdump \
  | sudo -u postgres pg_restore -d examdump --no-owner --no-privileges
sudo systemctl start examdump-api examdump-web
```

## Taking the application out of service

```bash
sudo systemctl stop examdump-api examdump-web   # frontend returns 502 from nginx
```

nginx stays up so the TLS certificate and ACME renewal keep working.
