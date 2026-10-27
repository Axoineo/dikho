# Email Hub setup guide: Google Workspace and Hostinger mailboxes

For the owner of Dikho, step by step. Design: [ADR 0010](../decisions/0010-email-hub-providers.md)
(amends [ADR 0009](../decisions/0009-email-hub.md)). Every step that changes
something outside this repository (hPanel, Google Cloud, DNS, Cloudflare,
Supabase) is yours to approve and do. Menu names in hPanel, Google and
Cloudflare change over time: they are given as found in October 2026.

Never paste a token, secret or password into chat, a ticket, a commit or a
command line. Enter secrets only where the steps say, interactively.

## What you get, and what you do not

| | Google Workspace mailbox | Hostinger mailbox |
| --- | --- | --- |
| Read, search the synced list, open conversations | yes | yes |
| Reply, reply all, forward, new mail, attachments | yes | yes |
| Read/unread, star | yes | yes |
| Archive, labels, drafts, send-as aliases | yes | no (the Hostinger API has no labels, drafts or aliases; archive not built yet) |
| Search older mail at the provider | yes | no: search covers what Dikho synced; use Hostinger Webmail for older mail |
| New mail appears | within seconds with Pub/Sub, else when someone uses Email | when someone uses Email, or "Sync now" |
| Campaigns from this mailbox | yes, with one-click unsubscribe header | yes, unsubscribe link in the footer only, no separate reply-to |
| Bounce and complaint reports to Dikho | no | no (only Amazon SES reports these) |

Amazon SES is not needed. It stays off (`EMAIL_SES_SEND_ENABLED` unset).
Brevo keeps sending staff welcome emails as it does today.

## State on 2026-10-27

- Email Hub switched on: API secret `EMAIL_HUB_ENABLED=true`, Pages
  variable `VITE_EMAIL_HUB=true`, `EMAIL_TOKEN_KEY` set. Production runs the
  API from before this guide's code.
- Not set: any Google setting, `APP_URL`, `API_PUBLIC_URL`,
  `EMAIL_DAILY_CAP`, `HOSTINGER_MAIL_API_TOKEN`.
- Migration `20261027120000_email_hub_providers.sql` is not applied.
- DNS for dikho.in, read from public DNS: MX is `smtp.google.com` only (all
  outside mail goes to Google); the DNS host is Hostinger
  (`ns1/ns2.dns-parking.com`); there is **no SPF record**; there is **no
  Google DKIM record** (`google._domainkey`); Hostinger DKIM records exist;
  there are **two DMARC records**, which receivers treat as none.

## 1. Open Hostinger hPanel

Sign in at https://hpanel.hostinger.com with the account that owns the
dikho.in email order.

## 2. Turn on Agentic Mail / API access

In hPanel: **Emails**, then **Mailboxes** next to dikho.in. In the left
sidebar open **Agentic Mail**, then **API access**. If you do not see it, the
email plan may not include it yet; ask Hostinger support to enable the Mail
API for the order.

Make sure every mailbox you want in Dikho already exists in hPanel
(**Emails**, **Mailboxes**): the API cannot create mailboxes.

## 3. Create a restricted API token

On **API access**: **Create API token**. Name it `Dikho CRM`. For scope,
choose **Selected mailboxes**, not "All mailboxes". Click **Create token**
and copy it once into your password manager: Hostinger shows it only once.

This token is not the general Hostinger API token under Dev Tools; that one
does not work here.

## 4. Which mailboxes to grant

Only the mailboxes Dikho should read and send from, for example
`contact@dikho.in`. Leave out personal mailboxes of people who have not
asked for it. Anyone with the token can read and send as every mailbox it
covers, which is why it lives only in the API server and why Dikho adds its
own per-person access on top. To withdraw Dikho's access to a mailbox at
Hostinger itself, edit or delete the token in hPanel.

## 5. Google OAuth credentials (only for Google Workspace mailboxes)

In https://console.cloud.google.com, in a project owned by the company:

1. **APIs & Services**, **Library**: enable **Gmail API**.
2. **OAuth consent screen**: user type **Internal** (only dikho.in Google
   accounts can sign in, and no Google verification is needed).
3. **Credentials**, **Create credentials**, **OAuth client ID**, type
   **Web application**, name `Dikho CRM`.
4. Add the redirect URI from step 7. Save, then copy the client ID and
   client secret into your password manager.

## 6. Gmail scopes

`openid`, `email` and `https://www.googleapis.com/auth/gmail.modify`.
Dikho asks for exactly these; `gmail.modify` reads, labels, archives, drafts
and sends, and cannot delete mail permanently. Add them on the consent
screen's scopes page if it asks.

## 7. Callback URL

```
https://dikho-api.fineeurox.workers.dev/api/email/oauth/google/callback
```

## 8. Is Google Pub/Sub needed now?

