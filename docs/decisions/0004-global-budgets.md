# 0004: Hard Global Budgets for Public Paid Operations

Status: Accepted
Date: 2026-10-04

## Context

Public GST lookup and WhatsApp confirmation routes can consume third-party quota,
money or sender reputation. Turnstile and per-IP edge limiting raise the cost of
abuse but do not reliably cap total volume across rotating addresses or edge
locations.

## Decision

Keep permissive edge rate limiting as a first-line brake, but enforce an
authoritative global daily counter in D1 before paid/quota-sensitive upstream
work. Preserve per-number cooldowns where repeated sends to one recipient also
need suppression.

## Consequences

- Maximum daily exposure is explicit and configurable.
- Reaching the cap can reject legitimate traffic until reset, so alerts and
  measured capacity planning are needed.
- Counter updates consume bounded D1 writes because updates stop once capped.
- A configuration value of zero must have an explicit documented meaning; an
  absent/invalid value should fail safely.

## Alternatives considered

- Per-IP rate limit only: not an accounting-grade global ceiling.
- Turnstile only: does not guarantee a maximum number of successful solves.
- No cap with provider billing alerts: alerts occur after exposure.

## Verification

- Requests below the cap work and increment exactly once.
- Concurrent requests cannot exceed the intended bound materially.
- Requests after the cap do not reach the upstream provider.
- Invalid/missing cap configuration follows documented fail-safe behavior.
