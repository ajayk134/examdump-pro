# Authorization

Two independent systems: **RBAC** (what an admin may do) and **entitlement**
(what a paying user may see). They must not be confused.

## RBAC — staff capability

Implemented in `apps/api/src/services/rbac.service.ts`, tables `roles`,
`permissions`, `role_permissions`, `user_roles`.

### Seeded roles

| Role | Permissions |
| --- | --- |
| **Administrator** | all 23 |
| **Billing** | `coupons.manage`, `grants.manage`, `payments.read`, `payments.refund`, `plans.manage`, `reports.read`, `subscriptions.read`, `subscriptions.write`, `users.read` |
| **Content** | `analytics.read`, `dataset.sync`, `exams.manage`, `system.health` |
| **Support** | `audit.read`, `payments.read`, `subscriptions.read`, `system.health`, `users.read` |
| **Learner** | none — the default role for end users |

### Permissions

```
analytics.read   audit.export     audit.read       coupons.manage
dataset.sync     email_templates.manage            exams.manage
feature_flags.manage              grants.manage    notifications.send
payments.manage  payments.read    payments.refund  plans.manage
reports.read     roles.manage     settings.manage  subscriptions.read
subscriptions.write               system.health    users.delete
users.read       users.write
```

Verify against the live database:

```bash
sudo podman exec examdump-pro_postgres_1 psql -U examdump -d examdump -c "
select r.name, string_agg(rp.permission_id, ', ' order by rp.permission_id)
from roles r join role_permissions rp on rp.role_id = r.id
group by r.name order by 1;"
```

### Enforcement

| Guard | Use |
| --- | --- |
| `requireAdmin` | coarse: any Administrator |
| `requirePermission(p)` | precise: a specific capability |

Prefer `requirePermission` for new admin routes — a Billing operator should not
be able to edit roles just because both are "admin" routes.

No admin route relies on the coarse guard any more. The admin UPI surface is now
split by capability, so a role that reviews payments cannot move money:

| Route | Permission |
| --- | --- |
| `GET /admin-ops/upi/overview` | `payments.read` |
| `GET /admin-ops/upi/orders`, `/orders/:id` | `payments.read` |
| `GET /admin-ops/upi/notifications`, `/refunds` | `payments.read` |
| `POST /admin-ops/upi/notifications/:id/match` | `payments.manage` |
| `POST /admin-ops/upi/observer/poll` | `payments.manage` |
| `POST /admin-ops/upi/orders/:id/refund` | `payments.refund` |
| `POST /admin-ops/upi/refunds/:id/complete` | `payments.refund` |

Covered by `apps/api/test/admin-upi-authz.test.ts`.

`getUserPermissions()` caches the resolved set per request context; do not
re-query inside a handler loop.

### Gaps to be aware of

- Permissions are resolved per request from the database. Revoking a role takes
  effect on the next request, not instantly for an in-flight session — acceptable,
  but it means there is no instant kill switch short of revoking sessions.
- `users.delete` is a hard capability. It should always be paired with audit
  logging; verify that before relying on it.

## Entitlement — what a user may access

Implemented in `apps/api/src/services/entitlement.service.ts`. Distinct from RBAC:
an Administrator is not automatically a premium subscriber, and a premium
subscriber has no staff permissions.

```
resolveEntitlements(user)
   → plan from subscriptions (active, unexpired)
   → grants from access_grants (per exam_key)
   → limits from settings (free/premium question caps, AI caps)
```

| Tier | Questions per exam | AI | Exams |
| --- | --- | --- | --- |
| Free | `FREE_QUESTIONS_PER_EXAM` (5) | none (`AI_DAILY_LIMIT_FREE=0`) | all, limited |
| Premium | full set, paced by `PREMIUM_DAILY_QUESTION_LIMIT` | `AI_DAILY_LIMIT_PREMIUM`/day | per grant |

Critical rule: **entitlement is always evaluated server-side.** The UI may hide
controls, but hiding is cosmetic. Any new endpoint returning question content
must call `resolveEntitlements` (via the exams/dataset service) rather than
reading the dataset directly.

### Per-exam grants

`access_grants` holds `(user_id, exam_key, subscription_id, revoked_at)`. A
subscription may grant one exam or all exams; the check is a single indexed
lookup on the hot path.

## Customer data isolation

There is no multi-tenant boundary — every user shares one database. Isolation is
therefore enforced by **query scoping**, and this is the highest-risk area of the
codebase:

- Every user-owned table has a `user_id` column and an index leading with it.
- Every query must filter by the authenticated user id taken from
  `AuthContext`, never from a request parameter.
- Admin routes that read other users' data must require a permission and write
  an `audit_logs` entry.

A route that accepts a `userId` from the client instead of the session is a
privilege-escalation bug. When reviewing code, grep for `userId` coming from
`request.params` / `request.query` on user-scoped tables.

## Related

- [Authentication](AUTHENTICATION.md)
- [Threat model](THREAT_MODEL.md)
- [API](../../API.md)
