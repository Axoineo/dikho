# Engineering Roadmap

Last reviewed: 2026-10-04

This is a directional priority list, not a promise of dates. Keep detailed
implementation state in a task brief under `docs/tasks/`. Update this file
when priorities materially change.

## Now: close high-impact risk

- [ ] Move public vendor-document upload behind server-side verification.
- [ ] Enforce upload byte/type/content limits and server-generated object keys.
- [ ] Remove anonymous Storage INSERT after the protected path is live.
- [ ] Replace broad vendor-document policies with scoped read/write/delete.
- [ ] Export and review effective production RLS and Storage policies.
- [ ] Add safe byte/decompression/row/field limits to contact import.
- [ ] Add byte/type limits to WhatsApp media and avatar upload paths.

## Next: authorization and regression protection

- [ ] Define administrator, finance, sales and support permissions.
- [ ] Add organization membership/role storage and server-side checks.
- [ ] Apply the same authorization model in PostgreSQL RLS.
- [ ] Add automated allow/deny tests for API, RLS and Storage.
- [ ] Add webhook replay/idempotency tests (signature tests exist).
- [ ] Add public budget/cooldown and upload-limit tests.
- [ ] Replace stale manual probes under `scripts/test/` with isolated fixtures.

## Then: browser and operational hardening

- [ ] Refactor inline HTML script/style/event requirements.
- [ ] Roll out Content Security Policy in report-only mode, then enforce it.
- [ ] Add HSTS, nosniff, Referrer-Policy and Permissions-Policy.
- [ ] Minimize PII in logs and document retention/access.
- [ ] Write and exercise backup/restore procedures.
- [ ] Define retention for leads, contacts, webhook events, login events,
      documents and WhatsApp media.
- [ ] Add deploy smoke tests and an environment health checklist.

## Product evolution

- [x] Select one organization per self-hosted instance as the initial public
      distribution model.
- [ ] Clarify approval/audit requirements for finance and bulk messaging.
- [ ] Move logo, color, organization identity and document branding into a
      validated configuration layer.
- [ ] Separate required and optional provider integrations with fail-closed
      setup validation.
- [ ] Build a safe first-admin, migration and environment setup workflow.
- [ ] Prove installation and upgrade from a clean environment using only
      placeholder documentation.
- [ ] Choose the public license, contribution, support and release policy.
- [ ] Reduce remaining spreadsheet/manual steps in core operations.
- [ ] Improve reporting only after source-of-truth and authorization rules are
      stable.

## Recently established

- [x] Canonical AI/developer documentation reflects the split SPA/API/Supabase
      architecture.
- [x] Signed WhatsApp and Supabase hooks.
- [x] Turnstile action/hostname verification for public database writes.
- [x] Service-role-only execution for public write RPCs.
- [x] Global daily budgets for GST lookup and public WhatsApp confirmation.
- [x] Idempotent webhook ledger and campaign-recipient claims.
- [x] Isolated tests for session verification, Turnstile, webhook signatures
      and media tickets, run by `npm test` and in CI (`tests/`).

## Maintenance rule

Every item moved to complete should point to deployed code/configuration and
verification evidence. Documentation alone does not close a security or
reliability item.
