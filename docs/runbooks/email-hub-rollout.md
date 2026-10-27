# Email Hub: rollout, pause and rollback

Design: [ADR 0009](../decisions/0009-email-hub.md), amended by
[ADR 0010](../decisions/0010-email-hub-providers.md). For Hostinger mailboxes
and campaigns without SES, follow the
[Email Hub setup guide](email-hub-setup-guide.md); the SES steps below are
optional. Settings:
[Configuration](../CONFIGURATION.md#api-worker-email-hub). Nothing here
authorizes a production change: applying migrations, setting secrets,
deploying, changing DNS and sending real email each need the system owner's
approval at the time.

## Before anything is switched on

1. **Owner decisions.** Accept or amend ADR 0009. Confirm which mailboxes are
   connected first, who administers the shared ones, which sender addresses
   campaigns may use, and the daily campaign limit.
2. **DNS authority.** Confirm which provider is authoritative for the sending
   domain before adding records. Change nothing in DNS or email routing
   without the owner's go-ahead; existing mail (MX) must keep working.
3. **Google Cloud** (owner action): an OAuth client of type Web application on
   an Internal consent screen, redirect URI
   `https://<API origin>/api/email/oauth/google/callback`, scopes `openid`,
   `email`, `gmail.modify`. Optional push: a Pub/Sub topic that grants
   `gmail-api-push@system.gserviceaccount.com` publish rights, and a push
   subscription to `https://<API origin>/api/email/webhooks/google-pubsub`
   with authentication on (service account + audience).
4. **Amazon SES** (owner action): verify the domain identity (DKIM; SPF and
   DMARC at the authoritative DNS provider), request production access,
   create a configuration set with an event destination to an SNS topic
   (send, delivery, bounce, complaint, reject, delivery delay), subscribe
   `https://<API origin>/api/email/webhooks/ses` to that topic over HTTPS, and
   create an IAM user allowed only `ses:SendEmail` on that identity and
   configuration set.

## Rollout order

1. **Staging database.** Apply `20261021120000_email_hub_mailboxes.sql`, then
   `20261021130000_email_hub_campaigns.sql`, to a staging project. Re-run the
   allow and deny cases from `supabase/tests/` there, under the real roles.
2. **Production database** (approved migration window). Apply the same two
   migrations in order. They add tables, functions and permissions only; with
   the module off nothing calls them.
3. **Worker secrets and settings**, entered interactively, never on a command
   line: `EMAIL_TOKEN_KEY`, the Google settings, the SES settings with
   `EMAIL_SES_SEND_ENABLED` still unset, `API_PUBLIC_URL`, `EMAIL_DAILY_CAP`
   (start low), `EMAIL_CAMPAIGN_SENDERS`, `AWS_SNS_TOPIC_ARN`.
4. **Worker deploy** with `EMAIL_HUB_ENABLED` unset. Confirm the SNS
   subscription shows Confirmed (the webhook confirms only the configured
   topic).
5. **Pilot.** Set `EMAIL_HUB_ENABLED=true`. Build the SPA with
   `VITE_EMAIL_HUB=true` for a pilot group, or give only pilot staff the email
   permissions. Connect one personal and one shared mailbox; check list,
   read, reply, labels, attachments, a draft and a send.
6. **SES.** Send a test to a staff address (Campaigns, Review, "Send a test
   to me") only after `EMAIL_SES_SEND_ENABLED=true`. Watch the delivery event
   arrive in Analytics.
7. **First campaign.** Record consent for a small list, submit, approve by a
   second person, and watch it send within the daily limit.

## Pause

| Need | Action | Effect |
| --- | --- | --- |
| Stop one campaign | Campaign page, Pause or Cancel | No further batches; sent rows stay recorded |
| Stop all campaign and system email through SES | Unset `EMAIL_SES_SEND_ENABLED` | SES is never called; campaigns wait; staff welcome falls back to Brevo or WhatsApp if configured |
| Stop campaigns only | Unset `EMAIL_DAILY_CAP` | Campaigns are not ready; nothing is claimed |
| Hide the module | Unset `EMAIL_HUB_ENABLED` | `/api/email` answers 404 except unsubscribe and SES events, which keep working |
| One mailbox | Settings, Disconnect | Token deleted and the Google grant revoked; metadata kept until removed |

## Rollback

- **Application:** redeploy the previous Worker or roll back the Pages
  deployment as in [Application and migration rollback](rollback.md). Keep
  the unsubscribe route available while any sent campaign's links can still
  be clicked: prefer unsetting `EMAIL_HUB_ENABLED` over removing the code.
- **Database:** do not drop the email tables to roll back; they hold consent,
  unsubscribes, suppression and the record of who was sent what. If the
  feature is withdrawn, disconnect every mailbox first (revokes the Google
  grants and deletes tokens), then remove the module with a reviewed forward
  migration that keeps `email_preferences` and campaign recipients, or exports
  them under the owner's retention decision.
- **Credentials:** if a token key, Google secret or SES key may be exposed,
  rotate it ([Credential rotation](credential-rotation.md)). Rotating
  `EMAIL_TOKEN_KEY` keeps the old key in `EMAIL_TOKEN_KEY_PREVIOUS` until
  every mailbox has reconnected.

## Checks after any change

- `GET /api/email/status` from a signed-in staff browser shows the expected
  ready/not ready flags, never a value.
- A person without membership gets 404 for a mailbox; an Owner without
  membership cannot read it either.
- Analytics bounce and complaint rates stay under the thresholds shown.
