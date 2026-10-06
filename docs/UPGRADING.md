# Upgrade Guide

Last reviewed: 2026-10-05

This guide describes how to move an existing Dikho installation between
reviewed revisions. It does not make the repository a supported public release:
there is no stable release series, compatibility guarantee or automated
installer yet. Until those exist, treat every upgrade as a coordinated change
across independently deployed components.

Never paste secret values, private resource identifiers, signed URLs or
production records into an issue, pull request, changelog or upgrade log.

## Upgrade units

| Unit | Source of change | Release mechanism | Compatibility concern |
| --- | --- | --- | --- |
| Browser SPA | `src/`, `public/`, browser build configuration | Merge or push to `main` triggers Cloudflare Pages | Must remain compatible with the active API and database during rollout |
| API Worker | `src/api/`, `wrangler.api.jsonc` | Explicit `npm run deploy:api` | D1/R2 bindings, secrets and provider contracts |
| D1 | `migrations/` | Ordered D1 migration command | Existing messaging rows, claims, budgets and webhook state |
| Supabase database and Storage | `supabase/migrations/` | Approved migration workflow | Grants, RLS, Storage policies, RPCs and existing business records |
| Supabase Edge Functions | `supabase/functions/` | Explicit function deployment | Auth hooks, origin allowlists and server secrets |
| Provider consoles | External configuration | Reviewed manual/provider operation | Templates, webhooks, Turnstile hostnames and API access |

`npm run deploy` publishes the standalone SPA Worker described by
`wrangler.jsonc`; production does not use it. It is not an upgrade command for
the live SPA.

## Before changing an installation

1. Read [CHANGELOG](../CHANGELOG.md), the relevant commit diff and any linked
   ADR or task brief. Do not infer a migration from a version number alone.
2. Inventory which upgrade units changed. Review new variable **names** and
   bindings without retrieving or printing their values.
3. Confirm the target environment and active revision. A push to `main` is a
   production SPA release, so prepare all compatible server/database work
   before that push.
4. Back up data when the change can alter schema, policies or durable records.
   Confirm that the backup can be restored; possession of an untested export is
   not a rollback plan.
5. Run `npm ci`, `npm run check` and, when dependencies changed,
   `npm audit --omit=dev` from the candidate revision.
6. Exercise the affected allowed, denied, malformed, duplicate and failure
   paths in an isolated development or staging environment.
7. Write the exact rollout order, smoke tests, owner and rollback/forward-fix
   decision before touching production.

## Compatibility rules

- Prefer additive schema and API changes first, consumers second, and removal
  only after old consumers are gone.
- Never edit a migration already applied to a shared environment. Add a
  forward migration.
- Keep at least one deployable step compatible with both old and new schema
  when a rollout spans the SPA, API and database.
- Preserve financial history, reconciliation state, campaign recipients,
  webhook idempotency and authoritative budgets.
- Do not loosen RLS, Storage, signature verification, Turnstile, upload limits
  or authorization as a temporary compatibility measure.
- Treat changed brand presentation separately from legal/financial identity.
  An upgrade must not silently rewrite issued documents or actor attribution.
- Unknown configuration must fail clearly without logging its value. Missing
  security-critical configuration must fail closed.

## Recommended rollout pattern

Use the component-specific sequence in [Deployment](DEPLOYMENT.md) when it is
more precise. The safe general pattern is:

1. Add backward-compatible database structures and server configuration.
2. Deploy API/Edge Function support that accepts the old and new client
   contract where feasible.
3. Verify server health and denied cases.
4. Release the Cloudflare Pages SPA by approved push/merge to `main`.
5. Run public, authenticated, webhook, messaging and financial smoke tests for
   the affected surface.
6. Remove obsolete schema, configuration or compatibility code only in a later
   reviewed change after all consumers have moved.

For security lockdown work, availability may require a different documented
order. For example, the public-form sequence is defined in
[Deployment](DEPLOYMENT.md#public-form-lockdown-rollout). Do not improvise the
order during a production incident.

## Database and policy upgrades

Before applying a migration, review both the SQL and its effective permission
change. After applying it in an isolated environment, test the real role model:

- anonymous access that must be denied and any intentionally public action;
- authenticated access with and without the required future membership/role;
- cross-record and cross-organization denial;
- service workflow access through the intended narrow RPC or server path;
- Storage object reads, writes, replacements and deletes, including guessed
  paths.

A successful migration command proves only that SQL ran. It does not prove RLS,
Storage or function grants are correct. See [Database](DATABASE.md),
[Permissions](PERMISSIONS.md) and [Testing](TESTING.md).

## Verification record

Record the following without sensitive values:

- source revision and environment name/class;
- component revisions released;
- ordered migrations applied;
- configuration **names** added, removed or changed;
- checks and scenarios run, including denied cases;
- observed issues, decision owner and rollback/forward-fix action.

Use an approved private operations system when even the identifiers are
sensitive. Repository documentation should contain only reusable procedure.

## Rollback and forward correction

Static SPA releases can usually select a previously reviewed Pages deployment,
but do not roll the SPA back across an incompatible API or schema boundary.
Worker and Edge Function rollback also requires compatible bindings and data.

Database rollback is often a forward correction: destructive reversal can lose
valid writes made after deployment. Never delete tables, columns, policies or
production data merely to make code match an older revision. Stabilize access,
preserve evidence, and follow the [rollback runbook](runbooks/rollback.md).

## Public-release work still required

Before promising routine self-service upgrades, the project still needs:

- a version and support policy;
- machine-validated configuration and compatibility checks;
- clean-install and old-to-new migration fixtures;
- automated RLS/Storage and end-to-end smoke tests;
- documented backup/restore exercises;
- at least one clean-room installation and upgrade using synthetic data.

Track those gates in [Roadmap](ROADMAP.md) and the visual release map in
[VISUALIZE](../VISUALIZE.md).
