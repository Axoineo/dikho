# 0003: D1 and R2 for WhatsApp Operations

Status: Accepted
Date: 2026-10-04

## Context

WhatsApp campaigns and conversations need provider-message identifiers,
idempotency, out-of-order receipt reconciliation, scheduled work and persistent
media. This operational workload has different access patterns from CRM records
served through Supabase PostgREST.

## Decision

Use Cloudflare D1 for WhatsApp contacts, campaigns, conversations, messages,
webhook events, cooldowns, budgets and outbox rows. Use R2 for re-hosted media
and avatars. Access both exclusively through the API Worker.

## Consequences

- The API authentication/authorization layer is the data-access boundary.
- D1 migrations are separate from Supabase migrations.
- Webhook events and send claims must remain idempotent.
- D1 plan limits and parameter/batch limits affect implementation.
- WhatsApp media needs authenticated delivery or a short-lived ticket because
  the bucket is not public.
- CRM and WhatsApp data may reference the same user/contact concept without
  sharing one database transaction.

## Alternatives considered

- Keep provider media URLs: they expire and require provider authorization.
- Make R2 public: exposes private customer content.
- Put all operational messaging state in browser-accessible PostgREST tables:
  expands RLS surface and does not simplify Worker/provider processing.

## Verification

- Forged webhooks are rejected before D1 writes.
- Duplicate deliveries do not duplicate messages.
- Out-of-order receipts reconcile safely.
- Media without authentication or a valid ticket is rejected.
- R2 keys cannot escape intended prefixes/routes.
