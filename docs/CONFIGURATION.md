# Configuration Reference

Last reviewed: 2026-10-21

This inventory describes variable names and code consumers. It intentionally
contains no credentials, private resource identifiers or production contact
details. Values belong in the deploying organization's own environment and
secret stores. Source inspection does not verify what is configured in a live
deployment.

See [Deployment](DEPLOYMENT.md) for rollout order,
[Architecture](ARCHITECTURE.md) for service boundaries and
[Credential rotation](runbooks/credential-rotation.md) for incident handling.

## Where configuration belongs

| Configuration class | Local location | Hosted location | Visibility |
| --- | --- | --- | --- |
| Browser build settings | Ignored `.env.local`, based on [`.env.example`](../.env.example) | Cloudflare Pages build environment | Public in downloaded JavaScript |
| API Worker secrets | Ignored `.dev.vars` | API Worker secret store | Server only |
| API Worker non-secret settings | Local Worker configuration/overrides | Reviewed [API Wrangler configuration](../wrangler.api.jsonc) or environment configuration | Operational settings; do not publish private environment identifiers |
| Cloudflare resource bindings | Wrangler local resources | Per-instance D1/R2/rate-limiter bindings | Server resource handles, not API keys |
| Supabase Edge Function secrets/settings | Local Supabase function environment | Supabase function secret store and platform-provided environment | Server only |
| Branding | See [Branding](BRANDING.md) | Browser build/assets and explicitly documented server copy | Anything displayed by the browser is public |

Do not place server credentials in JSON branding files, screenshots, Markdown,
client-side storage or any variable beginning with `VITE_`. An API key's field
name being public does not make its value safe to publish.

## Browser build variables

All `VITE_` values are public, including values whose names look confidential.
Changing these values requires rebuilding and redeploying the SPA.

| Name | Consumer | Requirement / current behavior |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | [Supabase client](../src/lib/supabase.js) | Required; use the adopting organization's project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | [Supabase client](../src/lib/supabase.js) | Required public publishable key; access is constrained by RLS, never replace with a service-role key |
| `VITE_API_BASE` | [API client](../src/lib/api.js) | API origin without a trailing slash or `/api`; set explicitly because code currently falls back to the existing Dikho API origin ([apiBase.js](../src/lib/apiBase.js)) when unset |
| `VITE_EMAIL_HUB` | [Navigation and routes](../src/lib/access.js) | `true` builds the Email Hub's navigation and routes; anything else leaves them out of the bundle. Navigation only, not a security boundary: the API enforces `EMAIL_HUB_ENABLED` and every permission and mailbox membership |
| `CSP_MODE` | [Build config](../vite.config.js) (build-time only, never in the bundle) | Unset: the generated `dist/_headers` sends `Content-Security-Policy-Report-Only`. `enforce`: sends the enforcing header. The policy's Supabase and API origins come from `VITE_SUPABASE_URL` and `VITE_API_BASE` |

The public Turnstile site key is currently a source constant in
[vendor registration](../src/features/public/PublicVendorForm.jsx) and
[corporate-gifting intake](../src/features/public/PublicClientWelcome.jsx).
There is currently no `VITE_TURNSTILE_SITE_KEY` consumer. Extracting that setting
is still required before a clean self-hosted installation can be configured
without source edits. The site key is public; its matching secret is not.

## API Worker identity and intake

These names are read from the API Worker's `env`, independently of the SPA build
environment. Supplying a `VITE_` value does not configure its server counterpart.

