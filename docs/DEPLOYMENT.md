# Deployment and Operations Guide

Last updated: 2026-10-04

Dikho has four independently deployed parts:

1. the browser SPA, served by Cloudflare Pages and released by pushing to
   `main`;
2. the standalone API Worker with D1/R2/rate-limit bindings;
3. Supabase PostgreSQL migrations and the `device-check` Edge Function;
4. external provider configuration for Auth, WhatsApp, Turnstile, GST lookup
   and optional alert email.

Use placeholders in tickets and documentation. Never paste credential values,
OTP values, signed URLs, resource IDs or production user data into deployment
logs or chat.

## Prerequisites

- reviewed commit and clean lockfile installation;
- authorized Cloudflare and Supabase CLI sessions;
- approved access to provider consoles;
- backup/rollback plan for database or policy changes;
- development or staging smoke-test results;
- current secret inventory owned by the operations team.

## Pre-deployment validation

```bash
npm ci
npm run check
npm audit --omit=dev
```

`npm run check` includes the tests in `tests/`. They cover isolated security
helpers only (session verification, Turnstile, webhook signatures and media
tickets), so still perform the manual checks listed below.

## Configuration classes

### Browser-public build variables

These are embedded into JavaScript and visible to all users:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase public project API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `VITE_API_BASE` | API Worker public origin |

No secret may use a `VITE_` prefix.

### API Worker secrets

Store these with the Cloudflare secret mechanism, entering values
interactively:

- Meta access/app credentials and webhook verification material;
- Supabase hook signing secret and service-role key;
- Turnstile secret;
- GST provider API key;
- any future private integration credential.

Use commands shaped like:

```bash
npx wrangler secret put <SECRET_NAME> -c wrangler.api.jsonc
```

Do not place a value in the command, documentation or shell history. Do not use
a command that retrieves and prints an existing secret merely to copy it.

### API Worker non-secret configuration

Non-secret values include explicit allowed origins/hostnames, public provider
client identifiers, template names/languages, batch/concurrency settings and
daily caps. These may live in configuration when environment-specific values
are appropriate, but avoid documenting production-specific identifiers.

### Supabase Edge Function secrets

The platform injects its server credentials into the Edge Function. Configure
the browser-origin allowlist and optional mail provider credentials through
Supabase's secret store. Production must never rely on the local fallback
origin.

## Deploy the API Worker

The API Worker uses `wrangler.api.jsonc` and `src/api/worker.js`.

1. Confirm the correct account/environment.
2. Verify secrets exist by name without retrieving their values.
3. Verify D1, R2 and rate-limiter bindings target the intended environment.
4. Apply pending D1 migrations.
5. Deploy and inspect sanitized health/log output.

```bash
npx wrangler d1 migrations apply <database-name> --remote -c wrangler.api.jsonc
npm run deploy:api
```

Do not copy a database identifier into documentation. Resolve it through the
reviewed environment configuration.

## Deploy the SPA

Production serves the SPA from a Cloudflare Pages project connected to this
repository. Every push to `main` builds the Vite `dist/` output and deploys it
to production, usually within about a minute. **A push to `main` is a
production release**: verify the change locally first, and never push to find
out whether something works.

Confirm a release landed by checking that its commit is the active production
deployment:

```bash
npx wrangler pages deployment list --project-name <pages-project>
```

Comparing the hashed `assets/index-*.js` name in the live page with the one in
a local `dist/index.html` built from the same commit is a quick second check.
Also confirm the bundle uses the expected public API origin and contains no
privileged configuration.

`wrangler.jsonc`, `src/worker.js`, `npm run preview` and `npm run deploy`
belong to a standalone SPA Worker that production does not use. `npm run
deploy` succeeds but does not change the live site, so never use it as a
release step.

## Deploy Supabase changes

### PostgreSQL migrations

Review pending migrations, confirm the target project, take the required backup
and apply through the approved Supabase workflow. Never apply a historical
schema snapshot as a shortcut.

Policy changes require explicit verification as `anon` and `authenticated`
after deployment. A successful SQL command does not prove correct access.

### Device-check Edge Function

```bash
supabase functions deploy device-check
```

Set `ALLOWED_ORIGINS` to the exact production browser origins. Configure the
optional mail provider only through the Supabase secret store. Confirm an
unknown origin receives no access-control origin header.

## Public-form lockdown rollout

Public writes depend on coordinated code and database permissions. Safe order:

1. Configure the API Worker secret names and non-secret allowlists.
2. Deploy the API routes that verify Turnstile and call the narrow RPCs.
3. Deploy the SPA that submits through those API routes.
4. Verify both public forms end to end with test records.
5. Apply the migration that removes browser-role RPC execution.
6. Re-test success, rejected/missing token and direct-RPC denial.

