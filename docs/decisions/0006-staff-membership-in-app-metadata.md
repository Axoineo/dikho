# 0006: Staff membership in Supabase app_metadata

Status: Superseded in part by [ADR 0007](0007-user-management-and-permissions.md) (membership now lives in `public.staff_members`; the restrictive staff policy and `is_staff()` remain)
Date: 2026-10-05

## Context

Every dashboard API route accepted any valid Supabase session, and every
business table granted `authenticated` full access with `USING (true)`. That is
only safe if every account that can obtain a session is a trusted operator. On
2026-10-05 the production project reported `disable_signup: false` with email
and phone sign-in enabled, so anyone with the public publishable key could
create and confirm an account. The login form's `shouldCreateUser: false` is a
client-side choice and does not prevent that. The same gap let anyone join the
WhatsApp inbox's public Realtime channel and trigger WhatsApp OTP messages to
arbitrary numbers through the Send-SMS hook.

The per-role permission matrix in [Permissions](../PERMISSIONS.md) is not yet
decided, so a decision was needed that closes the gap without inventing that
matrix.

## Decision

An account is a staff member when its Supabase `app_metadata.dikho_roles` is an
array containing at least one of `admin`, `finance`, `sales`, `operations`,
`support`. `app_metadata` is writable only with the service role.

- The API (`requireAuth`) reads the user fresh from `/auth/v1/user` on each
  request and answers `403` without a staff role or while the user is banned.
- PostgreSQL `public.is_staff()` reads `auth.users` directly (not the JWT), and
  a restrictive `staff members only` policy on every `public` table ANDs it
  into all existing `authenticated` access. `issue_invoice` checks it too.
- Storage and the private `wa-inbox` Realtime channel require it.
- The Send-SMS hook refuses to deliver codes to non-staff users.
- The dashboard explains denial; it is not a security boundary.

Membership is all-or-nothing for now. Role-specific permissions will build on
the same claim once the matrix is accepted.

## Consequences

- Granting and revoking access is an administrator action
  ([Staff access runbook](../runbooks/staff-access.md)); there is no in-app
  user management yet.
- Revocation is immediate for the API and database. Open Realtime connections
  and issued media tickets persist until reconnect or expiry.
- Every new `public` table must get the restrictive staff policy in its own
  migration; the migration that introduced it covered only existing tables.
- Rollout order matters: roles must exist before the API, SPA or migration
  ship, or operators are locked out. The migration refuses to apply when users
  exist and none holds a role.

## Alternatives considered

- **A `staff_members` table.** More flexible, but the API would need an extra
  service-role query per request (the Worker's subrequest budget is tight on
  the Free plan), and it adds a table to secure. `app_metadata` arrives with
  the user lookup the API already makes.
- **Reading roles from the JWT in RLS.** Cheaper, but a revoked role would keep
  working until the token expires (up to an hour).
- **Rewriting each table's permissive policies.** Larger diff and easy to miss a
  table; one restrictive policy per table is uniform and auditable.
- **Relying only on disabling sign-up.** Necessary but a single dashboard
  toggle; the code-level gate keeps holding if it is ever re-enabled.

## Verification

- `tests/require-auth.test.js` covers missing, malformed, unknown, user-editable
  and banned role cases.
- The migration was replayed on the production Postgres image with every
  earlier migration and probed as staff, non-staff, banned, malformed-role and
  anon identities (see `docs/tasks/2026-10-05-security-hardening.md`).
- After deployment, run the checks in the staff access runbook.
