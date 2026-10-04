# Security Audit and Hardening Plan

Last reviewed: 2026-10-04

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
load testing, access to production data, or validation of live cloud policies.

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

## Findings and required action

### P0: before expanding public traffic

#### Gate anonymous document uploads

The public vendor form uploads directly to Supabase Storage under an anonymous
INSERT policy. That upload occurs before the Worker verifies Turnstile, so an
automated client can consume storage without submitting either public form.

Required change:

1. Move the upload behind a Worker endpoint that verifies a purpose-bound,
   single-use authorization issued after a successful Turnstile check.
2. Enforce a small byte limit before buffering the body.
3. Allow only required file types and verify file signatures, not only the
   caller-provided `Content-Type` or filename.
4. Generate the object key on the server.
5. Remove anonymous INSERT access from `storage.objects` after rollout.
6. Add retention and orphan cleanup for uploads not attached to a vendor.

#### Restrict vendor-document access

Historical storage policies grant authenticated users broad access to objects
in a whole bucket. Replace bucket-wide read/write/delete policies with policies
scoped to an organization, vendor and role. Ordinary users should not be able
to overwrite or delete another vendor's evidence simply by knowing its path.

Before applying a migration, inspect the effective production policies. Do not
assume a schema snapshot exactly matches the live project.

### P1: authorization and availability

#### Add server-side roles and organization scope

The API currently treats any valid Supabase session as a trusted dashboard
operator. Several Postgres policies likewise grant every authenticated user
team-wide access. This is acceptable only while every account is equally
trusted and belongs to one organization.

Introduce an explicit membership table and roles such as `admin`, `finance`,
`sales` and `support`. Enforce permissions in API middleware and RLS. At a
minimum, separately authorize bulk deletion, campaign sends, finance changes,
exports, vendor-document mutation and WhatsApp access.

#### Bound file and archive processing

Contact imports and WhatsApp media uploads buffer complete files. The custom
XLSX reader also inflates archive entries without compressed or expanded-size
ceilings. Add request-size, file-size, row, column, cell-length, archive-entry
and expansion-ratio limits. Reject oversized input before parsing or uploading.

### P2: defense in depth

#### Add browser security headers

Serve a tested Content Security Policy, `frame-ancestors`, HSTS,
`X-Content-Type-Options`, `Referrer-Policy` and a restrictive
`Permissions-Policy`. The current HTML has inline script, style and an inline
event handler; refactor those before enforcing a CSP that excludes
`unsafe-inline`.

#### Minimize personal data in logs

The structured logger redacts common credential fields, but phone numbers,
email addresses, message content and upstream response samples can still be
logged. Default to field allowlists, hash identifiers used for correlation,
and define retention and access controls in the hosting platforms.

#### Build automated security checks

Isolated tests now cover session verification, Turnstile failure, webhook
signature rejection and media-ticket expiry (`tests/`), and CI runs lint,
build, those tests and the secret scan. Still missing: tests for
authorization boundaries, RLS/storage policies, upload limits and public
budget exhaustion, and a dependency audit in CI.

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

- [ ] Effective production RLS and Storage policies were exported and reviewed.
- [ ] Anonymous storage upload is disabled or protected server-side.
- [ ] Vendor-document access is scoped and destructive actions require a role.
- [ ] All upload and import paths enforce byte and type limits.
- [ ] API endpoints have an authorization matrix and corresponding tests.
- [ ] Browser security headers are present on production responses.
- [ ] Log samples contain no tokens, OTPs, message bodies or unnecessary PII.
- [ ] `npm audit --omit=dev` reports no unaccepted production advisory.
- [ ] `npm run check` passes in CI.
- [ ] Incident contacts, credential rotation and rollback procedures are known.

## Review cadence

Repeat the review after changes to authentication, authorization, public forms,
storage, payment/invoice logic, file parsing, webhook processing or cloud
bindings, and at least quarterly. Record accepted risks with an owner and a
review date; never mark a finding complete based only on a documentation edit.