| Name | Class | Consumer / behavior |
| --- | --- | --- |
| `SUPABASE_URL` | Server setting; public URL | [Session verification](../src/api/middleware/requireAuth.js), public-write RPCs and realtime broadcasts; required for those features |
| `SUPABASE_ANON_KEY` | Publishable/anonymous credential used server-side; not a service-role secret | [Session verification](../src/api/middleware/requireAuth.js) (sent with the caller's token to `my_access()`); missing auth configuration rejects protected requests |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret, privileged | [Public-write RPCs](../src/api/services/supabaseRpc.js), [public document storage](../src/api/services/supabaseStorage.js), [private inbox broadcasts](../src/api/services/whatsapp/realtime.js), and [User Management](../src/api/services/userAdmin.js) (the `um_*` functions, creating and banning sign-in accounts, sign-out notices); never browser-visible |
| `APP_URL` | Server setting | Dashboard address written into the [staff welcome email](../src/api/services/staffWelcome.js) and as the Email Hub's return page after Google sign-in (`<APP_URL>/email/connect`, which finishes the connection with the person's session); without it the email names no link and mailbox connection cannot finish |
| `BREVO_API_KEY` | Optional secret, legacy | Staff welcome email from the API Worker when Amazon SES is not ready (see Email delivery below). Separate from the Edge Function's copy; with neither provider ready, welcome messages go by WhatsApp or not at all |
| `BREVO_SENDER_EMAIL` | Server setting, legacy | Verified sender for Brevo; required with `BREVO_API_KEY` |
| `ALLOWED_ORIGINS` | Server setting | [API CORS](../src/api/middleware/cors.js); comma-separated exact browser origins; empty means no allowed cross-origin browser origin |
| `TURNSTILE_SECRET` | Secret | [Turnstile verifier](../src/api/services/turnstile.js); required for public form writes |
| `TURNSTILE_HOSTNAMES` | Server setting | Comma-separated hostnames, without scheme/path; required, with expected action checks; missing allowlist or secret fails closed |

Origins and hostnames are different: an origin has a scheme and optional port,
such as `https://workspace.example.com`; a hostname is `workspace.example.com`.
CORS controls browser response access, not who can call a route. Authentication
and [permissions](PERMISSIONS.md) remain separate requirements.

## API Worker WhatsApp integration

| Name | Class | Consumer / requirement |
| --- | --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Secret | [Graph client](../src/api/services/whatsapp/graph.js) and media integration; required for provider requests |
| `WHATSAPP_APP_SECRET` | Secret | [Webhook signature verifier](../src/api/services/whatsapp/verifyMetaSignature.js) and [media tickets](../src/api/services/whatsapp/mediaTicket.js); rotation affects both |
| `WHATSAPP_VERIFY_TOKEN` | Secret | [Webhook verification handshake](../src/api/routes/whatsapp/webhook.js); must match provider setup |
| `WHATSAPP_PHONE_NUMBER_ID` | Server-side provider identifier | Graph message/media requests; use this instance's provider resource; do not copy an existing installation's value |
| `WHATSAPP_WABA_ID` | Server-side provider identifier | Approved template lookup for this organization's business account |
| `SUPABASE_SEND_SMS_HOOK_SECRET` | Secret | [OTP hook](../src/api/routes/auth/index.js); required to verify Supabase's signed hook requests |
| `WHATSAPP_AUTH_TEMPLATE_NAME` | Server setting | Approved authentication template; code has a Dikho-specific fallback that adopters must override |
| `WHATSAPP_AUTH_TEMPLATE_LANG` | Server setting | Authentication template language; defaults to `en` |
| `WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME` | Server setting | Approved UTILITY template for the staff welcome message when no email can be sent. Unset: no WhatsApp welcome. Body has one variable, the first name. Before each send the [sender](../src/api/services/staffWelcome.js) reads the approved template from Meta, uses its language, and sends nothing if it needs more values than that |
| `WHATSAPP_STAFF_WELCOME_TEMPLATE_LANG` | Server setting | Staff welcome template language; defaults to `en` |
| `WHATSAPP_STATIC_TEMPLATE_NAME` | Server setting | [Template-list fallback](../src/api/routes/templates/index.js) used when provider lookup fails/returns no templates; code has an installation-specific default |
| `WHATSAPP_STATIC_TEMPLATE_LANG` | Server setting | Fallback template language; defaults to `en` |
| `WHATSAPP_CG_LEAD_TEMPLATE_NAME` | Server setting | [Lead confirmation sender](../src/api/services/whatsapp/cgLeadConfirmation.js); defaults to an existing-installation template name; override for an adopter |
| `WHATSAPP_CG_LEAD_TEMPLATE_LANG` | Server setting | Lead confirmation template language; defaults to `en` |
| `WHATSAPP_CG_LEAD_DELAY_MINUTES` | Server setting | Non-negative minutes before confirmation; code defaults to 7 for absent/invalid values and rounds down; an empty string becomes 0 |
| `WHATSAPP_CG_LEAD_DAILY_CAP` | Cost-control setting | Positive daily send ceiling in UTC; absent/invalid values prevent sends; the explicit string `0` disables the ceiling rather than disabling the feature |
| `CAMPAIGN_BATCH_LIMIT` | Resource setting | [Campaign sender](../src/api/routes/campaigns/index.js); numeric value with fallback 40; no complete range validation exists |
| `CAMPAIGN_CONCURRENCY` | Resource setting | Campaign send lanes; numeric value with fallback 5; no complete range validation exists |

