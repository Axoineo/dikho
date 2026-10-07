# Architectural Decision Records

ADRs record durable decisions that future maintainers and coding agents should
not repeatedly rediscover.

## Format

Create the next zero-padded number:

```md
# NNNN: Decision title

Status: Proposed | Accepted | Superseded
Date: YYYY-MM-DD

## Context

What forced a decision and which constraints matter?

## Decision

What was chosen?

## Consequences

What becomes easier, harder or operationally important?

## Alternatives considered

Which credible alternatives were rejected and why?

## Verification

How do we know the decision remains correctly implemented?

## Superseded by

Link to a later ADR when applicable.
```

Do not rewrite the rationale of an accepted ADR to match later preferences.
Create a superseding ADR so the decision history remains understandable.

## Index

- [0001: Separate SPA hosting from the API Worker](0001-separate-spa-hosting-and-api-worker.md)
- [0002: Verified server path for public database writes](0002-verified-public-writes.md)
- [0003: D1 and R2 for WhatsApp operations](0003-whatsapp-d1-r2.md)
- [0004: Hard global budgets for public paid operations](0004-global-budgets.md)
- [0005: One organization per public-release instance](0005-one-organization-per-instance.md)
- [0006: Staff membership in Supabase app_metadata](0006-staff-membership-in-app-metadata.md) (role list superseded by 0007)
- [0007: User Management with per-action permissions](0007-user-management-and-permissions.md)
- [0008: Live Assist by consented tab sharing](0008-live-assist.md)
