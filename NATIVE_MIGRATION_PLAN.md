# Native Migration Plan — ExamDump Pro off Podman

Decision record for moving ExamDump Pro from rootful Podman containers to
native systemd services on `meshcentral` (Oracle Linux 9.8, aarch64, 2 vCPU,
10 GiB RAM, kernel 6.12.0 UEK).

The inventory in §1 is the pre-migration snapshot the plan was written from.
**The migration is complete for ExamDump**: the API, web app, nginx and
PostgreSQL run as systemd units, no ExamDump container remains, and the
rootful Podman store is empty. Sections that described work as forthcoming are
kept as a record of what was done; §1.3, §1.4, §1.7 and §6 note where the
deployed state differs. This file is documentation only — it is not an
operator runbook. [DEPLOYMENT.md](DEPLOYMENT.md) holds current instructions.

---

## 1. Inventory and classification

### 1.1 Containers

| Container | Store | Image | Classification |
|---|---|---|---|
| `examdump-pro_nginx_1` | rootful | nginx:1.27-alpine | **Required — public access** (becomes host nginx) |
| `examdump-pro_api_1` | rootful | localhost/examdump-pro_api | **Required — backend** (becomes systemd unit) |
| `examdump-pro_web_1` | rootful | localhost/examdump-pro_web | **Required — frontend** (becomes systemd unit) |
| `examdump-pro_postgres_1` | rootful | postgres:16-alpine (16.15) | **Required — database** (becomes native PG16) |
| `youpi` *(removed earlier)* | — | — | already gone |
| `omniroute`, `omniroute-redis` | **rootless** | omniroute, redis:8.6.5 | **OUT OF SCOPE — preserves Podman rootless** |

**Critical finding:** `omniroute` and `omniroute-redis` run in `opc`'s *rootless*
Podman store (5.9 GB in `/home/opc/.local/share/containers`), while ExamDump uses
the *rootful* store (2.3 GB in `/var/lib/containers`). These are two independent
installations of the same RPM. Rule 12 says preserve unrelated applications, so
**the Podman packages can only be removed if omniroute is migrated or retired.**
This is the single decision that blocks the "no Podman" acceptance criterion —
see §6.

### 1.2 Host services

| Service | Classification |
|---|---|
| `sshd` | **Required — access** |
| `firewalld` | **Required — public access** |
| `crond` | **Required — backup job** |
| `chronyd`, `rsyslog`, `systemd-journald`, `systemd-logind`, `systemd-udevd`, `dbus-broker`, `polkit`, `NetworkManager` | **Required — base OS** |
| `certbot-renew.timer` | **Required — TLS renewal** (needs host nginx webroot) |
| `auditd`, `tuned`, `irqbalance`, `gssproxy`, `iscsid`, `libstoragemgmt`, `rpcbind`, `atd`, `rtkit-daemon`, `upower`, `dtprobed` | Unnecessary for ExamDump — **leave alone** (OS defaults, zero cost, out of scope) |
| `fail2ban` | **Unnecessary for ExamDump** — security hardening, keep unless you say otherwise |
| `xrdp`, `xrdp-sesman` | Unnecessary — remote desktop, unrelated |
| `pmcd`, `pmie`, `pmlogger`, `pmie_farm`, `pmlogger_farm` | **Monitoring stack — unnecessary** (OS Performance Co-Pilot) |
| `unified-monitoring-agent` + `_config_downloader.timer` | **Monitoring stack — unnecessary** (Oracle Cloud agent) |
| `oracle-cloud-agent`, `oracle-cloud-agent-updater` | OCI instance management — unrelated, keep |
| `user@1000`, `user@988` | Session managers for running agents — keep |

### 1.3 Podman packages (all removable, schedule-dependent)

`podman`, `podman-compose`, `podman-docker`, `containers-common`, `conmon`,
`crun`, `netavark`, `aardvark-dns`, `libslirp`, `slirp4netns`.
`buildah` and `skopeo` are **not installed**. `/usr/bin/docker` is the
`podman-docker` shim, not a Docker daemon — there is no Docker engine here.

### 1.4 Images / volumes / networks — pre-migration snapshot

These ExamDump images, the `pgdata` volume and the `examdump-pro_examdump`
network have since been removed; the rootful store is now ~1.4 MB and holds no
ExamDump objects. Retained here to explain what the migration stage sizes
referred to (see §7).

| Resource | Size | Classification |
|---|---|---|
| `localhost/examdump-pro_api:latest` | 534 MB | Required until native API verified |
| `localhost/examdump-pro_web:latest` | 232 MB | Required until native web verified |
| `localhost/examdump-pro_web:rollback-*` | 232 MB | Rollback point — keep until native verified |
| `postgres:16-alpine`, `nginx:1.27-alpine`, `node:22-alpine`, `node:24-alpine` | 679 MB | Base images — removable after migration |
| Volume `pgdata` | 69 MB | **Production data** — source for pg_dump |
| Network `examdump-pro_examdump` | — | Removable after migration |