Set explicit positive resource limits reviewed against the deployed runtime.
Do not use a cap of zero as a feature-disable switch. The public-confirmation
daily cap does not establish a global daily budget for all dashboard campaigns.

A fallback template appearing in the UI does not prove the provider has approved
it or that sending works. Confirm template names, languages and components in
the adopting organization's account. Missing WhatsApp credentials do not
currently produce a complete, intentional module-disabled experience. See
[WhatsApp authentication](whatsapp-auth.md).

### Staff welcome template

Submit in Meta's WhatsApp Manager as category **Utility**, then set
`WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME` to its name (this installation:
`staff_registration_conformation`, English, in `wrangler.api.jsonc`).
Suggested text (one body variable, no buttons, no links that carry tokens):

> Hi {{1}}, you have been added to Dikho CRM. To sign in, open the Dikho
> dashboard and choose WhatsApp: we will send a one-time code to this number.
> There is no password.

Sends are limited by the database to one per person per 10 minutes and 30 per
day across the workspace, claimed before anything is sent.

## API Worker GST lookup

| Name | Class | Consumer / behavior |
| --- | --- | --- |
| `APISETU_CLIENT_ID` | Server-side provider identifier | [API Setu client](../src/api/services/apisetu/client.js); required alongside API key |
| `APISETU_API_KEY` | Secret | API Setu subscription authentication; missing key returns a configuration failure |
| `APISETU_REFERER` | Server setting | Optional outgoing referer for the provider's domain restriction; omitted if empty |
| `GSTN_DAILY_CAP` | Cost-control setting | [GST lookup route](../src/api/routes/gstn/index.js); positive UTC daily upstream request ceiling; missing/invalid/non-positive cap, missing D1 or budget-query failure currently bypasses the global ceiling |

The GST edge limiter is also a required operational safeguard for public
traffic. Its missing-binding behavior currently leaves the endpoint without
that limiter. These fail-open cases are implementation limitations, not a
recommended deployment configuration.

## API Worker Email Hub

The module answers `404` unless `EMAIL_HUB_ENABLED=true`, except the
unsubscribe link and the SES event webhook, which stay on so links already
sent keep working and bounces keep being recorded. Each integration below
reports ready or not ready by presence only; a missing setting switches that
part off instead of half-working. Design: [ADR 0009](decisions/0009-email-hub.md).

