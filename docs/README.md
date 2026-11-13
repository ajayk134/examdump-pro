# Documentation

Start here. Everything is organised by what you are trying to do.

> **Rule for all contributors and AI agents:** when code changes, update the docs
> that describe it *in the same commit*. See [CONTRIBUTING.md](../CONTRIBUTING.md)
> for the mapping from change type to document.

## I want to…

| Goal | Read |
| --- | --- |
| Understand the system | [architecture/SYSTEM_DESIGN.md](architecture/SYSTEM_DESIGN.md) |
| Run it locally | [../README.md](../README.md) |
| Know which file does what | [../CODEBASE_MAP.md](../CODEBASE_MAP.md) |
| Understand a request's path | [architecture/DATA_FLOW.md](architecture/DATA_FLOW.md) |
| Change the schema | [database/SCHEMA.md](database/SCHEMA.md), [database/MIGRATIONS.md](database/MIGRATIONS.md) |
| Understand auth | [security/AUTHENTICATION.md](security/AUTHENTICATION.md) |
| Check permissions | [security/AUTHORIZATION.md](security/AUTHORIZATION.md) |
| Work on payments | [payments/UPI.md](payments/UPI.md), [payments/PAYMENT_SECURITY.md](payments/PAYMENT_SECURITY.md) |
| Deploy | [deployment/PRODUCTION.md](deployment/PRODUCTION.md) |
| Recover from disaster | [deployment/DISASTER_RECOVERY.md](deployment/DISASTER_RECOVERY.md) |
| Debug production | [operations/TROUBLESHOOTING.md](operations/TROUBLESHOOTING.md) |
| Add a dependency | Check [../DEPENDENCY_MAP.md](../DEPENDENCY_MAP.md) first |
| Use an AI coding agent | [../AGENTS.md](../AGENTS.md), [../.github/copilot-instructions.md](../.github/copilot-instructions.md) |
| Know what is broken | [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md), [../TECH_DEBT.md](../TECH_DEBT.md) |

## Structure

```
docs/
  README.md                    this index
  architecture/                how the system is put together
    SYSTEM_DESIGN.md           topology, process model, invariants
    DATA_FLOW.md               request-by-request data movement
    SERVICE_DEPENDENCIES.md    what calls what
  database/
    SCHEMA.md                  all 52 tables, grouped
    RELATIONSHIPS.md           foreign keys and delete policy
    INDEXES.md                 notable indexes, especially partial uniques
    MIGRATIONS.md              migration policy and the drift hazard
    QUERY_OPTIMIZATION.md      measurement and anti-patterns
  security/
    THREAT_MODEL.md            assets, adversaries, controls, residual risk
    SECURITY_AUDIT.md          current posture and open items
    AUTHENTICATION.md          token model and flows
    AUTHORIZATION.md           RBAC and entitlements
    SECRETS_MANAGEMENT.md      Doppler, rotation, incident steps
  performance/
    FRONTEND.md                rendering, bundles, mobile
    BACKEND.md                 request lifecycle, pooling, workers
    DATABASE.md                transactions, locks, growth
    INFRASTRUCTURE.md          nginx, containers, health
    PERFORMANCE_BUDGETS.md     targets to measure against (no fake numbers)
  deployment/
    PRODUCTION.md              deploy procedure and verification
    BACKUP_RESTORE.md          backup, verify, restore
    ROLLBACK.md                three rollback strategies
    ENVIRONMENT_VARIABLES.md   deployment view of the env reference
    DISASTER_RECOVERY.md       scenarios, RTO, rebuild
  payments/
    UPI.md                     unique amounts, matching, limitations
    PAYMENT_LIFECYCLE.md       both rails, idempotency
    REFUNDS.md                 thresholds and entitlement effects
    RECONCILIATION.md          drift repair
    PAYMENT_SECURITY.md        controls and honest gaps
  testing/
    README.md                  suite composition
    UNIT_TESTING.md            pure logic
    INTEGRATION_TESTING.md     HTTP + real database
    E2E_TESTING.md             does not exist — and what that costs
    CONCURRENCY_TESTING.md     amount collisions, double settlement
  operations/
    MONITORING.md              what is observable, what is not
    LOGGING.md                 Pino, rotation, redaction
    TROUBLESHOOTING.md         symptom-first index
    INCIDENT_RESPONSE.md       severities and containment
  decisions/
    README.md                  ADR index and status vocabulary
    ADR-001.md  content in GitHub, not PostgreSQL
    ADR-002.md  PostgreSQL queue, no Redis
    ADR-003.md  UPI unique amounts + notification matching
    ADR-004.md  JWT access + rotating opaque refresh
    ADR-005.md  single host, rootful Podman
    ADR-006.md  Replace embedded UPI gateway with YouPI-PG V2
  infrastructure/              original design notes (UPI, mail/pay, deliverability)
```

Root-level documents ([README](../README.md), [ARCHITECTURE](../ARCHITECTURE.md),
[SECURITY](../SECURITY.md), …) are summaries that point here for detail. When the
two disagree, **`docs/` is authoritative** — the root files are the entry points.

## Conventions in these docs

- Every claim names the file it comes from, or the command that verifies it.
- Gaps and limitations are stated explicitly rather than omitted.
- No benchmark numbers are invented; unmeasured targets say so.
- Money is always described in **paise**, never floating-point.
- UPI matching is described as **notification-based**, never "bank-verified".