### 1.5 Duplicates / test / staging / unused

- **None remain.** Prior cleanup removed `examdump-pg-test`, `examdump_test`,
  orphaned volumes, duplicate clones and all YouPI artefacts.
- `/var/lib/examdump-backup/orphan_pgdata_20261113.dump` (412 KB) — dump of a
  removed cluster, not production. **Unnecessary** — removable once a fresh
  verified backup exists.
- `/usr/local/bin/examdump-compose` (214 B) — wrapper for the Podman stack.
  **Obsolete after migration**; it no longer exists on the host.
- `hiredis` RPM — unused by ExamDump (no Redis). Leave: OS-level dependency.

### 1.6 Data and backups (preserved)

- Database `examdump`: 14 MB, 54 public relations, 19 users, 5 plans,
  1883 catalog exams, 0 payments.
- `/var/backups/examdump/` — 5 nightly dumps, newest
  `examdump_20261114T023001Z.pgdump` (418 KB), 02:30 cron, 14-day retention.
- `/var/lib/examdump-backup/examdump_backup_20261113T175129Z.dump` (413 KB).
- Secrets: Doppler `examdump-pro` / `prd` only.
- `PAYMENTS_ENABLED=false`, `UPI_AUTO_APPROVE=false` — unchanged throughout.

### 1.7 Already on the host (reused, nothing to install for nginx)

Recorded at plan time:

- `nginx-1.20.1` RPM was **installed, disabled and inactive**, with a stock
  `/etc/nginx/nginx.conf` and no ExamDump vhost. Host nginx now runs from
  `/etc/nginx/conf.d/examdump.conf` with upstreams `127.0.0.1:4000` and
  `127.0.0.1:3000`.
- Node **v24.22.1** via nvm for `opc`. Runtime parity target is Node 22 — the
  deployed runtime is `/opt/examdump-pro/node/bin/node` at **v22.23.5**.
- PostgreSQL 16 is an AppStream module (`postgresql:16`, server profile) —
  same major as the container's 16.15. The running server is **16.15**.

---

## 2. Target architecture

```
Internet :80/:443  ──  firewalld (http, https, ssh)
                          │
                    nginx (host, systemd)          ← was the nginx container
                          │  127.0.0.1:4000 / :3000
          ┌───────────────┴───────────────┐
          ▼                               ▼
  examdump-api.service            examdump-web.service
  node dist/index.js :4000        next start :3000
  (User=examdump)                 (User=examdump)
          │
          ▼
  postgresql-16.service  :5432  (User=postgres)
  /var/lib/pgsql/16/data · db examdump
```

- Internet-facing: nginx only. API/web bind `127.0.0.1` — no public exposure.
- One frontend, one backend, one database. No containers.
- Existing `examtopicspro.duckdns.org` cert, DNS and firewalld rules reused.
- Doppler supplies env to all three units via `EnvironmentFile` generated at
  deploy time (or `doppler run`); no secrets written into the repo.

---

## 3. Migration stages (each verified before the next)

### Stage 0 — Pre-flight (no changes)
1. Fresh verified backup: `pg_dump` to `/var/backups/examdump/pre-native-<ts>.dump`.
2. Restore-test that dump into a throwaway PG cluster; confirm 19 users /
   1883 exams. **This satisfies "never delete backups before verifying a
   replacement backup and restore".**
3. Record current image IDs and `podman ps` output for rollback reference.

### Stage 1 — Native PostgreSQL 16 (additive, production untouched)
1. `dnf module enable postgresql:16`, install `postgresql-server` + `postgresql`.
2. `postgresql-setup --initdb`.
3. Create role `examdump` and database `examdump`.
4. Restore from the verified Stage-0 dump.
5. Verify row counts match the container exactly.
6. `systemctl enable --now postgresql-16`.
   *Container PG keeps running on its internal network — no conflict, it has no
   published port.*

### Stage 2 — Native API (additive)
1. Build `apps/api` with Node 22 (nvm install 22; matches image).
2. `npm ci --omit=dev` for runtime deps, copy `dist/` and `migrations/`.
3. Create system user `examdump`; deploy to `/opt/examdump-pro/api`.
4. `examdump-api.service` on `127.0.0.1:4000`, `DATABASE_URL` → host PG.
5. `node dist/migrate.js` (idempotent — schema already at head).
6. Verify `/api/health` returns `database: connected` and 19 users.

### Stage 3 — Native frontend (additive)
1. `next build` (standalone output already configured).
2. Deploy to `/opt/examdump-pro/web`.
3. `examdump-web.service` on `127.0.0.1:3000`.
4. Verify it serves HTML and reaches the native API.

