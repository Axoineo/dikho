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

- Settings, phase 1 (migration `20261028120000_settings.sql`, applied
  2026-10-28; without it every screen keeps the built-in values). One page per
  section at `/settings/<section>`: "Your account" for everyone,
  "Organization" for people with the new `settings.manage` permission
  (Admins; Owners hold everything). On a phone, or beside an open sidebar on
  a tablet, the list and each section are separate pages.
  - Your account: Profile (read-only), Preferences (theme, table density,
    start page after sign-in, rows per page) and Sign-in and security (the
    devices you are signed in on). Preferences are stored on your account,
    so they follow you to every device.
  - Company: legal name, GSTIN, PAN, address and bank details used on tax
    invoices, checked before saving (GSTIN and PAN formats, PAN inside the
    GSTIN, IFSC, PIN code). Changes are audited with the account number
    masked.
  - Regional: date format (13 Apr 2026, 13/04/2026 or 2026-04-13) and number
    style (₹1,00,000.00 or ₹100,000.00) on every screen. Exports, PDFs and
    invoices are unchanged.
  - Lists and media: the values offered for order type, order status,
    purchase status, item type, courier status, registration and row colour,
    plus media and sub media. Add, reorder and hide; media can also be
    renamed. Nothing is deleted, because saved records keep their values;
    a hidden value stays on records that already have it, and vendor
    registration no longer offers hidden media.
  - The Vendors list follows the rows-per-page preference (25, 50 or 100;
    it showed 15).

- Email Hub 2.0 (ADR 0010; migration `20261027120000` not yet applied; owner
  steps in `docs/runbooks/email-hub-setup-guide.md`).
  - Hostinger mailboxes through the Hostinger Mail API, beside Google
    Workspace ones: connect (one server-side token, mailboxes matched by
    address), sync a metadata-only index, read, reply, forward, attachments,
    read/unread and star. Unsupported actions (drafts, labels, aliases) are
    hidden with the reason.
  - Campaigns sent from a connected Gmail or Hostinger mailbox that its
    administrators allowed for campaigns, with a per-mailbox daily limit on
    top of the organization's, cooldown after a provider limit, and
    automatic pause when the provider refuses the mailbox. Amazon SES is no
    longer required; Brevo keeps sending system email.
  - Each mailbox shows whether outside mail reaches it (its domain's MX
    records), separately from whether it is connected.

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

- One look across the dashboard, phase A of the redesign
  (`docs/DESIGN.md`, `docs/tasks/2026-10-29-site-redesign.md`):
  - Neutral greys in light and dark, with Dikho blue as the only accent.
  - A smaller, calmer type scale and controls on Clients, Vendors, Sales
    orders, Purchase orders and Settings.
  - Details panels show label-left, value-right rows.
  - The sidebar uses neutral text and a softer highlight.
  - Navigation and section names are in sentence case.
- Redesign phase D: User management and Live Assist in the same style:
  quieter tabs and tiles, round pills, label-left profile rows, a lighter
  permission grid, and matching dialogs and buttons. The people list fits a
  phone without sideways scrolling.
- Redesign phase C: Settings in the mockup's row style. Company and bank
  details are rows with the input on the right; Regional is two rows of
  small choices written as they will look; lists, navigation and sessions
  are tighter.
- Redesign phase B: Leads uses the same layout as Clients and Vendors.
  Sales orders can be filtered by status. A client's panel has "New order"
  and a vendor's panel "New PO", which start the order with that client or
  vendor chosen. The vendor panel shows only the last four digits of the
  bank account number until Show is pressed.
- Input boxes no longer show example text ("e.g. …", sample numbers, "0.00",
  "https://…", "Enter your email"): every labelled box starts empty, and the
  few instructions worth keeping moved below the box as hints. Search bars,
  message boxes and dropdown prompts keep their text, since it is the only
  label they have. The corporate gifting page is unchanged.
- Clients, Vendors, Sales Orders and Purchase Orders share one layout
  (`src/components/crm/`): a page header, a search row with one result count,
  a table whose rows open on a single click, a details panel that slides over
  the table instead of squeezing it, and forms with a fixed Save bar. Sizes
  come from one type scale in rem; colours from the theme tokens, so dark
  mode needs no overrides. Dates read "13 Apr 2026", amounts "₹1,47,500.00".
  - Clients and Vendors can be edited (Edit in the details panel, shown with
    `clients.edit` / `vendors.edit`; RLS already enforced both). A new vendor
    document is stored beside the old one, never in place of it.
  - Removed: selection checkboxes that did nothing, the ID columns, the
    repeated record counts, the unused purchase-order delete dialog, and
    about 1,100 lines of CSS no screen referenced.
  - Order forms show what most orders need; every other field is one click
    away under "More details", per line item too.
  - Purchase orders are listed from `salesorder`, where they are saved. The
    list used to read the legacy `purchaseorders` table, so a PO saved in the
    app never appeared. Editing a PO used to clear its vendor address, which
    would have turned it into a sales order; it is now kept, and a new PO
    needs one (picked for you when the vendor has only one).
- Interface fixes from a design audit (Apple's design principles):
  - Sign-in stays readable when the computer is in dark mode. The page is
    light-only, but its sign-in method switch picked up dark colours (2.2:1);
    its subtitle, labels and placeholder also now clear 4.5:1.
  - Brand blue used as text (links, active tabs, selected pills) has its own
    `--brand-ink` token, lighter in dark mode: 7.5:1 or better where it was
    2.2:1. Tailwind uses `text-brand-ink`; `text-brand` remains for fills.
  - The dark theme declares `color-scheme: dark`, so open dropdowns, date
    pickers and autofill follow it.
  - Vendor registration shows a step's problem under the field it belongs to,
    and scrolls to and focuses that field. On a phone the old banner sat
    above the screen, so Continue appeared to do nothing. Mismatched bank
    account numbers are caught on the Tax & Bank step, not two steps later.
  - Pages that only say "This section will be added next." (Dashboard,
    Invoice Notification, Advance Payment Receipt, Payment Receipt, Payment
    Request, Document Courier) are out of the sidebar and sign-in landing
    until built. Their routes still resolve.
  - On a phone the WhatsApp inbox shows the chat list or one open chat, with
    a Back button; before, opening a chat hid the list with no way back.
  - With reduced motion on, spinners keep turning (slower) instead of
    freezing after one frame.
  - The WhatsApp overview groups large numbers (10,320) and keeps each
    delivery-health value next to its label.

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
