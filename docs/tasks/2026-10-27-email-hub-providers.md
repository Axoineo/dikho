# Task: Email Hub 2.0, Google and Hostinger mailboxes without SES

Status: active
Owner: Dikho engineering (implementation by Claude Code)
Started: 2026-10-27
Last updated: 2026-10-27

## Goal

Staff read and answer Google Workspace and Hostinger mailboxes in one Email
Hub, and approved, consented campaigns go out from a connected mailbox
within conservative limits, without Amazon SES.

## Why now

SES production access is pending, so the 0009 campaign path sends nothing,
and Hostinger mailboxes (for example contact@dikho.in) were outside Dikho.

## Non-goals

- Changing DNS, MX, AWS or any provider setting.
- A mail server, VPS, IMAP or SMTP.
- Removing SES or Brevo code, secrets or history.
- Automations (no unattended scheduler exists).
- Rotating sends across mailboxes or any way around provider limits.

## Acceptance criteria

See the definition of done in the owner's brief; status per item is in the
phase table and "Verification" below.

## Relevant sources

- Decision: [ADR 0010](../decisions/0010-email-hub-providers.md), amending [ADR 0009](../decisions/0009-email-hub.md)
- Owner setup: [Email Hub setup guide](../runbooks/email-hub-setup-guide.md)
- Hostinger Mail API: https://api.mail.hostinger.com (OpenAPI 1.3.0, read 2026-10-27)
- Code: `src/api/services/email/{providers,hostinger,hostingerMail,mailboxDelivery,routing}.js`,
  `src/api/routes/email/`, `src/features/email/`,
  `supabase/migrations/20261027120000_email_hub_providers.sql`

## Phase 0 audit (2026-10-27)

### Tools

