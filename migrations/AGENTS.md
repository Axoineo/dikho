# Cloudflare D1 Migration Instructions

These instructions extend the repository root `AGENTS.md` for
`migrations/`.

- Migrations are ordered and append-only after deployment.
- Preserve compatibility with existing rows; additive changes need safe
  defaults or an explicit backfill.
- Add indexes for hot lookup/reconciliation paths and explain their purpose.
- Keep send/retry claims atomic and idempotent.
- Preserve the unique recipient and webhook-event constraints that prevent
  duplicate messages.
- Global budget updates must remain guarded so reaching a cap stops further
  spend and unnecessary writes.
- Store timestamps in the established SQLite-compatible format for the table;
  do not silently mix sortable formats.
- Bound batch statement counts and parameter counts to D1 limits.
- Remote migration application requires explicit user approval.
- After a migration, verify schema state and the affected API flow in a
  non-production environment first.
