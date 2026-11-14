# Infrastructure performance

Single Oracle Cloud VM running four containers under rootful Podman, fronted by
nginx.

## Topology and limits

| Container | Image | Notes |
| --- | --- | --- |
| `nginx` | `nginx:1.27-alpine` | owns :80/:443, only public surface |
| `web` | Node 22 alpine, standalone | internal :3000 |
| `api` | Node 22 alpine | internal :4000, also runs workers |
| `postgres` | postgres:16-alpine | internal :5432 |

No memory or CPU limits are set on the systemd units. On a small VM this
means one runaway container can starve the others. Adding `--memory` /
`--cpus` limits is a reasonable hardening step once real usage is known.

## Nginx

Relevant configuration in `deploy/nginx/nginx.conf`:

```nginx
upstream examdump_api { server api:4000; keepalive 32; }
upstream examdump_web { server web:3000; keepalive 32; }

gzip on;
gzip_types text/plain text/css application/json application/javascript
           application/xml image/svg+xml;
gzip_min_length 1024;
gzip_proxied off;

client_max_body_size 2m;
ssl_session_cache shared:SSL:10m;
```

Observations:

- **`keepalive 32`** per upstream — upstream connections are reused, which is the
  single biggest nginx→Node win available here.
- **`gzip_proxied off`** means responses proxied from the app are **not**
  compressed. Enable it if the API returns large JSON; it is currently off, so
  verbose list endpoints travel uncompressed.
- **`gzip_types` excludes `text/html`** only because nginx always compresses HTML.
- SSE is deliberately not buffered or compressed (comments in the file explain
  why) — AI streaming depends on it.

### The IP caching caveat

nginx resolves `server api:4000` **once at startup**. When the API container is
recreated it gets a new IP and nginx keeps the stale one, returning 502 while the
API is healthy. Always:

```bash
sudo systemctl reload nginx
```

A more robust alternative is a `resolver` directive with `proxy_pass` to a
variable, which forces re-resolution. Not currently implemented.

## Static assets

Next.js serves hashed immutable assets itself; nginx proxies them through. No
explicit `expires` rule for `/_next/static` is configured, so browser caching
relies on Next's own headers. Adding an immutable cache header there is a cheap
win if asset traffic grows.

## Postgres

Runs in the same container network, so traffic is loopback-speed. No tuning is
applied; see [Database performance](DATABASE.md).

Backups use `deploy/backup.sh` (pg_dump custom format). Restore procedure:
[Backup and restore](../deployment/BACKUP_RESTORE.md).

## Health checks

| Target | Method |
| --- | --- |
| API | `GET /api/health` → status + database connectivity + uptime |
| Postgres | `pg_isready` healthcheck in compose |
| Containers | `restart: unless-stopped` |

There is no external uptime monitor configured in this repository. If the host
dies, nothing alerts — this is a real operational gap.

## Logging

- API: Pino JSON to stdout, captured by Podman (`json-file`, `max-size: 10m`,
  `max-file: 5` per service).
- nginx: access and error logs to its own container logs.

Log rotation is bounded by the compose `logging` options; without them, container
logs grow until the disk fills. Do not remove those options.

## Build optimisation

Dockerfiles are multi-stage (builder → runner), so dev dependencies and source
TypeScript are not in the final image. The web image uses Next's `standalone`
output. Builds are cached by layer; changing `package.json` invalidates the
install layer for both images.

## Related

- [Backend](BACKEND.md)
- [Performance budgets](PERFORMANCE_BUDGETS.md)
- [Production deployment](../deployment/PRODUCTION.md)
- [Monitoring](../operations/MONITORING.md)
