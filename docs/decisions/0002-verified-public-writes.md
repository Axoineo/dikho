# 0002: Verified Server Path for Public Database Writes

Status: Accepted
Date: 2026-10-04

## Context

Vendor registration and corporate-gifting intake must accept submissions from
visitors without sessions. Direct anonymous table or RPC access lets automated
clients bypass page-level bot protection and write without server validation.

## Decision

Public database submissions go through API Worker routes. The Worker verifies a
single-use Turnstile token, including expected action and hostname, then calls a
narrow security-definer RPC with the service role. Browser-facing roles do not
execute those write RPCs directly.

## Consequences

- Verification failure or missing configuration blocks the write.
- RPCs whitelist columns and assign protected defaults.
- Worker and database-permission rollout order is coupled.
- Turnstile remains bot friction, so separate hard limits are required for
  storage, spend and message volume.
- The current direct anonymous vendor-document upload is an exception and an
  open finding, not part of the accepted target design.

## Alternatives considered

- Direct anonymous inserts with RLS: cannot make page Turnstile verification
  load-bearing.
- Client-only validation: trivially bypassed.
- Requiring user accounts for public leads: conflicts with the intake workflow.

## Verification

- Valid verified submissions succeed.
- Missing, invalid, wrong-action, wrong-hostname and replayed tokens fail.
- Direct browser-role RPC/table mutation fails.
- Server-controlled fields cannot be supplied by the visitor.
