# Changelog

This file records notable repository changes intended for operators,
contributors and future public-release adopters. The project has not made a
public release and does not yet promise semantic-version compatibility.

The repository and software are currently proprietary property of Dikho Global
Media LLP. No public license or redistribution permission is granted.

Do not include credentials, private resource identifiers, production data,
incident details or unreleased vulnerability exploitation instructions here.

## Unreleased

### Added

- Email Hub (off unless `EMAIL_HUB_ENABLED=true`; screens only in builds with
  `VITE_EMAIL_HUB=true`; migrations `20261021120000` and `20261021130000` not
  yet applied). See ADR 0009 and `docs/runbooks/email-hub-rollout.md`.
  - Connect Google Workspace mailboxes (personal and shared). A mailbox needs
    the Email permission and membership of that mailbox; Owners and
    developers get no automatic access. Mail stays in Gmail; Dikho keeps
    conversation metadata only.
  - Inbox, conversation, composer, drafts, labels, attachments, assignment,
    internal notes and CRM links. Message content shown in an isolated page.
  - Amazon SES as the sender for system email and campaigns (Brevo kept as a
    fallback for system email only while configured), with delivery, bounce
    and complaint events.
  - Campaigns to people with recorded consent, approved by a second person
    against the exact version; templates with versions; consent and
    suppression lookup; delivery analytics without open or click tracking.
  - New permissions `email_inbox.view`, `email_mailboxes.manage`,
    `email_campaigns.view/create/approve`, `email_templates.manage`,
    `email_consent.manage`.

- WhatsApp inbox, close to WhatsApp itself, using what Meta's Cloud API
  offers businesses:
  - a menu on every message: quick reactions, Reply (quotes the message),
    Copy, Forward (up to five chats), Pin (team-wide, three per chat), Star
    (personal) and Delete (hides it for the team; WhatsApp cannot unsend);
  - send locations, contact cards, reply buttons, lists, link buttons, a
    location request, an Indian delivery-address request, approved templates
    (also after the 24-hour window, for people who can send campaigns) and
    recorded voice notes;
  - customers' locations, contact cards, chosen options, addresses, orders,
    the ad they came from, forwarded labels and WhatsApp's system notices
    show as such instead of placeholders;
  - Clear chat, Delete chat, Block and Unblock, confirmed first and recorded
    with who did it; new permissions `inbox.delete` and `inbox.block`;
  - a jump-to-latest button that counts new messages, and a pinned bar.

- Live Assist: with an employee's OK, a colleague who may help them sees their
  Dikho tab live, points at and highlights things, and suggests pages. No
  remote control and nothing recorded. Plus "Ask for help", which tells the
  people who can help. See ADR 0008.

- Live Assist chat: messages under the employee's banner with quick replies,
  numbered notes the helper pins beside a button or field (done when the
  employee clicks it), and a chat column beside the helper's view. Not saved.
  Colleagues at the same level can now help each other, "Ask for help" can go
  to one chosen person, and nobody can be in two sessions at once.
- The staff welcome WhatsApp template is configured and the sender matches
  the approved template's real shape before sending.

- User Management: staff profiles, departments and teams, permission
  templates, per-person permission overrides, system roles and developer
  levels, per-action permissions enforced by RLS and the API, an append-only
  audit log, session list with approximate sign-in location, "Active now",
  force sign-out, suspend and archive, welcome message on add, and a theme
  preference saved per person. See ADR 0007.

- Canonical repository and nested `AGENTS.md` guidance for AI-assisted work.
- Product, invariant, architecture, database, testing, deployment, branding,
  configuration, permissions, upgrade and security-audit documentation.
- A visual system handbook with trust-boundary diagrams and synthetic UI
  screenshots.
- Isolated tests for session verification, Turnstile verification, webhook
  signatures and protected-media tickets.

### Changed

- The staff welcome email is sent through the new email delivery service:
  Amazon SES once it is switched on, otherwise Brevo as before.

- WhatsApp inbox bubbles are WhatsApp-sized: one line of text is 29px tall
  instead of 54px, the time sits on the last line, and the thread uses a
  doodle wallpaper drawn for Dikho instead of a dot grid.
- The safe `npm run check` command now runs lint, isolated tests, the production
  build and the high-signal secret scan.
- Documentation now distinguishes the production Cloudflare Pages SPA from the
  unused standalone SPA Worker deployment command.

### Security

- Documented open authorization, public-upload, Storage-policy and resource
  exhaustion findings in `docs/SECURITY-AUDIT.md`; documentation does not mark
  those findings resolved.

## Maintenance rules

- Add user-visible behavior, schema, configuration, security and operational
  changes under `Unreleased` in the same change that introduces them.
- Label removals and breaking changes explicitly and link their upgrade steps.
- Move entries into a dated version only when an actual release is approved.
- Describe outcomes, not secret values or private deployment identifiers.
- A changelog entry is not evidence that a change was deployed; production
  state must be verified independently.
