# Architecture decision records

Decisions that shaped this system, with the reasoning that survives the code.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **Accepted** | in force today |
| **Superseded** | replaced by a later ADR |
| **Deprecated** | still true but being phased out |
| **Proposed** | under consideration, not implemented |

## Honesty note

These ADRs were **written retrospectively** on 2026-11-12. Each records a decision
that is already implemented in the codebase; none is a fabricated history. Where
the original reasoning is not recoverable, the ADR states the *current* rationale
and is labelled as reconstructed.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [001](ADR-001.md) | Exam content in GitHub, not PostgreSQL | Accepted |
| [002](ADR-002.md) | PostgreSQL-only queue, no Redis | Accepted |
| [003](ADR-003.md) | UPI collection via unique amounts and notification matching | Accepted |
| [004](ADR-004.md) | Opaque rotating refresh tokens alongside JWT access tokens | Accepted |
| [005](ADR-005.md) | Single host, rootful Podman, no orchestration | Accepted |

## Adding an ADR

1. Copy the structure of an existing one.
2. Number it sequentially.
3. Never edit an accepted ADR's decision — supersede it with a new one and update
   both statuses.
4. Add it to the index above.
