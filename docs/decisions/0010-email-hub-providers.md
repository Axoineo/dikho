# 0010: Email Hub: Google and Hostinger mailboxes; campaigns without SES

Status: Proposed
Date: 2026-10-27
Amends: [ADR 0009](0009-email-hub.md) decisions 1 and 6 (Gmail as the only
mailbox provider; campaigns through Amazon SES only). Everything else in
0009 stands: two gates per mailbox, rules in the database, encrypted Google
tokens, isolated rendering, consent and second-person approval.

## Context

Dikho's mail is split. Some @dikho.in mailboxes live at Google Workspace and
some at Hostinger, and the domain is registered at Hostinger, which also
serves its DNS. Amazon SES production access is still pending, so the
0009 design, where campaigns go only through SES, sent nothing. The
owner wants to use the company's existing mailboxes for correspondence and
for appropriately limited campaigns, without SES as a prerequisite and
without a mail server or a VPS.

Hostinger publishes an HTTPS Mail API (OpenAPI 1.3.0 at
api.mail.hostinger.com) that works from a Cloudflare Worker: account and
mailbox discovery (`GET /api/v1/me`), IMAP folders and per-folder UIDs,
message listing, search, text and source, attachments, flags, moves,
`POST /send` (with the original as `{uid, folder}` for replies and forwards),
quota and `message.received` webhooks. It has no drafts, no labels, no
send-as aliases, no custom headers or Reply-To on send, no message id in
the send answer (204), and no delivery, bounce or complaint events. Tokens
are created per Hostinger order in hPanel and may be limited to selected
mailboxes.

## Decision

1. **Every mailbox names its provider** (`google` or `hostinger`,
   `email_accounts.provider`), chosen when it is created and never changed.
   It is never inferred from the address. A small capability model
   (`src/api/services/email/providers.js`) says what each provider can do
   in Dikho; anything else is refused with the reason (409) before any
   provider is called, and the dashboard hides or disables the control.
   Gmail code keeps its shape; Hostinger has its own adapter beside it. No
   general provider class hierarchy.

2. **Hostinger through one organization token.** `HOSTINGER_MAIL_API_TOKEN`
   is a Worker secret, never stored in the database or sent to the browser.
   Mailboxes are matched by the address Hostinger lists for the token, and
   the Hostinger resource id is taken only from `GET /me`. Shared Hostinger
   mailboxes are connected by their configurers (as for Google); a personal
   one only by the person whose own Dikho sign-in address it is. Membership
   rules are unchanged: connecting or configuring never grants reading.

3. **Metadata-only index for Hostinger.** Hostinger has folders and UIDs, not
   threads. Dikho indexes headers and flags of the inbox, sent and archive
   folders (`email_provider_messages`, never bodies), derives
   conversations in the database from `Message-ID` / `In-Reply-To` (a copy
   in another folder, the message answered, or a reply that arrived first),
   and projects them onto `email_threads` with Gmail-style system labels so
   lists, search, unread counts, notes, links and assignment are shared.
   Subjects never join conversations; existing conversations are never
   merged after the fact. Bodies and attachments are fetched live, as for
   Gmail.

4. **Campaigns through a connected mailbox.** A campaign may name a sender
   mailbox (`email_campaigns.sender_account_id`). It must be connected,
   allowed for campaigns by its configurers with its own daily limit
   (`campaign_sender`, `campaign_daily_cap`, 1 to 2000), and the submitter
   must be responder or above in it. The approval hash covers the sender
   (campaigns without one hash exactly as before). Every batch re-checks
   all of this plus the organization limit (`EMAIL_DAILY_CAP`); a provider
   limit rests the mailbox (`campaign_cooldown_until`) and returns the
   recipients to the queue; a refused mailbox pauses the campaign. One
   campaign, one sender: nothing rotates between mailboxes. SES stays as an
   optional path, not claimed while `EMAIL_SES_SEND_ENABLED` is off; Brevo
   keeps sending system email.

5. **Receiving is reported separately from connecting.** A connected mailbox
   can read and send while its domain's MX records send outside mail
   elsewhere. Dikho reads the MX records over DNS over HTTPS (read-only) and
   shows whether mail reaches the mailbox's provider directly. Dikho never
   changes DNS.

6. **No IMAP or SMTP.** The HTTPS API covers what Dikho needs; TCP mail
   protocols would need infrastructure the Worker runtime does not offer.

## Consequences

- Hostinger mailboxes have no drafts, labels, aliases or provider-side
  search in Dikho; those controls are hidden with the reason. Older mail
  than the synced window is reached in Hostinger Webmail.
- A Hostinger send cannot be confirmed by id. A timeout or 5xx is recorded
  as "uncertain" and never resent automatically, as for Gmail.
- Campaigns from Hostinger carry no `List-Unsubscribe` header and no
  separate Reply-To (submission refuses one); the footer link always works.
  Gmail campaigns carry the one-click header.
- Without SES there are no bounce or complaint events: suppression after a
  bounce is manual. Analytics show acceptance, never delivery.
- Mailbox providers are not bulk services. Limits start low and are the
  owner's decision; a mailbox flagged for spam also stops working for
  everyday mail. `dikho.in` currently has no SPF record and no Google DKIM
  record, and has two DMARC records; deliverability will suffer until DNS is
  corrected (an owner action; see the setup guide).
- Scheduled campaigns still need traffic or an external scheduler
  (`EMAIL_JOBS_SECRET`); the editor says so, and "Send next batch now" runs
  one bounded batch on demand.
- Hostinger webhooks are not used yet: their payload is undocumented and
  they authenticate with a per-webhook bearer secret Dikho would have to
  store. New Hostinger mail appears when someone uses the Email Hub.

## Alternatives considered

- **IMAP/SMTP to Hostinger:** needs raw TCP and a long-lived connection;
  not available in Workers without extra infrastructure. Rejected.
- **Per-user Hostinger tokens in the database:** more secrets at rest, and
  Hostinger tokens are per order, not per person. Rejected in favour of one
  scoped Worker secret plus the existing membership rules.
- **Rotating campaign sends across mailboxes** to raise throughput: works
  around provider limits and anti-spam rules. Rejected.
- **Waiting for SES:** blocks every campaign on an external approval.
  Rejected; SES remains available later.

## Verification

- `tests/email-providers.test.js`, `tests/email-campaign-mailbox.test.js`:
  capability refusals, Hostinger client (auth, 429 back-off, uncertain
  sends, malformed answers), connection, sync, reading, flags, attachments,
  sending, inbound routing, mailbox campaign dispatch, limits, pausing.
- `supabase/tests/email_hub_providers.sql`: provider and connection rules,
  threading, reconciliation, campaign sender rules, budgets, cooldown,
  browser roles denied. Run by `scripts/db/verify-local.sh`.
- Not verified against real Hostinger, Gmail or DNS-over-HTTPS services.