Applying the permission lockdown before the new SPA/API path is live breaks
submissions. Deploying the new SPA before required secrets exist also breaks
submissions because verification intentionally fails closed.

The vendor-document upload is not yet protected by this flow; it still uses an
anonymous Storage INSERT policy. Do not describe the public forms as fully
Turnstile-protected until the upload is moved server-side and anonymous object
mutation is removed.

## WhatsApp OTP rollout

1. Confirm an approved authentication template exists in the provider console.
2. Enable phone authentication and configure an appropriate OTP length/expiry.
3. Configure the Send SMS hook to the API Worker endpoint.
4. Store the generated hook signing secret and required Meta credentials in the
   API Worker secret store.
5. Deploy the API Worker.
6. Test with an authorized test user and confirm an unknown number gets no OTP.
7. Confirm invalid signatures are rejected and OTP values never appear in logs.

See [WhatsApp login](whatsapp-auth.md) for functional details.

## Security headers

The repository does not yet enforce a complete browser security-header set.
Before enabling a strict Content Security Policy, remove/refactor inline script,
style and event-handler requirements. Then deploy and test:

- `Content-Security-Policy`, including restrictive `frame-ancestors`;
- `Strict-Transport-Security` on HTTPS production hosts;
- `X-Content-Type-Options: nosniff`;
- a conservative `Referrer-Policy`;
- a minimal `Permissions-Policy`.

Roll out CSP in report-only mode first, examine violations without collecting
sensitive URL/query data, then enforce.

## Production smoke tests

### Public

- SPA routes load directly and on refresh.
- Public forms accept a valid challenge and reject missing/replayed tokens.
- Direct browser-role calls to protected write RPCs are denied.
- GST lookup rejects malformed/checksum-invalid input and respects budget errors.
- Anonymous Storage upload remains recorded as a known risk until remediated.

### Authenticated

- Authorized email and WhatsApp OTP users can sign in.
- Unknown users cannot create themselves through OTP.
- Invalid/expired sessions receive 401 from protected API routes.
- Contacts, campaigns and inbox flows operate with expected access.
- Media URLs require a valid unexpired ticket.
- Bulk deletion and campaign send access are tested against the current trusted
  user model and will require role tests once RBAC is added.

### Webhooks and jobs

- Invalid Meta and Supabase hook signatures are rejected.
- Duplicate webhook delivery does not duplicate state.
- Delayed sends and receipt reconciliation progress. Cron triggers do not fire
  on the current Workers plan, so this relies on ordinary API traffic; see
  [Configuration](CONFIGURATION.md#cloudflare-bindings-and-scheduled-work).
- Daily caps stop further upstream spend without exposing internal details.

## Rollback

- Prefer deploying the previous reviewed application version for code rollback.
  For the SPA, roll back to a previous production deployment in Cloudflare
  Pages, then revert the commit on `main` so the next push does not redeploy
  it. For the API Worker, use `wrangler rollback` or redeploy the last good
  commit.
- Database rollbacks must be forward migrations; do not rewrite migration
  history or use destructive resets.
- Do not restore anonymous/public grants as a convenience rollback. If a secure
  path fails, disable the affected feature or restore the compatible server
  version while preserving least privilege.
- Rotate any credential that may have appeared in logs or an incorrect bundle.

## Incident checklist

1. Contain the affected route/integration without destroying evidence.
2. Revoke/rotate exposed credentials through the owning provider.
3. Preserve sanitized logs and relevant idempotency/audit records.
4. Determine whether messages were sent, files accessed or data changed.
5. Patch, test and deploy through the normal reviewed path.
6. Complete any contractual/legal notification process.
7. Record root cause and add a regression test.

## Release checklist

- [ ] The change was verified locally before it was pushed to `main`.
- [ ] Correct cloud account and project confirmed.
- [ ] Secret values are absent from source, docs and build output.
- [ ] D1/Supabase migrations reviewed, backed up and ordered.
- [ ] Effective RLS and Storage policies verified after apply.
- [ ] API and SPA use the intended origins and bindings.
- [ ] Production origin/hostname allowlists exclude local development hosts.
- [ ] Public forms, OTP, authenticated API and media access smoke-tested.
- [ ] Logs contain no tokens, OTPs, message bodies or unnecessary PII.
- [ ] Open findings in [Security audit](SECURITY-AUDIT.md) were considered.
- [ ] Rollback owner and procedure are known.

## Known operational gaps

- anonymous vendor-document upload is outside the Turnstile boundary;
- historical Storage policies need least-privilege replacement;
- API and database access do not yet implement role/organization separation;
- uploads/imports need stronger resource limits;
- browser security headers and automated security regression tests are missing;
- no complete backup/restore and retention runbook is stored in this repository.
