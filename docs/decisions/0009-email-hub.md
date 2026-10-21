# 0009: Email Hub: Gmail as the mailbox, mailbox-level access, separate senders

Status: Proposed
Date: 2026-10-21

## Context

Staff correspond with clients and vendors in Google Workspace mailboxes.
Dikho needs that correspondence beside CRM records, plus approved bulk email
and programmatic transactional email, without becoming a mail server and
without weakening the invariants (verified sessions, server-side
authorization, bounded sends, no secrets or message content in logs).

Two facts shape the design. First, Owners and every developer level hold all
permissions (ADR 0007), so a rule built only from permissions would let them
read everyone's mail. Second, Cron Triggers do not fire on the current
Workers plan, so nothing may depend on a schedule running by itself.

## Decision

1. **Gmail is the source of truth for correspondence.** Dikho connects
   mailboxes with Google OAuth (authorization code, one-time server-side
   state, PKCE, `gmail.modify` + `openid email`, offline access). It caches
   thread-level metadata (subject, participants, dates, labels, unread,
   attachment flag) in Supabase and fetches message bodies and attachments
   from Gmail on demand, returning them with `Cache-Control: no-store`.
   Bodies and raw MIME are not stored.

2. **Two independent gates for every mailbox.** The feature permission
   (`email_inbox.view`) opens the module; a row in
   `email_account_members` (viewer < responder < manager < admin) opens a
   mailbox. Owners and developers get no implicit membership. Nobody grants
   themselves membership; a personal mailbox's members are chosen only by its
   owner; shared mailboxes are managed by their admins or by holders of
   `email_mailboxes.manage`, which never grants reading. Every membership and
   connection change is written to `audit_log`.

3. **Rules live in the database, called by the Worker.** Mailbox tables have
   RLS enabled, the restrictive staff policy, and no privileges for `anon` or
   `authenticated`. The Worker calls `em_*` `SECURITY DEFINER` functions with
   the service role and the actor verified by `requireAuth`; the functions
   re-check the actor, the permission and the membership. Browser access to
   these tables is denied at the database.

4. **Tokens are unreadable from the database.** Refresh tokens are encrypted
   in the Worker with AES-256-GCM, a key held only as a Worker secret, and
   the account id as associated data. A database administrator, a backup or
   a leaked service-role key does not yield anyone's mail.

5. **Gmail state and Dikho workflow are separate.** Assignment, workflow
   status, internal notes and CRM links are Dikho columns/tables and never
   change Gmail labels. Read/unread, star, archive and labels change Gmail
   and are mirrored back by sync.

6. **Senders are separated by purpose.** Correspondence goes through the
   connected Gmail mailbox. Programmatic mail goes through a small
   `EmailDeliveryService` with a Brevo provider (current, default) and an SES
   v2 provider (signed with `aws4fetch`), switchable by configuration and off
   until SES is verified. Campaign semantics stay outside the provider
   interface.

7. **Background work is request-driven with leases.** Sync, watch renewal and
   campaign dispatch run on API traffic and explicit actions, claim work with
   database leases so concurrent isolates do not double-process, and are
   bounded per request. Gmail push (Pub/Sub, OIDC-verified) and an optional
   `pg_cron` + `pg_net` caller make it timely; neither is required for
   correctness.

## Consequences

- A mailbox is invisible to anyone not added to it, including Owners and
  developers. Supporting a mailbox means being added by someone else, which
  is audited.
- Metadata (subjects, participant addresses) is readable by database
  administrators; bodies and attachments are not. This is the accepted
  residual exposure of metadata-first caching.
- Losing `EMAIL_TOKEN_KEY` means reconnecting every mailbox. Rotation keeps
  the previous key for decryption until tokens are re-encrypted.
- Without Pub/Sub or a scheduler, a mailbox nobody is looking at is synced
  when someone next opens the Email Hub.

## Alternatives considered

- **Store full messages in Supabase**: faster search, but duplicates private
  mail into a database many people administer. Rejected.
- **Permission-only access (`email_inbox.view` = read all)**: simple, but
  makes every Owner and developer a reader of everyone's mail. Rejected.
- **Browser-side Gmail (Google Identity in the SPA)**: no server tokens, but
  no shared mailboxes, no sync, no CRM linking and tokens in the browser.
  Rejected.
- **AWS SDK for SES**: heavy for a Worker; `aws4fetch` is already present.
- **Cloudflare Queues/Cron for dispatch**: not available or not firing on the
  current plan.

## Verification

- `supabase/tests/email_hub_*.sql` (run by `scripts/db/verify-local.sh`):
  members allowed, non-members, Owners and developers denied, no self-grant,
  personal delegation only by the owner, revoked members lose access,
  browser roles have no table access.
- `tests/email-*.test.js`: route permission gates, OAuth state replay,
  token encryption binding, sanitizer, MIME, Pub/Sub JWT, SNS signatures.
- After deployment: `get_advisors` shows no new security findings and the
  effective grants on `email_*` tables are empty for `anon`/`authenticated`.
