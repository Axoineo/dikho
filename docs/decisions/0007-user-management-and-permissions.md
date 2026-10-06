# 0007: User Management with per-action permissions

Status: Accepted (implemented in the repository; not yet deployed)
Date: 2026-10-06
Supersedes: the role list in [ADR 0006](0006-staff-membership-in-app-metadata.md)

## Context

ADR 0006 closed the "any session is an operator" gap with an all-or-nothing
role list in Supabase `app_metadata`. The owner then asked for real user
management: adding people from the dashboard, giving each person exactly the
access their job needs (and extra access when needed), suspending or signing
someone out in an emergency, and seeing when and where people sign in.

Constraints that shaped the design:

- Business data is read and written by the browser directly through
  PostgREST, so access has to be enforced by RLS, not only by the API.
- WhatsApp data lives in D1, where only the API Worker can enforce access.
- The Worker runs on Cloudflare's Free plan (50 subrequests per invocation),
  so per-request authorization must stay at one round trip.
- Access tokens live up to an hour. Revoking someone must not wait for that.
- Most tables record no owner; only sales orders store their creator.

## Decision

**Data model** (`supabase/migrations/20261006150000_user_management.sql`):
`staff_members` (one row per person; identity stays in `auth.users`),
`departments` and `teams`, a `permissions` catalogue keyed `resource.action`,
`permission_templates` with `template_permissions`, built-in `role_permissions`
for system roles, per-person `staff_permission_overrides`, `staff_sessions`
(sign-in location and last activity) and an append-only `audit_log`. All are
closed to browser roles; only SECURITY DEFINER functions touch them.

**Roles are separate from job titles.** A designation (Sales Executive, CFO)
grants nothing. Access comes from:

| Layer | Grants |
| --- | --- |
| System role | `staff`, `manager`, `admin`, `owner`. Admin adds user-management permissions; Owner holds every business permission |
| Developer level | `developer` < `senior_developer` < `lead_developer` < `system_owner`. Any level holds every permission (developers are super users by owner decision); developer-only permissions are graded by level |
| Template | Baseline business permissions with a scope |
| Overrides | Per person: grant (with scope) or revoke |

Effective permissions, computed only in `public.effective_permissions_for`:
Owners and developers get everything they are entitled to and ignore
templates and overrides. Everyone else gets the widest scope from their
template and role, then each override replaces that permission.

**Scope** is per permission: `own`, `team`, `department`, `all`. Today only
sales orders enforce `own` (their creator is recorded, filled in by the
database and immutable). Other modules allow `all` only until they record an
owner; the catalogue's `allowed_scopes` says which scopes each permission can
enforce, so this widens per module without a model change.

**Enforcement, one source of truth.**

- RLS: restrictive per-action policies on every business table call
  `public.permission_scope()` / `public.has_permission()`, evaluated once per
  statement. They AND with the existing policies, so they can only narrow.
- Every check also requires the token's session to still exist in
  `auth.sessions` (`public.session_is_live()`). Ending a session deletes that
  row, so a copied token stops working at once, not at expiry.
- The API's `requireAuth` calls `public.my_access()` through PostgREST with the
  caller's own token: one subrequest that validates the token, checks the
  live session, the staff record and bans, and returns the permission map.
  `requirePermission(...)` then guards each D1 and Meta route.
- User-management writes go only through the Worker (it holds the service role
  needed for Supabase Auth admin calls) into `um_*` database functions. Those
  re-check every rule against the database, atomically with the change and its
  audit entry.

**Escalation rules** (in the `um_*` functions, not the UI): nobody changes
their own access; an actor manages only people ranked below them
(owner 40 > developer 30 > admin 20 > manager 10 > staff 0; Owners manage
everyone); roles can be granted only below the actor's rank; only an Owner
makes an Owner or grants developer access; a permission can be granted or
removed only at a scope the actor holds; a template used by someone the actor
cannot manage cannot be edited by them; there is always one active Owner.

**People are added without invitation links.** The Worker creates a confirmed,
passwordless Supabase account; the person signs in with the existing email or
WhatsApp one-time code. An optional welcome message (email via Brevo, else a
WhatsApp utility template) carries no link or code, and is capped at one per
person per 10 minutes and 30 per day.

**Emergencies.** Suspend: the database marks the person suspended and deletes
their sessions in one transaction, the Worker bans the Auth account (no new
sign-in or refresh), then tells any open dashboard over the person's private
Realtime channel (`staff:<user id>`) to sign out. Force sign-out ends sessions
without blocking a new sign-in.

**Activity.** A heartbeat (`public.touch_session`) once a minute while the
person is actively using a visible tab records last activity and a section key
(never a URL or record id). Location is Cloudflare's IP lookup recorded once
per session by the Worker. Employees are told about both in Settings.

## Consequences

- One subrequest per API call, as before. Each RLS-checked statement does a
  few indexed lookups (session, staff row, permission rows).
- `auth.users` rows with a staff record cannot be deleted; archive instead, so
  orders, invoices and the audit log keep their history.
- Every new `public` table needs the restrictive staff policy and, if it holds
  business data, a permission policy (`public.apply_crud_policies` helps).
- Templates shipped as built-in are reset to their defaults if the migration is
  re-applied; customise by duplicating.
- Known limits: an open Realtime connection keeps receiving until its token
  expires (the app disconnects itself at once, a tampered client may not);
  media tickets already issued stay valid up to six hours; `team` and
  `department` scopes are modelled but not yet enforced by any table.
- The dashboard hides what a person cannot use. That is navigation only; the
  database and API enforce the same permissions.

## Alternatives considered

- **Keep roles in `app_metadata` and add permissions there.** No table to
  secure, but permission maps and overrides do not fit a JWT claim, cannot be
  queried for the user list, and change only at token refresh.
- **Permission claims in a custom access-token hook.** Cheap RLS checks, but a
  revoked permission would keep working until the token expires.
- **Invitation links.** More tokens to leak and expire, and Supabase's built-in
  mailer is heavily rate-limited; OTP sign-in already proves the address.
- **A permissions check in the API only.** The browser reads Supabase
  directly, so that would leave every business table open.

## Verification

Run on the production Postgres image with a real Supabase Auth (GoTrue
v2.197.0) and PostgREST (v14.1), from a fresh database with every earlier
migration replayed (`docs/tasks/2026-10-06-user-management.md` has the list):
40 RLS allow/deny checks, 47 escalation-rule checks, 36 end-to-end checks
through the API Worker, plus unit tests in `tests/require-auth.test.js`,
`tests/otp-hook-and-media.test.js` and `tests/users-api.test.js`.
