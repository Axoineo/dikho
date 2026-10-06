# Task: Close the 2026-10 security audit findings

Status: active (code complete in the working tree; nothing deployed)

> 2026-10-06: the role list this brief introduced is replaced by User
> Management ([ADR 0007](../decisions/0007-user-management-and-permissions.md)),
> and `src/lib/staffRoles.js` is gone. Roll the two out together using the
> combined order in [the User Management task](2026-10-06-user-management.md).
Owner: Dikho Global Media LLP (rollout), coding agent (implementation)
Started: 2026-10-05
Last updated: 2026-10-05

## Goal

Every finding in the 2026-10 review is fixed in code, verified locally, and
rolled out in an order that never locks staff out or breaks a public form.

## Why now

Live checks on 2026-10-05 showed the review understated two risks. Supabase
sign-up was open (`disable_signup: false`), so "any authenticated user" meant
"anyone". And the WhatsApp inbox broadcast customer messages on a public
Realtime channel that anyone with the publishable key could join.

## Non-goals

- Per-role permissions (admin vs finance vs sales). The matrix in
  [Permissions](../PERMISSIONS.md) needs owner decisions first.
- Moving or deleting existing vendor documents.
- Enforcing the browser CSP before it has run clean in report-only mode.

## Acceptance criteria

- [x] Public vendor documents go through the Worker after Turnstile, with size,
      real-type and server-generated-key checks; anon has no Storage access.
- [x] Vendor documents: staff-only read, upload only for an existing vendor,
      no update, delete only own uploads; bucket limited to 10 MB of
      PDF/JPEG/PNG/WEBP.
- [x] Only accounts with a staff role reach the API, the database, Storage,
      the inbox channel or the WhatsApp OTP hook.
- [x] Contact import, WhatsApp media, contact photos, avatars and both hooks
      bound request bytes before buffering; XLSX expansion is capped.
- [x] SPA ships security headers with a hash-based CSP (report-only first).
- [x] Logs drop or mask phone numbers, emails, names, message text, GSTINs.
- [ ] Rolled out in the order below and verified in production.

## Relevant sources

- Security finding: [Security audit](../SECURITY-AUDIT.md)
- Architecture/ADR: [ADR 0006](../decisions/0006-staff-membership-in-app-metadata.md)
- Runbook: [Staff access](../runbooks/staff-access.md)
- Code paths: `src/api/routes/public/index.js`, `src/api/middleware/requireAuth.js`,
  `src/lib/staffRoles.js`, `src/api/utils/body.js`, `src/api/utils/parseSheet.js`,
  `src/api/utils/logger.js`, `vite.config.js`,
  `supabase/migrations/20261006143107_staff_membership.sql`,
  `supabase/migrations/20261006160000_vendor_document_storage.sql`

## Rollout (each step before the next)

1. **Supabase → Authentication → Sign In / Providers:** turn off "Allow new
   users to sign up". Independent of everything else; do it first.
2. **Grant roles** to every real operator ([runbook](../runbooks/staff-access.md)).
   Production had 3 auth users on 2026-10-05, none with a role. Confirm the
   list with the runbook's query.
3. **Apply `20261006143107_staff_membership.sql`.** It refuses to run if no
   user has a role. Afterwards, a staff user checks the dashboard still loads
   vendors, invoices and leads.
4. **Find out whether Supabase's GitHub integration applies migrations on
   push to `main`.** If it does, step 6 will also apply the storage migration;
   that is acceptable only because steps 2, 3 and 5 are already done.
5. **`npm run deploy:api`.** No new secrets: it reuses
   `SUPABASE_SERVICE_ROLE_KEY` (now also for Storage uploads and private
   broadcasts).
6. **Push to `main` straight after step 5** (Pages builds the SPA). Between 5
   and 6, a vendor submitting from the old page keeps the registration but
   loses the attachment, and the inbox stops live-updating until reload.
7. **Verify the public vendor form end to end** with a synthetic vendor and a
   small PDF (a human must solve Turnstile). Expect the document under
   `vendors_documents/public/` and openable from the vendor list. Then delete
   the synthetic vendor.
8. **Apply `20261006160000_vendor_document_storage.sql`.**
9. **Supabase → Realtime → Settings:** turn off public channel access, so only
   private, policy-checked channels can be joined.
10. Run the verification checklist below, then browse every dashboard screen
    with the browser console open. When no `Content-Security-Policy` report
    appears, set `CSP_MODE=enforce` in the Pages environment and redeploy.

Rollback: revert the commit and redeploy (API and SPA). The migrations have
rollback statements in their headers; the staff migration's rollback reopens
the database to every authenticated account, so use it only in an emergency
and with sign-up off.

## Verification

| Check | Result | Evidence/notes |
| --- | --- | --- |
| `npm test` (Node 26 local; Node 20 and 22 in Docker, as CI) | pass, 55/55 | Includes new upload, parser, logger, staff-gate, public-upload, OTP-hook and media tests |
| `npm run check` | see final report | lint (no new warnings), tests, build, secret scan |
| `npm audit --omit=dev` | 0 vulnerabilities | 2026-10-05 |
| Existing Supabase migrations replayed on `supabase/postgres:17.6.1.155` (production's version) | pass | Platform-owned objects (Storage, Realtime tables) stubbed with production's column shapes |
| Staff migration guard with users and no roles | refused | Error names the runbook |
| Both new migrations, applied twice | pass | idempotent |
| RLS/Storage/Realtime matrix: staff, no role, banned, string role, unknown role, anon | as designed | staff full access; all others no rows or denied; anon keeps only `media`/`sub_media` reads; staff cannot update documents, upload outside a known vendor folder or delete others' uploads |
| `issue_invoice` as non-staff / anon | denied | "Only staff can issue invoices." / permission denied |
| `issue_invoice` body unchanged apart from the staff check | pass | md5 of the snapshot body equals production's `prosrc` |
| Worker runtime (`wrangler dev`): disguised HTML, 11 MB upload, 100 KB chunked JSON, no token, no ticket | 415, 413, 413, 401, 401 | Valid PDF reaches Turnstile and is refused for the synthetic token (403) |
| Built SPA under the generated CSP, enforced, in headless Chrome: `/`, `/vendor/register`, `/corporategifting` | 0 violations | Negative control without hashes reported 3 violations |
| Signed-in dashboard under CSP | not run | Needs a real login; hence report-only first |
| Production rollout | not run | Steps above |

## Risks, blockers and rollback

- Risk: an operator without a role is locked out. Mitigation: step 2, the
  migration guard, and the in-app "No access" screen pointing to an admin.
- Risk: the CSP misses an origin used only on signed-in screens. Mitigation:
  report-only until a clean pass.
- Local-only observation: in `wrangler dev`, a request sent immediately after a
  large upload that was cut off with 413 failed once in the dev proxy; it did
  not reproduce with a one-second gap. Production terminates connections at
  the edge, so this is not expected there; watch for 5xx after 413s.
- Blocker: deployment and migrations need the owner (see AGENTS.md).

## Completion handoff

Not deployed. When rolled out, record the deployed commit and the verification
results here, tick the security audit checklist, then archive this brief.