| Tool | State | Use |
| --- | --- | --- |
| Ponytail, Frontend Design, Playwright MCP, Context7 | Not available in this session | Principles applied by hand; browser checks with the built-in pane and local headless Chrome |
| Hostinger Mail MCP | Not connected; no token was provided | Not used. Development used mocks built from the published OpenAPI document |
| Supabase MCP | Connected | Read-only: migration list |
| Cloudflare (wrangler, OAuth) | Signed in | Read-only during this task |
| PostgreSQL 17 (Docker `postgres:17-alpine`, pulled with the owner's approval) | Local, throwaway | `scripts/db/verify-local.sh` |

### Components

| Component | Decision | Notes |
| --- | --- | --- |
| Gmail OAuth (state, PKCE, completion by the starter), token encryption | Keep unchanged | Google connection functions now refuse Hostinger mailboxes |
| Gmail client, sync, push, render, drafts, labels, send-as | Keep unchanged | Gmail errors now keep the provider status and reason (for campaign limits) |
| Mailbox ACL (`em_access`, memberships, no self-grant) | Keep unchanged | Applies to both providers |
| Thread cache `email_threads`, notes, links, assignment, list/search | Keep unchanged | Hostinger conversations are projected onto it (Gmail-style system labels) |
| Mailbox identity | Extend | `provider` widened to `hostinger`; `provider_account_id`; provider fixed at creation |
| Routes calling Gmail | Refactor | Capability check first; Hostinger branches for open, render, flags, attachments, send |
| Provider model | New | `providers.js`: capabilities with reasons, no class hierarchy |
| Hostinger adapter | New | `hostinger.js` (client), `hostingerMail.js` (sync, read, flags, attachments, send) |
| Hostinger message index | New | `email_provider_messages`, metadata only |
| Inbound routing check | New | `routing.js`, DNS over HTTPS, read-only |
| Campaign engine (consent, snapshot, approval, recipients, budget) | Extend | Sender mailbox, per-mailbox limit and cooldown, sender re-checked each batch |
| Campaign dispatcher | Refactor | Mailbox path; SES path kept but not claimed while SES is off |
| `EmailDeliveryService` (SES, Brevo) | Retain as optional legacy | SES off; Brevo keeps system email |
| SNS webhook, SES events, `email_delivery_events` | Retain as optional legacy | Only meaningful with SES |
| Request-driven dispatch and `/jobs/run` | Keep unchanged | Cron still does not fire; "Send next batch now" added |
| Screens | Extend | Settings, inbox, conversation, composer, campaign editor follow capabilities |

### Findings that shaped the design

- Hostinger API: bearer token per order, optionally per mailbox; IMAP
  folders and UIDs; send answers 204 with no id; no drafts, labels, aliases,
  custom headers or Reply-To on send; webhook `message.received` with an
  undocumented payload and bearer-secret authentication.
- Schema: `email_threads.gmail_thread_id` must be 1 to 32 hex characters, so
  Hostinger thread keys are a 32-hex digest of the root Message-ID.
  `em_list_threads` filters on Gmail system labels, so the projection reuses
  them.
- `em_sync_due` orders never-synced mailboxes first; a provider that cannot
  sync would starve Google mailboxes. Hostinger sync was built in the same
  change, so this does not arise.
- Personal Hostinger mailboxes have no per-person sign-in. Ownership is the
  person's own verified Dikho sign-in address; otherwise only shared.
- DNS (public, read-only): MX `smtp.google.com` only, DNS at Hostinger, no
  SPF, no Google DKIM, Hostinger DKIM present, two DMARC records.
- Existing open findings unrelated to this task are unchanged (see
  `docs/SECURITY-AUDIT.md`).

## Plan and status

| ID | Task | Status |
| --- | --- | --- |
| EH2-0 | Audit (this document), ADR 0010 | done |
| EH2-1 | Provider capability model; Gmail-only routes refuse other providers before any provider call | done |
| EH2-2a | Hostinger client and connection (discovery via /me, shared and personal) | done |
| EH2-2b | Hostinger sync, conversations, flags, attachments, send/reply/forward | done |
| EH2-2c | Hostinger webhooks | not built: payload undocumented, would need a stored per-webhook secret |
| EH2-2d | Hostinger archive (move) and provider-side search | not built |
| EH2-3 | Unified inbox with provider badges and capability-aware controls | done |
| EH2-4 | Campaigns from a connected mailbox, per-mailbox limit, cooldown, pause | done |
| EH2-5 | Templates and CRM workflows on the new sending layer | not started: templates unchanged; no automated sends (no scheduler) |
| EH2-6 | UI refinement and responsive/theme checks | done for changed screens |
| EH2-7 | Production-readiness review and setup guide | done in the repository; nothing applied or deployed |

## Decisions made

- 2026-10-27: Provider fixed per mailbox; never inferred from the domain.
- 2026-10-27: One Hostinger token as a Worker secret, not per-mailbox
  credentials in the database.
- 2026-10-27: Hostinger conversations derived from headers in the database;
  subjects never join, no after-the-fact merges.
- 2026-10-27: Campaigns need a mailbox allowed for campaigns with its own
  limit; approval covers the sender; one sender per campaign.
- 2026-10-27: Receiving reported separately from connection, from MX
  records, read-only.

## Verification

| Check | Result | Evidence/notes |
| --- | --- | --- |
| `npm run check` | pass | lint 0 errors, 25 warnings (as before); 227/227 tests; build; secret scan |
| New Node tests | pass | `tests/email-providers.test.js` (30), `tests/email-campaign-mailbox.test.js` (13), readiness test rewritten in `tests/email-delivery.test.js` |
| `scripts/db/verify-local.sh` on PostgreSQL 17 | pass | all 27 migrations; `email_hub_mailboxes.sql`, `email_hub_campaigns.sql`, new `email_hub_providers.sql` |
| Migration re-applied | pass | idempotent; no duplicate function overloads; no `em_*` grants to anon/authenticated/public; every security-definer `em_*` pins `search_path`; RLS on both new tables |
| Build with `VITE_EMAIL_HUB=true` | pass | Email routes present; no Hostinger token name or API host in the browser bundle |
| Browser, synthetic data | pass | `scripts/preview/email-hub.html`: Settings, Hostinger conversation and composer, campaign sender picker; 1440 px and 375 px; light and dark; no horizontal page overflow; no console errors |
| Real Hostinger, Gmail, DNS over HTTPS | not run | no credentials in this session; nothing sent |
| Production | not touched | no migration applied, nothing deployed or pushed |

## Risks, blockers and rollback

- Blocker (owner): Hostinger API token (setup guide steps 1 to 4, 9).
- Blocker (owner): Google OAuth client and `APP_URL` for Google mailboxes.
- Blocker (owner): migration `20261027120000` before deploying this API.
- Risk: deliverability from dikho.in without SPF and Google DKIM, and with two
  DMARC records. Fix DNS before any campaign.
- Risk: Hostinger mailboxes on dikho.in receive no outside mail while MX is
  Google only, unless split delivery is set up.
- Risk: mailbox providers may limit or suspend a mailbox that sends bulk
  mail. Limits start low; campaign use is per mailbox and audited.
- Rollback: [setup guide, step 18](../runbooks/email-hub-setup-guide.md#18-roll-back-safely).

## Completion handoff

Code, tests and documentation are on branch `feat/email-hub-providers`.
Nothing has been applied, deployed, pushed or sent. Next: owner review of
ADR 0010 and the migration, the setup guide steps, then a pilot with one
Hostinger mailbox and a test campaign to staff addresses.
