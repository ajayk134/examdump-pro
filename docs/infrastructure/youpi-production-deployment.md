# YouPI-PG V2 — Production Deployment Record

Deployed 2026-11-13. This is the authoritative record of what runs in production and how
to operate or revert it.

## Status

| Property | Value |
| --- | --- |
| Deployment state | **DEPLOYED** |
| Public entry point | `https://examdumppay.duckdns.org` — **LIVE** |
| Real-money processing | **DISABLED** — no payment provider or Gmail OAuth credentials configured |
| Container | `youpi-pg` |
| Image | `localhost/youpi-pg:prod` (`e229c7019b0a`) |
| Source | `youpi-pg/YouPI-PG` @ `405327c` + local hardening commit `159b7aa` |
| User | `youpi` (uid 1001, non-root) |
| Restart policy | `unless-stopped` |
| Published ports | **none** (`PortBindings={}`) |

## Network identity (do not change)

```
--network youpi-net:ip=10.90.0.2,mac=02:59:4f:11:00:02 --network-alias youpi-app
```

The MAC pin is mandatory. Podman otherwise assigns a random MAC on every recreation;
nginx has no `NET_ADMIN` and cannot flush its ARP cache, so it keeps sending to the dead
MAC and connectivity fails intermittently (measured: 3 of 5 unpinned recreations failed).
With the MAC pinned, recreation is instant and reliable.

## Isolation

`inet youpi_guard` (priority `-10`, unit `youpi-guard.service`) enforces:

```
ip saddr 10.89.0.0/24 ip daddr 10.90.0.0/24 drop
ip saddr 10.90.0.0/24 ip daddr 10.89.0.0/24 ct state new drop
ct state established,related accept
```

nginx reaches YouPI because `10.90.0.254 → 10.90.0.2` stays within one bridge and never
traverses FORWARD. ExamDump containers cannot initiate into `10.90.0.0/24`, and YouPI
cannot initiate back.

Verified matrix (probe: `nc -z`; note `sh` has no `/dev/tcp`, which produces false
"BLOCKED" results — do not use the bash `/dev/tcp` idiom in these containers):

| Path | Result |
| --- | --- |
| api → youpi:6100 | BLOCKED |
| web → youpi:6100 | BLOCKED |
| postgres → youpi:6100 | BLOCKED |
| youpi → api:4000 | BLOCKED |
| youpi → pg:5432 | BLOCKED |
| nginx → youpi:6100 | OPEN |
| nginx → api:4000 | OPEN |

## nginx

`examdumppay.duckdns.org` (dedicated cert, valid Nov 13 2026 → Feb 11 2027):

- `/api/` → `10.90.0.2:6100`
- `/health` → `10.90.0.2:6100/health`
- `/` → `10.90.0.2:7000` (checkout portal)

Only 80 and 443 are public. Ports 5000/6001/6002/6003/6100/7000/8090 are unreachable
from outside and unverified by DNS name.

## Secrets

Generated into Doppler `youpi-pg` / `prd`: `ENCRYPTION_MASTER_KEY`, `JWT_SECRET`,
`ADMIN_API_TOKEN`, `OBSERVER_API_TOKEN`, `INTERNAL_SERVICE_TOKEN`,
`DEVICE_CREDENTIAL_KEY`, `BLIND_INDEX_KEY`, `COIN_STORE_WEBHOOK_SECRET`,
`ANDROID_ENROLLMENT_SECRET`.

The app also self-generates any missing secret into `/app/data/.secrets/` at `0700`
with `0600` files — verified on the host volume.

**Never reuse the demo values from the historical `.env.production`** (`0123…`, `demo…`,
`1710…`). They are published and effectively public.

## Data and backups

| Item | Location |
| --- | --- |
| SQLite state | `/var/lib/youpi-data/youpi_pg.sqlite` |
| Secrets | `/var/lib/youpi-data/.secrets/` (0700) |
| Nightly backups | `/var/lib/youpi-backups/`, 14-day retention, cron `/etc/cron.d/youpi-backup` |
| Backup script | `/usr/local/bin/youpi-backup.sh` |

Backups were verified as real SQLite (`SQLite format 3` header) and readable inside the
container.

## Recreate

```bash
sudo podman rm -f youpi-pg
sudo podman run -d --name youpi-pg \
  --network youpi-net:ip=10.90.0.2,mac=02:59:4f:11:00:02 \
  --network-alias youpi-app \
  -e NODE_ENV=production -e YOUPI_MODE=localhost -e YOUPI_ALLOW_LOCALHOST_MODE=true \
  -e YOUPI_BIND_HOST=0.0.0.0 -e USE_SQLITE_FALLBACK=true \
  -e SQLITE_DB_PATH=/app/data/youpi_pg.sqlite \
  -e PAYMENT_API_PORT=6100 -e CHECKOUT_PORTAL_PORT=7000 -e MERCHANT_ADMIN_PORT=6001 \
  -e GMAIL_OBSERVER_PORT=6003 -e SMS_OBSERVER_PORT=6002 \
  -e COIN_WALLET_STORE_PORT=5000 -e CONTROL_CENTER_PORT=8090 \
  -e BASE_PAYMENT_API_URL=http://127.0.0.1:6100 -e BASE_CHECKOUT_URL=http://127.0.0.1:7000 \
  -e BASE_ADMIN_URL=http://127.0.0.1:6001 -e YOUPI_ALLOW_DEV_TOOLS=false \
  -v /var/lib/youpi-data:/app/data:Z \
  --security-opt no-new-privileges:true --cap-drop ALL --cap-add NET_BIND_SERVICE \
  --memory 1g --pids-limit 512 --restart unless-stopped \
  youpi-pg:prod
```

## Rollback

```bash
# 1. Revert the payment vhost to maintenance (503)
sudo cp /etc/nginx-examdump/nginx.conf.pre-youpi-20261113T215944Z \
        /etc/nginx-examdump/nginx.conf
sudo podman exec examdump-pro_nginx_1 nginx -t
sudo podman exec examdump-pro_nginx_1 nginx -s reload

# 2. Stop and remove only YouPI
sudo podman stop youpi-pg && sudo podman rm youpi-pg

# 3. Keep data for investigation - do NOT delete
#    /var/lib/youpi-data, /var/lib/youpi-backups
```

ExamDump never depends on YouPI, so steps 1–2 alone restore the pre-deployment state.
Rehearsed against a copy of the config (0 YouPI references, 503 present).

Pre-deployment snapshot: `/var/lib/youpi-deploy-backup-20261113T215746Z`
(containers, images, nftables rules, nginx config).

## Known limitations

- **No real-money processing.** No payment provider credentials, no Gmail OAuth client,
  no bank/SMS observer enrolled. The gateway is up but cannot confirm a real payment.
- **Gmail observer unconfigured.** Port 6003 listens; no OAuth client credentials are
  present, so no mailbox is polled.
- **`YOUPI_MODE=localhost`.** Upstream requires a Cloudflare domain for full production
  mode; this deployment is fronted by nginx instead and says so honestly.
- **Host can reach `10.90.0.2`.** The guard filters forwarded traffic between bridges; the
  host is not a forwarding path. The host is root-controlled, so this is not an
  escalation, but it is not the same boundary as container-to-container isolation.
- **Webhook egress is not allow-listed.** URL validation and pre-delivery DNS checks are
  in place; a deny-by-default egress policy is still outstanding.