### Stage 4 — Native nginx (public cutover)
1. Enable host nginx; write `/etc/nginx/conf.d/examdump.conf` from the current
   vhost with upstreams changed to `127.0.0.1:4000` / `127.0.0.1:3000`.
2. Keep `/var/www/certbot` webroot and the `examtopicspro` cert paths identical,
   so `certbot-renew.timer` keeps working.
3. Free ports 80/443 by stopping **only** the nginx container.
4. `nginx -t && systemctl start nginx`.
5. Verify HTTPS 200, API health, `certbot renew --dry-run`.

### Stage 5 — Decommission containers (only after Stages 1–4 verified)
1. Stop and remove api, web, postgres containers, then the nginx container's
   image remains as rollback.
2. Retain the rollback image and the pgdata volume for 7 days.

### Stage 6 — Remove Podman and leftovers — **blocked by §6**
1. `dnf remove podman podman-compose podman-docker containers-common conmon
   crun netavark aardvark-dns` (only possible once omniroute is handled).
2. Remove `/var/lib/containers` (2.3 GB), base images, network, `pgdata`
   volume, `examdump-compose`.
3. Remove monitoring stack: `pmcd/pmie/pmlogger*`,
   `unified-monitoring-agent`, `xrdp` — **only if you confirm**.
4. Update `docs/DEPLOYMENT.md`, `docs/deployment/*`, `ARCHITECTURE.md`,
   `CODEBASE_MAP.md`, `deploy/*` to describe native units; remove container-only
   files. Documentation only — no Git history change.

### Stage 7 — Final acceptance verification
1 frontend, 1 backend, 1 database · no Docker · no Podman · no test/staging DBs ·
website + API healthy · 19 users and 1883 exams intact ·
`PAYMENTS_ENABLED=false`.

---

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Data loss during PG migration | Verified restore into a throwaway cluster before touching production; original volume kept 7 days |
| Public downtime at cutover | Only the nginx container is restarted, config pre-validated with `nginx -t`; rollback = start container again |
| ACME renewal breakage | Webroot and cert paths unchanged; `certbot renew --dry-run` in Stage 4 |
| Node version drift (22 vs 24) | Install Node 22 to match images exactly |
| Secrets exposure | Env injected by Doppler at runtime; nothing written to repo or world-readable files |
| Removing Podman breaks omniroute | Podman removal deferred until omniroute decision (§6) |
| Certificates of unrelated hosts | Only `examtopicspro` vhost added; `agentdump` untouched |

---

## 5. What will NOT change

`examtopicspro.duckdns.org`, its DNS, certificate and firewalld rules; Doppler
`examdump-pro/prd`; database `examdump` and all data; all 5 nightly backups and
the 02:30 cron; `PAYMENTS_ENABLED=false`; `UPI_AUTO_APPROVE=false`; Git history;
`omniroute`/`omniroute-redis`, `/opt/meshcentral`, `/opt/rh`,
`/opt/unified-monitoring-agent` (unless separately approved), `online-clipboard`,
`telegram-ai-assistant`, `REA`, `mesh`, and `agentdump.duckdns.org`.

---

## 6. Two decisions needed before Stage 6

**A. `omniroute` (rootless Podman, unrelated app).** It is the *only* thing that
prevents uninstalling the Podman packages. **Outcome: resolved by keeping
rootless Podman.** `omniroute` and `omniroute-redis` still run from `opc`'s
rootless store (~5.9 GB); all ExamDump container storage was removed instead.
ExamDump is fully native, but the "no Podman on the host" acceptance criterion
in §3 Stage 7 is **not met**. The options considered were:
- *Migrate it to native Node* — pro: Podman fully removed; con: extra work, it
  needs its Redis container too.
- *Leave it running* — pro: zero risk to an unrelated app; con: **fails "no
  Podman"**, though ExamDump itself would be fully native.
- *Retire it* — pro: simplest; con: deletes an app you may still use.
Recommendation: leave Podman's rootless install but remove all ExamDump
container storage, then revisit — this keeps rule 12 intact.

**B. Monitoring stack** (`pmcd/pmie/pmlogger×4`, `unified-monitoring-agent`,
`xrdp`). Safe to remove and saves idle CPU/RAM. Confirm before Stage 6.
**Status: still open** — not removed.

---

## 7. Expected savings

- Disk: ~2.3 GB container storage + ~2.2 GB images reclaimed
- RAM: container + monitoring overhead (~300–500 MB)
- Services: 4 containers and 9 monitoring units → 5 systemd units
  (`nginx`, `postgresql-16`, `examdump-api`, `examdump-web`, `certbot-renew`)

Realised for ExamDump: the container storage and image savings, and 4 containers
replaced by `examdump-api.service` + `examdump-web.service` behind host `nginx`
with native `postgresql.service`. Not realised: the monitoring units, and the
Podman packages themselves (see §6A).
