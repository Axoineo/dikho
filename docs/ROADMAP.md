# Engineering Roadmap

Last reviewed: 2026-10-05

This is a directional priority list, not a promise of dates. Keep detailed
implementation state in a task brief under `docs/tasks/`. Update this file
when priorities materially change.

## Now: close high-impact risk

Items marked *(code ready)* are implemented and verified locally but not
deployed; the rollout is in
[the hardening task](tasks/2026-10-05-security-hardening.md).

- [ ] Disable Supabase sign-up (dashboard setting; owner action).
- [ ] Require a staff role for the API, RLS, Storage, inbox channel and OTP
      hook *(code ready)*.
- [ ] Make the WhatsApp inbox Realtime channel private *(code ready)*.
- [ ] Move public vendor-document upload behind server-side verification
      *(code ready)*.
- [ ] Enforce upload byte/type/content limits and server-generated object keys
      *(code ready)*.
- [ ] Remove anonymous Storage INSERT after the protected path is live
      *(code ready)*.
- [ ] Replace broad vendor-document policies with scoped read/write/delete
      *(code ready)*.
- [x] Export and review effective production RLS and Storage policies
      (read-only, 2026-10-05).
- [ ] Add safe byte/decompression/row/field limits to contact import
      *(code ready)*.
- [ ] Add byte/type limits to WhatsApp media and avatar upload paths
      *(code ready)*.

## Next: authorization and regression protection

- [ ] Define administrator, finance, sales and support permissions.
- [ ] Enforce per-role permissions in the API and RLS, building on the staff
      roles in `app_metadata` ([ADR 0006](decisions/0006-staff-membership-in-app-metadata.md)).
- [ ] Add automated allow/deny tests for RLS and Storage, run against a local
      Supabase Postgres in CI (API staff-gate tests exist).
- [ ] Add webhook replay/idempotency tests (signature tests exist).
- [ ] Add public budget/cooldown tests (upload-limit tests exist).
- [ ] Replace stale manual probes under `scripts/test/` with isolated fixtures.

## Then: browser and operational hardening

- [ ] Refactor inline HTML script/style/event requirements *(code ready)*.
- [ ] Roll out Content Security Policy in report-only mode *(code ready)*, then
      enforce it with `CSP_MODE=enforce`.
- [ ] Add HSTS, nosniff, Referrer-Policy and Permissions-Policy *(code ready)*.
- [ ] Minimize PII in logs *(code ready)* and document retention/access.
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