| Name | Class | Consumer / behavior |
| --- | --- | --- |
| `EMAIL_HUB_ENABLED` | Server setting | `true` turns the [module](../src/api/routes/email/index.js) on; anything else, off |
| `GOOGLE_CLIENT_ID` | Server-side provider identifier | Google OAuth client (Web application, Internal user type) for connecting mailboxes |
| `GOOGLE_CLIENT_SECRET` | Secret | OAuth code exchange and token refresh |
| `GOOGLE_OAUTH_REDIRECT_URI` | Server setting | Exactly `https://<API origin>/api/email/oauth/google/callback`, also registered on the OAuth client; must be `https` |
| `GOOGLE_WORKSPACE_DOMAIN` | Server setting | Optional. When set, only accounts of this Google Workspace domain may connect (checked on the ID token's `hd` claim and the address) |
| `EMAIL_TOKEN_KEY` | Secret | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts Gmail refresh tokens (AES-256-GCM, mailbox address as associated data), and derives render/preview tickets and unsubscribe signatures. Without it no mailbox can connect and campaigns cannot send |
| `EMAIL_TOKEN_KEY_PREVIOUS` | Secret | Optional. The key being rotated out, used for decryption only: tokens it encrypted keep working, and a mailbox stores a token under the new key only when it is reconnected. Keep it until every mailbox has reconnected. Unsubscribe links signed with it keep working while it is set; render and preview tickets use the current key only, so open previews simply expire |
| `GOOGLE_PUBSUB_TOPIC` | Server-side provider identifier | Optional, `projects/<project>/topics/<topic>` that Gmail `watch` publishes to. Without the three Pub/Sub settings, mailboxes refresh when someone opens Email or presses Sync |
| `GOOGLE_PUBSUB_AUDIENCE` | Server setting | The push subscription's OIDC audience; the [push verifier](../src/api/services/email/googleJwt.js) requires it |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | Server setting | The push subscription's service account email; tokens from any other account are refused |
| `EMAIL_SYNC_DAYS`, `EMAIL_SYNC_MAX_THREADS` | Resource settings | First-sync window (default 60 days, 1 to 365) and size (default 150 threads, 10 to 500), sized for the Workers Free subrequest limit |
| `EMAIL_JOBS_SECRET` | Secret | Optional, at least 32 characters. Lets an external scheduler call `POST /api/email/jobs/run` (bearer token) to send the next campaign batch and refresh one due mailbox. Unset: the route refuses every call |

### Email delivery (system email and campaigns)

[`delivery.js`](../src/api/services/email/delivery.js) sends mail written by
Dikho itself. Amazon SES is the primary provider; Brevo is used only while it
is configured and SES is not ready. Campaigns use SES only.

| Name | Class | Consumer / behavior |
| --- | --- | --- |
| `EMAIL_PROVIDER` | Server setting | `ses` or `brevo` forces one provider; unset picks SES when ready, else Brevo when configured |
| `EMAIL_FROM_ADDRESS` | Server setting | Verified SES sender for system email, e.g. `noreply@<domain>`; also the default campaign sender |
| `EMAIL_FROM_NAME` | Server setting | Display name; defaults to the organization name in code |
| `AWS_SES_REGION` | Server setting | SES region, e.g. `ap-south-1` |
| `AWS_SES_ACCESS_KEY_ID` | Server-side credential identifier | IAM user limited to `ses:SendEmail` on the verified identity and configuration set |
| `AWS_SES_SECRET_ACCESS_KEY` | Secret | Matching secret key |
| `AWS_SES_CONFIGURATION_SET` | Server setting | Configuration set whose event destination publishes to SNS; without it no delivery, bounce or complaint events arrive |
| `EMAIL_SES_SEND_ENABLED` | Safety switch | `true` only after the identity, production access, IAM policy and events are verified. Anything else: SES is never called |
| `AWS_SNS_TOPIC_ARN` | Server setting | The only SNS topic the [SES webhook](../src/api/routes/email/index.js) accepts (signature, certificate host and topic are all checked) |
| `API_PUBLIC_URL` | Server setting | `https` origin of the API Worker, used to build unsubscribe links; campaigns do not send without it |
| `EMAIL_DAILY_CAP` | Cost-control setting | Positive ceiling on campaign and test emails per UTC day, enforced in the database. Missing or invalid: campaigns do not send |
| `EMAIL_CAMPAIGN_SENDERS` | Server setting | Comma-separated From addresses campaigns may use (each verified in SES); defaults to `EMAIL_FROM_ADDRESS` |
| `EMAIL_CAMPAIGN_MAX_RECIPIENTS` | Cost-control setting | Per-campaign recipient limit, default 5,000, at most 50,000 |
| `EMAIL_FOOTER_ADDRESS` | Server setting | Optional postal address shown in the campaign footer |

Campaign readiness is reported on the Campaigns page by name only (for example
"Amazon SES sending"), never with a value. Approval works while sending is not
ready; nothing is sent until every item is present.

## Cloudflare bindings and scheduled work

| Binding / setting | Owner | Purpose |
| --- | --- | --- |
| `DB` | API Worker | D1 contacts, campaigns, conversations, events, budgets and outbox; requires the ordered [D1 migrations](../migrations/) |
| `MEDIA` | API Worker | Private R2 storage for WhatsApp media and publicly readable avatar objects through restricted routes |
| `GSTIN_RATE_LIMITER` | API Worker | Edge rate-limit binding used by public GST lookup |
| `ASSETS` | Standalone SPA Worker | [`src/worker.js`](../src/worker.js) uses it for asset fallback, but [`wrangler.jsonc`](../wrangler.jsonc) does not declare it. Production serves the SPA from Cloudflare Pages and does not use this Worker |
| `triggers.crons` | API Worker | Scheduled outbox dispatch, receipt reconciliation and (when the Email Hub is on) the next campaign batch; registered, but not firing on the current plan (see below), so the API also performs this work on ordinary requests |

Resource names, account/project IDs and bucket identifiers must point to the
adopter's own environment. Do not reproduce existing private values in a setup
guide. The legacy D1 declaration in [SPA Wrangler configuration](../wrangler.jsonc)
does not make the SPA the owner of WhatsApp data; the application boundary is
the standalone API Worker.

Cron configuration is not evidence that jobs execute successfully. On the
current Cloudflare Workers Free plan the cron triggers deploy and are listed but
have never dispatched: on 2026-10-01 a queued probe row stayed pending well
past its due time and `wrangler tail` recorded no scheduled invocations. The
delayed-confirmation dispatcher, the receipt reconciler and email campaign
batches therefore also run from ordinary API requests, throttled per isolate, so queued work waits for the
next request when there is no traffic. Do not build features that need
guaranteed timing on cron, and after any plan change re-run a probe before
trusting it. See [Deployment](DEPLOYMENT.md) and
[the scheduled handler](../src/api/worker.js).

## Supabase Edge Function configuration

The [device-check function](../supabase/functions/device-check/index.ts) uses a
separate environment from the Cloudflare Worker.

| Name | Class | Requirement / behavior |
| --- | --- | --- |
| `SUPABASE_URL` | Platform-provided setting | Project URL used for user verification and server writes |
| `SUPABASE_ANON_KEY` | Platform-provided public credential | Used with the caller's JWT to validate identity |
| `SUPABASE_SERVICE_ROLE_KEY` | Platform-provided privileged secret | Server-only device/login writes after verifying the caller |
| `ALLOWED_ORIGINS` | Server setting | Exact comma-separated browser origins; missing configuration falls back to the local Vite origin, unsuitable for production |
| `BREVO_API_KEY` | Optional secret | Enables new-device alert email; missing key skips the email without blocking login |
| `BREVO_SENDER_EMAIL` | Server setting | Verified sender when alert email is enabled; current fallback is Dikho-specific and must be overridden for another organization |

The security email's sender display name, subject and body also contain
organization-specific copy in source. Updating `BREVO_SENDER_EMAIL` alone does
not rebrand that message.

## Safe setup and verification

1. Provision separate staging resources with synthetic data and this
   organization's own accounts. Keep local environment files ignored.
2. Set public build settings and server settings in their respective places.
   Enter Worker secret values interactively using the approved secret store;
   never include them in a command argument, issue or shared transcript.
3. Configure public-form hostnames, API/Edge origins, provider callbacks,
   approved templates and explicit positive cost/resource limits.
4. Review migration ordering and resource ownership before any remote apply.
   Applying migrations or deploying requires the owner's authorization.
5. Run `npm run check`, then exercise enabled integrations in staging using the
   cases from [Testing](TESTING.md). Avoid real outbound messages without
   explicit authorization.
6. Check readiness by presence/absence and sanitized outcomes. Never print a
   secret, token, resource ID or full environment to diagnose configuration.

There is no central runtime configuration validator or complete installation
wizard yet. Disabled modules, missing settings and invalid numeric values do
not all have consistent handling. A distributable release must add validation,
safe module-disable behavior and a documented clean installation test before
claiming that adding keys and a logo is sufficient.

Legacy utilities may refer to AWS/S3 or other variables that the running React
application and API Worker do not consume. They are not additional installation
requirements. Do not run old probes or populate their credentials as a setup
step; [Testing](TESTING.md) describes their limitations.
