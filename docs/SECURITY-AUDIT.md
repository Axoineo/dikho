# Security Audit and Hardening Plan

Last reviewed: 2026-10-05

This document records the repository-level security review. It contains no
credential values, account identifiers, database identifiers, production user
data, or private infrastructure details. Confirm the deployed Cloudflare and
Supabase configuration separately: source files show intended configuration,
not necessarily effective production state.

## Scope

The review covered:

- the React/Vite browser application;
- the Cloudflare API Worker, D1 and R2 access paths;
- Supabase Auth, PostgREST, Storage, Edge Functions and migrations;
- public forms, Turnstile, GST lookup and WhatsApp integrations;
- dependency advisories, secret scanning, logging and deployment guidance.

The review was static and non-destructive. It did not attempt exploitation,
load testing or access to production data. On 2026-10-05 it was extended with
read-only checks of the live configuration: Auth settings, effective RLS,
Storage and Realtime policies, function grants, and aggregate counts (no row
contents).

## Current strengths

- WhatsApp and Supabase hook requests are authenticated with HMAC signatures.
- Public form writes verify Turnstile server-side and check action and hostname.
- Public form RPCs are restricted to the server-side service role by the latest
  lockdown migration.
- API CORS uses an explicit allowlist and fails closed when it is empty.
- SQL values are parameterized in application queries.
- GST lookups and public WhatsApp confirmations have global daily budgets.
- Media URLs use short-lived signed tickets; storage buckets are not public.
- API errors do not return stack traces.
- The repository secret scan found no committed credential values.
- The production dependency audit reported no known advisories at review time.

## Findings and status

Status words: **fixed in code** means implemented and verified locally in the
repository, not deployed. A finding closes only when the rollout in
[the hardening task](tasks/2026-10-05-security-hardening.md) has run and the
effective production behavior is verified.

### Found live on 2026-10-05 (read-only checks)

#### P0: open sign-up made every session untrusted (fixed in code; dashboard toggle pending)

`/auth/v1/settings` reported `disable_signup: false` with email and phone
enabled. Anyone with the publishable key could create and confirm an account
and, with it, read and change every business table (`USING (true)` policies),
use every dashboard API route, and make the Send-SMS hook deliver WhatsApp
codes to any number. The login form's `shouldCreateUser: false` protects
nothing server-side.

Fix: turn sign-up off in the Supabase dashboard (owner action), plus a staff
membership gate in code: [ADR 0006](decisions/0006-staff-membership-in-app-metadata.md),
`src/api/middleware/requireAuth.js`, `src/api/routes/auth/index.js`,
`supabase/migrations/20261006143107_staff_membership.sql`.

#### P0: WhatsApp inbox on a public Realtime channel (fixed in code)

The Worker broadcast inbox events (customer phone numbers, message text) to the
public `wa-inbox` topic with the publishable key, so anyone could subscribe.
Fix: private channel on both ends, a staff-only policy on `realtime.messages`,
and service-role publishing. After rollout, disable public channel access in
the Realtime settings.

#### P1: `issue_invoice` callable by any account (fixed in code)

The SECURITY DEFINER function checked only `auth.uid() IS NOT NULL` and was
executable by `anon`. It now requires staff and is no longer granted to `anon`.

### From the repository review

#### P0: anonymous document uploads (fixed in code)

The public vendor form now posts its document to `POST /api/public/vendor`.
The Worker checks size (10 MB) and the file's real type (PDF/JPEG/PNG/WEBP by
signature) before spending the Turnstile token, verifies Turnstile, stores the
file with the service role under a key it generates
(`vendors_documents/public/<uuid>.<ext>`), ignores any path the caller sends,
and deletes the file if the registration is rejected.
`20261006160000_vendor_document_storage.sql` removes the anonymous INSERT
policy. Remaining: no scheduled cleanup for orphans left by earlier anonymous
uploads (list them with the query in [Database](DATABASE.md)).

#### P0: broad vendor-document access (fixed in code)

The effective policies (exported 2026-10-05) let any authenticated account
read, overwrite and delete every object in the bucket, plus four dormant
policies on a nonexistent `vendor-documents` bucket. Replaced with: staff read
under `vendors_documents/`, staff upload only for an existing vendor id, no
update, delete only one's own uploads, and bucket limits of 10 MB and four
MIME types. Per-role scoping waits for the permission matrix.

