# 0005: One Organization per Public-Release Instance

Status: Accepted
Date: 2026-10-04

## Context

Dikho is being built first for Dikho Global Media LLP. The longer-term goal is
to make the product useful to small businesses that can add their identity,
host the application, connect their database and configure their own provider
accounts.

Supporting unrelated organizations inside one shared deployment would require
tenant-aware identity, data isolation, billing, operations and support-access
controls that the current trusted-team architecture does not provide.

## Decision

The first public distribution will support one organization per independently
configured and hosted instance.

Brand identity, public settings, server bindings and provider integrations will
be configurable. Authorization and data-integrity controls remain shared core
logic and cannot be weakened by branding or deployment options.

## Consequences

- Each adopter owns its database, storage, hosting and provider accounts.
- Instance isolation does not remove the need for staff roles within an
  organization.
- Setup, migration, backup, upgrade and secret-management documentation become
  part of the product.
- Shared multi-tenant SaaS hosting remains a separate future decision.
- Brand-specific values must gradually move out of feature logic and into a
  validated configuration layer.

## Alternatives considered

- **Shared multi-tenant SaaS now:** rejected because the current schema and
  authorization model do not provide tenant isolation.
- **Permanent private bespoke system:** rejected because it does not meet the
  intended goal of helping other small businesses reuse the platform.
- **A separate code fork for every organization:** rejected because forks make
  security updates and upgrades difficult to distribute reliably.

## Verification

- Setup documentation describes an isolated deployment.
- A clean installation can be branded and configured without editing
  authorization logic.
- Tests prove role boundaries inside one organization.
- No documentation claims shared-database tenant isolation.
