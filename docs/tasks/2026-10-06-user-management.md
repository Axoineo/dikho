# Task: User Management, permissions and emergency controls

Status: active (phase 1 code complete in the working tree; nothing deployed)
Owner: Dikho Global Media LLP (rollout, decisions), coding agent (implementation)
Started: 2026-10-06
Last updated: 2026-10-06

## Goal

Administrators manage who can use Dikho from the dashboard: add people, give
each person exactly the access their job needs (and extra when needed), see
when and roughly where they sign in, and remove someone instantly in an
emergency. Every change is checked server-side and recorded.

## Decisions taken with the owner (2026-10-06)

- Sign-in stays OTP; no invitation links. Adding someone sends a welcome
  message: email when they have one, otherwise WhatsApp.
- Record scopes arrive in stages: all-or-nothing per module now, plus "own"
  for sales orders. Team/department scopes follow as modules record owners.
- Developers are super users (every permission), but cannot act on Owners,
  make Owners, or grant developer access. Only an Owner grants developer
  access. The four developer levels from the brief are kept.
- Starting access: two Owners and one developer super user (level System
  Owner), named by the owner. Set by SQL at rollout, never committed.
- If this dashboard ever runs before its database update, it says "Dikho is
  being updated" (and the API answers 503) instead of blaming the network or
  signing people out. Seen on 2026-10-06 when the new code ran locally against
  the not-yet-updated production database.
- Each person's theme choice is saved to their profile.
- "Active now" shows the section of Dikho a person is in.
- **Live Assist** (phase 2): an admin can view and control an employee's Dikho
  tab without asking first; the employee always sees a banner and cannot end
  it. Owners and Admins downward, plus developers. Built on rrweb (MIT).
  Every session and every admin action is logged.

## Non-goals (phase 1)

- Live Assist (phase 2), developer console and feature flags (phase 3).
- Team and department scopes for modules without an owner column.
- Invoice and payment screens (the permissions exist; the pages are placeholders).

## Acceptance criteria (phase 1)

- [x] Staff profiles, departments/teams, permission catalogue, templates,
      per-person overrides, sessions, append-only audit log.
- [x] RLS on every business table checks the action's permission; sales orders
      honour "own".
- [x] Every API route checks a permission; one Supabase round trip per request.
- [x] A forced sign-out or suspension refuses the old token immediately in the
      API and the database, and signs out an open dashboard.
- [x] Escalation rules enforced in the database (see Permissions).
- [x] Users list, profile (overview, access grid, sessions, activity), add and
      edit, templates, departments, audit log; light, dark, phone widths.
- [x] Sidebar, landing page and route guards follow permissions; existing
      modules hide add/edit/import/send controls a person cannot use.
- [ ] Rolled out in the order below and verified in production.

## Relevant sources

- Decision: [ADR 0007](../decisions/0007-user-management-and-permissions.md)
- Model: [Permissions](../PERMISSIONS.md); operations: [Staff access runbook](../runbooks/staff-access.md)
- Migration: `supabase/migrations/20261006150000_user_management.sql`
- API: `src/api/middleware/requireAuth.js`, `src/api/routes/users/`, `src/api/routes/me/`,
  `src/api/services/userAdmin.js`, `src/api/services/staffWelcome.js`
- Dashboard: `src/lib/access.js`, `src/layouts/AuthenticatedLayout.jsx`,
  `src/features/users/`, `src/components/AccessDenied.jsx`, `src/components/Sidebar.jsx`
- Builds on the undeployed [security hardening](2026-10-05-security-hardening.md).

## Rollout (combined with the 2026-10-05 hardening; each step before the next)

1. **Supabase → Authentication:** turn off "Allow new users to sign up".
2. **Mark the starting people** with the SQL in the
   [runbook](../runbooks/staff-access.md#the-first-owner): the two Owners
   `admin`, the developer `developer` (super user, level System Administrator). The
   owner has the names; they are not recorded in this public repository.
   Everyone else is added from the dashboard afterwards.
3. **Apply `20261006143107_staff_membership.sql`, then straight away
   `20261006150000_user_management.sql`.** The second makes the `admin` holder
   the Owner and refuses to run if nobody holds `admin`. If they are applied
   through a tool that stamps its own version (the Supabase MCP does), rename
   the local files to match afterwards, or CI fails with "Remote migration
   versions not found".
4. **Optional configuration** for welcome messages: `BREVO_API_KEY` and
   `BREVO_SENDER_EMAIL` as API Worker secret/var, `APP_URL`, and once Meta has
   approved it, `WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME`
   ([Configuration](../CONFIGURATION.md#staff-welcome-template)). Without them
   people are still added; the dashboard says no message was sent.
5. **`npm run deploy:api`**, then **push to `main`** straight after (Pages
   builds the SPA). Between the two, the old dashboard keeps working for the
   Owner.
6. **Verify** with the checks in the runbook, using a synthetic test person:
   add, restrict, sign out, suspend, reactivate, archive.
7. Continue the hardening rollout from its step 7 (vendor form end to end,
   storage migration, Realtime public access off, CSP).

Rollback: revert the commit and redeploy API and SPA. In the database, the
tables can stay; re-applying `20261006143107_staff_membership.sql` restores
its `is_staff()` (app_metadata roles), which the old code expects.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Unit tests (`npm test`, Node 26 local; 20 and 22 in Docker as CI) | 69/69 pass | includes new `users-api.test.js`, rewritten `require-auth` and OTP-hook tests |
| Fresh database, run twice (last after the final migration change): all migrations replayed on `supabase/postgres:17.6.1.155`, real GoTrue v2.197.0 creating `auth.sessions` | pass, migration applied twice | guard refuses with users and no `admin`; owner backfilled |
| RLS allow/deny as real sessions (40 checks) | pass | own vs all sales orders and items, PO vs SO, creator immutable, clients/vendors/invoices, inbox and personal Realtime topics, audit append-only, browser cannot call `um_*` |
| Escalation rules (47 checks) | pass | ranks, Owner/developer grants, own-access edits, grant/revoke beyond own access, templates, last Owner, force sign-out kills an unexpired token in DB and GoTrue, suspend/reactivate |
| End to end through the API Worker (`wrangler dev`) + PostgREST v14.1 + GoTrue (36 checks) | pass | 401/403 cases, D1 route permissions, add user (normalised phone, no orphan on refusal, refusal audited), extra permission, emergency suspend (ban, old token 401, sign-in blocked, notice broadcast), reactivate, force sign-out |
| Dashboard in headless Chrome against that stack | pass | users list, profile access grid, sessions, add-user form, templates, departments, audit log, access denied, filtered sidebar, no Add button without permission; light, dark, 390px |
| Heartbeat and saved theme | pass | after fixing the deferred owner trigger (it ran as the browser role at COMMIT) |
| Production rollout | not run | steps above |

Not verified locally: real email/WhatsApp delivery of welcome messages (no
provider credentials in the test stack; the "not configured" path is
verified), Realtime delivery of the sign-out notice to a live socket (the
broadcast call is verified; the socket subscription uses the same pattern as
the inbox), and Cloudflare locations outside this machine's own.

## Next

- Phase 2: Live Assist (decisions above).
- Phase 3: developer area and feature flags.
- Team/department scopes per module, starting with sales orders.
- Bind media tickets to a user so revocation also ends them.
