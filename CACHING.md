# Caching

There is exactly **one** cache in this system. This document explains why, and why
there is no Redis.

## The dataset cache

`packages/data-client/src/cache.ts` — `TtlCache<T>`: TTL **and** LRU eviction.

| Property | Value |
| --- | --- |
| TTL | `DATASET_CACHE_TTL_SECONDS` (default 300 s) |
| Max entries | 400 (constructor default) |
| Scope | **in-process** |
| Key | `${branch}:${relativePath}` |

It caches raw dataset files fetched from GitHub, which is the slowest external call
in the request path.

Consequences:

- Each API instance has its own cache; they disagree until TTL expiry.
- A restart starts cold — the first request per exam is slower.
- Content updates appear within the TTL, or immediately after `clearCache()`.

## What is not cached

| Thing | Why not |
| --- | --- |
| HTTP responses | no response cache; the API is dynamic and per-user |
| Settings, RBAC | small indexed queries; a cache would add invalidation complexity for little gain |
| Sessions | security — revocation must be immediate |
| Question slices | derived per user from entitlement; caching would risk serving a premium slice to a free user |
| Database query results | no query cache exists |

## Why no Redis

[ADR-002](docs/decisions/ADR-002.md): the queue is PostgreSQL-backed and the only
shared cache need is the dataset, which is per-process and cheap to rebuild. Adding
Redis would add a service, a credential and a failure mode for no current benefit.

**Scaling caveat:** rate limiting is also in-memory
(`@fastify/rate-limit` default store), so limits are per process. With more than one
API instance, effective limits multiply. Shared state would be needed at that point.

## Invalidation

- Dataset: TTL, or `clearCache()` (called after a dataset sync).
- Nothing else is cached, so nothing else needs invalidating.

## Related

- [ADR-002](docs/decisions/ADR-002.md)
- [Backend performance](docs/performance/BACKEND.md)
- [Background jobs](BACKGROUND_JOBS.md)