No. Without it, Gmail mailboxes refresh when someone uses Email (every few
minutes while open) and on "Sync now". Pub/Sub only makes new mail appear
within seconds; set it up later with the steps in
[the rollout runbook](email-hub-rollout.md) (step 3 of "Before anything is
switched on").

## 9. Cloudflare Worker secrets

From a terminal in the repository, signed in with `npx wrangler login`, one
command per secret; each asks for the value, so it never appears in the
command history. Store settings as secrets: a deploy never removes a secret,
but can remove plain variables.

```bash
npx wrangler secret put HOSTINGER_MAIL_API_TOKEN -c wrangler.api.jsonc
```

| Secret | Value | Needed for |
| --- | --- | --- |
| `HOSTINGER_MAIL_API_TOKEN` | the token from step 3 | Hostinger mailboxes |
| `GOOGLE_CLIENT_ID` | from step 5 | Google mailboxes |
| `GOOGLE_CLIENT_SECRET` | from step 5 | Google mailboxes |
| `GOOGLE_OAUTH_REDIRECT_URI` | the URL in step 7 | Google mailboxes |
| `GOOGLE_WORKSPACE_DOMAIN` | `dikho.in` (optional: only that domain may connect) | Google mailboxes |
| `APP_URL` | `https://manage.dikho.in` | Google mailboxes (where Google's return is finished) |
| `API_PUBLIC_URL` | `https://dikho-api.fineeurox.workers.dev` | campaigns (unsubscribe links) |
| `EMAIL_DAILY_CAP` | start with `100` | campaigns: organization-wide ceiling per UTC day; unset means no campaign sends |
| `EMAIL_FOOTER_ADDRESS` | the company's postal address (optional, recommended) | campaign footer |
| `EMAIL_CAMPAIGN_MAX_RECIPIENTS` | optional, default 5000 | per-campaign limit |
| `EMAIL_JOBS_SECRET` | optional, 32+ random characters | an external scheduler (see "Scheduling") |

Already set, do not replace: `EMAIL_HUB_ENABLED`, `EMAIL_TOKEN_KEY`.
Replacing `EMAIL_TOKEN_KEY` disconnects every Google mailbox and breaks
unsubscribe links already sent.

Not needed: `EMAIL_SES_SEND_ENABLED`, any `AWS_SES_*`, `AWS_SNS_TOPIC_ARN`,
`EMAIL_CAMPAIGN_SENDERS` (SES only).

## 10. Supabase migration

Apply `supabase/migrations/20261027120000_email_hub_providers.sql` to
production **before** deploying the API that uses it. It only adds columns,
tables and functions, keeps every existing mailbox, campaign and consent
record, and is safe with the API currently deployed. If you apply it with
the Supabase MCP `apply_migration` tool, rename the file to the version the
tool records (see `supabase/AGENTS.md`). Then deploy the API
(`npm run deploy:api`) and merge to `main` for the dashboard.

## 11. Feature flags

Already on: `EMAIL_HUB_ENABLED=true` (API secret) and `VITE_EMAIL_HUB=true`
(Pages, Production). Nothing else to switch. Campaign sending is ready once
`EMAIL_DAILY_CAP`, `API_PUBLIC_URL` and `EMAIL_TOKEN_KEY` are set and a
mailbox is allowed for campaigns (step 16).

## 12. Test a Google mailbox

1. manage.dikho.in, **Email**, **Settings**, **Your mailbox**, **Connect
   with Google**. Sign in as your own dikho.in account and approve.
2. Back in Dikho you see "Mailbox connected". Within a minute **Inbox**
   lists recent conversations. Open one; reply to yourself.
3. Settings shows **Receives mail directly** for it (MX is Google).

## 13. Test a Hostinger mailbox

1. **Email**, **Settings**, **Shared mailboxes**: choose **Hostinger
   Email**, pick the address (only those in the token are listed), give it a
   name, **Add and connect**.
2. **People**: add the colleagues who should use it (you cannot add
   yourself; ask another administrator). Nobody can read it before that,
   including Owners.
3. A member opens **Inbox**: its conversations appear after the first sync
   (a minute, or **Sync now**). Open one, mark it unread, star it.
4. For your own Hostinger address (if your Dikho sign-in is that address):
   **Your mailbox**, **Connect Hostinger mailbox**.

## 14. Test outbound sending

From each mailbox, write to an outside address you control (for example a
personal Gmail): **Compose**, choose the mailbox in **From**, send. Check
that it arrives, is not in spam, and that "Show original" in Gmail reports
SPF and DKIM. With no SPF record on dikho.in today, expect SPF to fail or be
"none": fix DNS (step 15) before any campaign.

## 15. Inbound delivery, checked separately

"Connected" means Dikho can read and send with the mailbox. Whether outside
mail reaches it depends only on dikho.in's MX records. Settings shows this
per mailbox: **Receives mail directly**, or **Incoming mail goes
elsewhere** with the current MX.

Today every message to @dikho.in goes to Google. A Hostinger mailbox such
as `contact@dikho.in` therefore receives nothing from outside unless Google
passes it on. Choose one:

- **A. Google split delivery (keeps Google as the front door).** In the
  Google Admin console: **Apps**, **Google Workspace**, **Gmail**, **Hosts**:
  add a route named Hostinger with hosts `mx1.hostinger.com` and
  `mx2.hostinger.com`, port 25, require TLS. Then **Routing**, **Default
  routing**: for **Unrecognized/Catch-all** addresses, route to Hostinger.
  `contact@dikho.in` must then not exist in Google as a user, group or
  alias. Google's help: "Configure Default routing" (support.google.com/a/answer/2368153).
- **B. Keep the address in Google.** Make `contact@` a Google user or group
  and connect it as a Google mailbox instead.
- **C. Move MX to Hostinger.** Breaks every Google mailbox's incoming mail.
  Not recommended while Google mailboxes are in use.

Before changing anything, also fix sender authentication in Hostinger DNS
(**Domains**, dikho.in, **DNS / Nameservers**), each as one record:

- SPF, TXT on `@`: `v=spf1 include:_spf.google.com include:_spf.mail.hostinger.com ~all`
- Google DKIM: Admin console, **Apps**, **Google Workspace**, **Gmail**,
  **Authenticate email**: generate a key, add the TXT record it shows at
  `google._domainkey`, then **Start authentication**.
- DMARC: delete one of the two `_dmarc` TXT records so exactly one remains
  (`v=DMARC1; p=none` is fine to start).

Test receiving independently of sending: from an outside address, write to
the mailbox and check it arrives in Hostinger Webmail first, then in Dikho
after a sync. Do not call a mailbox operational until both directions pass.

## 16. Send an approved test campaign

1. **Settings**, the mailbox, **Campaigns: Change**: allow campaigns with a
   low limit, for example 20 a day.
2. **Email**, **Consent**: record consent for two or three test addresses
   you control (a CRM record alone is not consent).
3. **Campaigns**, **New campaign**: choose that mailbox in **Send from**, an
   audience containing only those test records, content. **Send a test to
   me** sends one copy to your own address through the mailbox.
4. Submit. A second person with the approve permission reviews and
   approves; nobody can approve their own.
5. Batches go out while someone is using Dikho, or press **Send next batch
   now**. Each recipient is sent once; "Unconfirmed" means the provider did
   not answer and it is never resent automatically.

Keep limits low. Google Workspace and Hostinger mailboxes are for business
mail: a mailbox that sends too much, or draws spam complaints, can be
limited or suspended for everyday mail too.

## 17. Monitor failures and quotas

- **Settings**: per mailbox, last sync and any sync error, receiving
  status, storage (Hostinger), campaign limit.
- **Campaigns**, a campaign: sent, failed, unconfirmed, skipped (no
  consent, suppressed) and why it paused. A provider limit rests the mailbox
  for 15 minutes (6 hours after Gmail's daily limit) and the campaign
  continues afterwards.
- **Analytics**: sending and consent from Dikho's records. Delivery,
  bounces and complaints appear only for SES; for mailbox campaigns, watch
  the sending mailbox for bounce messages and suppress those addresses on
  **Consent**.
- Cloudflare Worker logs (`dikho-api`): events named `email.*`, never with
  message content.

### Scheduling

Cloudflare cron does not fire on the current plan. Without an external
scheduler, campaigns progress only while someone uses Dikho or presses
**Send next batch now**. For unattended sending, set `EMAIL_JOBS_SECRET` and
have a scheduler you trust (for example Supabase `pg_cron` with `pg_net`)
call `POST https://dikho-api.fineeurox.workers.dev/api/email/jobs/run` with
`Authorization: Bearer <secret>` every few minutes; verify it actually runs
before promising send times.

## 18. Roll back safely

- **One mailbox:** Settings, **Disconnect** (Dikho stops at once; mail at
  the provider untouched). For Hostinger also remove it from the token.
- **Campaigns:** Pause or cancel the campaign; or untick **Campaigns** on
  the mailbox (the next batch pauses every campaign using it); or remove
  `EMAIL_DAILY_CAP` (nothing sends).
- **All Hostinger:** `npx wrangler secret delete HOSTINGER_MAIL_API_TOKEN -c wrangler.api.jsonc`
  (Hostinger calls fail closed) and delete the token in hPanel.
- **The whole module:** delete `EMAIL_HUB_ENABLED` (API answers 404 except
  unsubscribe links). The Pages flag only hides navigation.
- **Code:** roll the API back with `npx wrangler rollback -c wrangler.api.jsonc`;
  the migration is additive and can stay. Do not drop email tables: they
  hold consent, unsubscribes and who was sent what.