#### P1: roles and organization scope (partly fixed in code)

Membership is enforced everywhere (see the open sign-up finding). Distinct
permissions per role (finance vs sales, who may send campaigns, export or bulk
delete) are not, because the matrix in [Permissions](PERMISSIONS.md) needs
owner decisions. One organization per instance remains the boundary
([ADR 0005](decisions/0005-one-organization-per-instance.md)).

#### P1: unbounded file and archive processing (fixed in code)

Every body-accepting route reads through `src/api/utils/body.js`, which refuses
a declared or streamed body over its cap before buffering: contact import 5 MB,
WhatsApp media 16 MB (with Meta's per-type limits and a MIME allowlist), contact
photos and avatars 2 MB (raster images by signature, no SVG), public JSON
64 KB, Meta webhook 2 MB and the OTP hook 64 KB, both before signature checks.
The sheet parser caps rows (50,000), columns (200) and cell length (2,000), and
for XLSX caps archive entries (1,000), inflates only the two parts it reads,
and stops inflating past 16 MB per part and 24 MB in total. Media served from
R2 carries `nosniff`, and anything not safe to render inline (HTML, SVG,
unknown) is forced to download in a CSP sandbox.

### P2: defense in depth

#### Browser security headers (fixed in code; CSP report-only)

The build writes `dist/_headers` for Pages: a hash-based CSP without
`unsafe-inline` (inline handlers were removed from `index.html`),
`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
HSTS and COOP. The CSP starts as `Content-Security-Policy-Report-Only`; set
`CSP_MODE=enforce` after a clean pass through the signed-in screens. API
responses carry `nosniff` and `Referrer-Policy: no-referrer`.

#### Personal data in logs (fixed in code)

The logger masks identifiers (phone, wa_id, GSTIN, PAN, account numbers) to
their last four characters, replaces names, emails, addresses and message text
with their length, and scrubs emails, phone numbers, GSTINs and PANs from every
string, including error stacks. The webhook logs a count summary instead of
Meta's payload; RPC failures log PostgREST's code and message, not `details`;
the GST "nameless record" log keeps field names only. Workers Logs retention is
set by the Cloudflare plan; restrict dashboard access to people who need it.

#### Automated security checks (extended)

Tests now also cover body limits, file signatures, parser and archive limits,
log redaction, the staff gate, the public upload route, the OTP hook's staff
check and media serving headers/ranges. CI runs `npm audit --omit=dev
--audit-level=high`, and Dependabot opens weekly update PRs. Still missing:
automated RLS/Storage tests in CI (the matrix was run by hand on a local
database) and public budget exhaustion tests.

## Removal and cleanup recommendations

- Remove obsolete SQL snapshots from deployment paths, or clearly mark them as
  reference-only so historical permissive grants cannot be reapplied.
- Remove unused dependencies and preview artifacts after confirming they are
  not part of a supported workflow.
- Do not document credential values, signed URLs, OTPs, production phone
  numbers, service-role JWTs, webhook secrets or private database identifiers.
- Do not paste secret-retrieval command output into issues, pull requests, chat
  or build logs.

## Verification checklist

- [x] Effective production RLS and Storage policies were exported and reviewed
      (2026-10-05, read-only).
- [ ] Supabase sign-up is disabled in production.
- [ ] Anonymous storage upload is disabled or protected server-side.
- [ ] Vendor-document access is scoped and destructive actions require a role.
- [ ] Only staff accounts reach the API, tables, Storage and the inbox channel.
- [ ] Realtime public channel access is disabled.
- [ ] All upload and import paths enforce byte and type limits.
- [ ] API endpoints have an authorization matrix and corresponding tests.
- [ ] Browser security headers are present on production responses.
- [ ] The CSP is enforced (not report-only).
- [ ] Log samples contain no tokens, OTPs, message bodies or unnecessary PII.
- [x] `npm audit --omit=dev` reports no unaccepted production advisory
      (0 on 2026-10-05; now also a CI job).
- [ ] `npm run check` passes in CI.
- [ ] Incident contacts, credential rotation and rollback procedures are known.

## Review cadence

Repeat the review after changes to authentication, authorization, public forms,
storage, payment/invoice logic, file parsing, webhook processing or cloud
bindings, and at least quarterly. Record accepted risks with an owner and a
review date; never mark a finding complete based only on a documentation edit.
