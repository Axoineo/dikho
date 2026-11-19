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

- WhatsApp dashboard rebuilt with charts and analysis, on the web and natively in
  the Android app. Pick 7, 30 or 90 days and every figure compares with the same
  length of time before: messages sent, delivery and read rates, failures,
  messages received and Meta spend; a daily sent/delivered/read chart with a
  table view; the delivery funnel; failure reasons in plain words; messages
  received by day; where sent messages came from; spend by day and by Meta
  pricing category; each template's results with Meta's quality rating; the
  period's campaigns; the number's quality rating, messaging limit and
  throughput; audience and inbox. One request,
  `GET /api/whatsapp/analytics?days=7|30|90`, cached per day in the new
  `analytics_cache` table (D1 migration 0013) so a busy dashboard does not
  rescan messages; Meta figures are cached for 30 minutes and each Meta part
  fails on its own with a plain reason.
- User Management is native in the Android app: the people with a search, counts that
  filter and a filter sheet (status, role, department, template), refreshed every 30
  seconds so "Online" stays true; each person's details, access, sessions and history;
  adding people and editing their details; suspending, reactivating, archiving, signing
  out everywhere and resending the welcome, each asked about first in plain words;
  permission templates, departments and teams, and the audit log. The web's permission
  grid is redesigned for a phone as a list per module (a switch and its reach for each
  permission, quick settings per module, the whole row tappable), with the grid's rules:
  the smallest change that gives the result, and only access the editor holds can be
  given. The app's sessions now show as "Dikho app on Android" in the session lists, on
  the web too. Live Assist is not on the native profile yet.
- Settings is native in the Android app, redesigned for a phone as a list where each
  section opens on its own: your profile, preferences (the theme changes at once and
  follows you to every device; the start page; the web tables' density and rows per
  page), your devices with ending a session; and, for people with `settings.manage`,
  the company's invoice details (checked as on the web, only changed fields sent, Save
  only while something changed, asked before leaving with unsaved changes), date and
  number formats, the dropdown lists (move, hide, add, row colours from a palette) and
  media with sub media. The database's own refusals ("That value is already in the
  list") are shown as written, and a Settings change is never sent twice after a
  dropped connection. After a change the page in the app reloads the person's access
  and the organization's settings, and native order and vendor forms read the lists
  again.
- Live Assist in the Android app, for both sides (ADR 0014). Being helped on a phone:
  the request says what the helper will see, a banner shows while they are viewing,
  with Stop; their pointer, highlights, pinned notes (Done or hide) and page
  suggestions (Go) show over the app, and the chat has quick replies. Ask for help is
  in the drawer. A phone shares only pictures of Dikho's own screens, a few a second,
  directly to the helper over WebRTC: no screen-recording permission, and never the
  phone's notifications or other apps. Helping from a phone: the other person's screen
  (a computer's tab or a phone's pictures), drag to point, tap to highlight and pin a
  note, chat, suggest a page, end; help requests show as cards, and native profiles
  have a Live Assist button. The browser's viewer shows a phone's pictures. The page in
  the app leaves Live Assist to the app. New dependency: `flutter_webrtc` 1.6.3.
- The email inbox is native in the Android app: folders and mailboxes as two pickers,
  search (and searching the mailbox itself), unread only, a list that loads more as
  it scrolls and refreshes every minute; a conversation on its own screen, marked read
  on opening, each message in a small view that can load nothing and run nothing,
  with links opened in another app only after asking and attachments downloaded with
  the session and saved to Downloads; archive, star, mark unread, labels, status,
  assignee, internal notes and CRM records. Writing is redesigned for a phone: plain
  text with the original quoted below, recipients as chips with suggestions, files
  from the phone, send-as addresses, a draft kept when leaving, and one id per message
  so a send repeated after a dropped connection goes once.
- Email overview and analytics are native in the Android app. The overview: unread,
  assigned to you, connected and needing attention as figures, mailboxes needing a
  reconnect, the newest unread conversations, each mailbox with its role, status and
  Sync now, campaign counts, and the server's connections. Analytics: 7, 30 or 90
  days; campaign emails sent, bounce and complaint rates with their standing in words
  (against Amazon SES's limits), unsubscribes; where campaign emails ended up as
  labelled bars; the audience today; delivery events. Consent and Email settings are
  still the web's.
- Email campaigns and templates are native in the Android app. Campaigns: a list with
  filters (awaiting approval, drafts, scheduled and sending, sent) and progress; each
  campaign on its own screen with its details, audience (clients, vendors, leads and
  their filters, with who will receive it counted by the server), content (plain text
  written on the phone; a designed email is shown as it is and can only be replaced by
  a template), a preview, the checklist, a test to yourself, approval of exactly the
  version reviewed (the server refuses an approval once the content has changed),
  request changes with a note, pause, resume, cancel, send the next batch, delivery
  figures and history. Templates: list, edit, older versions restored as the newest,
  archive. A started campaign is never edited.
- WhatsApp contact imports are native in the Android app: choose a CSV, Excel or
  JSON file, check (and change) which columns are the WhatsApp number, name, email and
  company, see how many are ready and why the rest are skipped, then import. The file
  is read on the phone with the web importer's rules and limits. New app dependency:
  phone_numbers_parser (MIT). The app no longer opens the web importer.
- The Android app draws a sales order's tax invoice itself, on the CRM's own template
  with the same fonts and positions as the web, and saves it to Downloads with Open;
  it no longer opens the web page for it. New app dependency: PdfBox-Android 2.0.27
  (Apache 2.0). Its line list leaves out purchase-order lines that only record which
  sale they were bought for.
- Tax invoices show the tax total in full. In the HSN tax table the amount ended
  under the template's printed ₹ sign, so a tax of 180.00 read as ₹80.00; it now ends
  inside the column. The Rate column no longer loses its last digit under the
  column's line. Web and app alike.
- Tax invoices print the real GST % on each line and in the HSN table. The rate used to
  be read from `gst_type`, which only says how tax is split, so the column was blank.
  The rate now comes from each line's amounts: a standard slab prints that slab, a
  line with no tax prints 0, a custom tax prints the rate it works out to, and tax on
  a zero taxable amount prints '-'.
- Email settings is native in the Android app, so the whole Email Hub now is: your
  mailbox and shared mailboxes with their status, whether outside mail reaches them
  and storage, Sync now, connect (Google in the phone's browser, Hostinger at once),
  disconnect or remove after confirming, campaign sending allowed with a daily limit
  (1 to 2000), adding shared mailboxes, and a People screen to add, change or remove
  who may use a mailbox (never yourself) or leave it. Google's return comes back to
  the app on its App Link and is finished with the app's own session, its outcome
  shown in words. Every drawer entry is now a native screen.
- Email consent is native in the Android app: look up one address (never a list of
  everyone), see whether it agreed, unsubscribed or is suppressed, how and when it was
  recorded and by whom; record consent (how they agreed is required) or an unsubscribe
  with a note, suppress or lift a suppression after confirming. Changing needs "Manage
  email consent"; others who write campaigns can look. Campaigns' Consent link opens it.
- The Android app's unsaved-changes bar (Settings, email campaigns and templates) keeps
  Cancel and Save changes side by side on a phone, with the words above them; before,
  the buttons stacked on top of each other. Long hints under campaign and template
  fields are shown in full instead of being cut off.
- The Android app signs people in itself: a six-digit code by email or WhatsApp on a
  native screen, for people the organization has added (nobody new can be created), with
  a resend timer, Android's code autofill, and a note saying why the last session ended
  (signed out by an administrator, suspended, timed out). The app owns the session: it
  keeps it in the Android Keystore, refreshes it before it runs out, and is the only
  thing that ever refreshes it; the CRM page in the app reads that session and asks the
  app for a fresh one rather than refreshing it itself, so the two can never race on one
  refresh token. The page is loaded only after signing in. Signing out of the app ends
  only this phone's session, not the person's other devices. App builds now need the
  Supabase address and publishable key (`tool/build-release.sh` reads them from the
  web's `.env.local`). See ADR 0013.
- The Android app also keeps the session's rules itself: what the drawer offers comes
  from the app's own access check, and the app sends the activity heartbeat, records
  the sign-in for User Management, warns after 40 minutes without activity and signs
  out at 45, ends the session 8 hours after signing in, and signs out at once when an
  administrator ends the session. The page in the app no longer runs its own copies.
  After a wrong code, the sign-in keeps the code field and keyboard ready for the next
  try.
- Purchase orders is native in the Android app: the list a page at a time with a
  server search (PO number, vendor, brand, CRM reference), each with its vendor and the
  sales order it was raised for; each order's figures (payment requested, still to
  request), lines and vendor, order and history details; and adding and editing with
  the web form's fields and rules: the sales order (which fills in the campaign, brand
  and reference), the vendor and its address (picked for you when it has one), and
  lines that can each be linked to the sales order line they supply, with the margin on
  each and in total. Saved the way the web does it: the order first, then all new lines
  in one request, removed again if the lines are refused; an edit keeps the vendor
  address, so a purchase order never turns into a sales order. "New PO" on a vendor now
  opens this native form. A link to another sales order's line is dropped when the
  sales order changes, where the web form keeps it.
- Sales orders is native in the Android app: the list a page at a time with a server
  search (order number, client, CRM reference) and a status filter, purchase orders left
  out as on the web; each order's figures (total, before tax, tax, received, balance
  due), its lines with their GST split, and the order, campaign and history details,
  with a note when the stored total no longer matches the lines; and adding and editing
  with the web form's fields, lists and money rules. GST is worked out from each line's
  rate and the totals from the lines, the same way `src/lib/gst.js` does (checked
  against the web's own rounding). A save writes the order, then all new lines in one
  request; a new order whose lines are refused is removed again, and an edit changes
  saved lines in place, so purchase-order and invoice links stay. Edit shows only where
  `sales_orders.edit` reaches: on every order with "all", on the person's own with
  "own". A sales order's lines are the ones without a `purchase_order_id`: purchase
  order lines carry the sales order's id too, to say what they were bought for, and
  are never shown or saved as its own. "New order" on a client now opens this native
  form. "Tax invoice" opens the
  new web page `/sales-orders/:id/invoice`, which draws the PDF from the template as
  the Sales orders page does, and Back returns to the native list.
- `/sales-orders/:id/invoice` on the web: one order's tax invoice PDF on a page of its
  own, with Download again and Try again.
- The page tells the Android app how far each permission reaches (`scopes`, 'own' or
  'all' and so on) alongside the permission list, so a native screen can offer Edit
  only where RLS allows it. An app talking to an older page treats every permission it
  holds as 'all', and RLS still refuses the rest.
- Vendors is native in the Android app: the list a page at a time with a server
  search and status, media and sub media filters; each vendor's details (contact, media
  and terms, tax, bank with the account number masked until asked, address, and its
  document through a ten-minute signed link); adding and editing with the web form's
  fields and rules, saved step by step and undone on failure as the web form does; and
  "New PO", which opens the web purchase order form with the vendor chosen. Country,
  state and city are typed with suggestions from places already in use, and the PIN code
  is not looked up, where the web form uses a world place list and a postal lookup.
- WhatsApp Campaigns is native in the Android app: every campaign with how far it got
  and who has not received it, live progress while one is sending, each campaign's own
  performance screen, and a native new-campaign wizard (choose people, an approved
  template, its variables and header file, then send at a chosen pace with Stop and
  Resume, after a confirmation that says real, charged messages go out). The wizard
  sends a one-time request id with the start and never repeats a request by itself; a
  lost start is tried again only when the person chooses, with the same id. That is
  safe only once D1 migration 0013 and the campaign request-id fix are live, so the
  APK must ship after them. The web keeps its wizard, now also at
  `/whatsapp/campaigns/new` (the web dashboard's button goes there).
- WhatsApp Contacts is native in the Android app: the list a page at a time with a
  server search, each contact's details with Call and Send template (consent asked,
  opted-out numbers refused), and a long press to select contacts to delete, asking
  first. "Import a spreadsheet" opens the web importer at the new
  `/whatsapp/contacts/import`, and Back returns to the native list.
- Removed `GET /api/campaigns/stats`, the old dashboard's all-time count over
  every message, which nothing uses any more. Deploy the web right after the API:
  until it is live, the old dashboard page asks for that route.
- A page for each WhatsApp campaign at `/whatsapp/campaigns/<id>`, opened from
  the dashboard or the Campaigns list: audience to replies funnel, failure
  reasons, how fast deliveries and reads arrived hour by hour, replies within
  seven days, opt-outs since, and the list of people who have not received it
  with the existing retry. `GET /api/whatsapp/analytics/campaigns/:id` reads
  only that campaign's messages and keeps the answer once its receipts settle;
  a retry makes it count again.
- Button taps on WhatsApp templates, on the dashboard and each campaign's page,
  web and app. Quick-reply taps are counted exactly from the replies in our own
  records (each tap answers the message it was sent on), so they work today.
  Link-button taps and spend per template come from Meta's template insights:
  they show whenever Meta answers and are hidden otherwise, so they appear by
  themselves if insights are ever switched on.
  `scripts/whatsapp/check-template-insights.mjs` checks, read-only, whether Meta
  answers for the account's templates with website buttons.
- WhatsApp STOP and START replies. A customer whose message is just STOP (any
  capitals) is opted out and gets one confirmation reply: "Your request to STOP
  receiving updates has been successfully registered. Please reply START if you
  would like to start receiving important updates on WhatsApp again. Thank you."
  The reply is kept in the chat. Campaigns skip opted-out people, and the inbox
  shows an "Opted out" tag in the chat list and Contact info plus a warning above
  the message box. A reply of START opts them back in and confirms it: "Your
  request to START receiving updates has been successfully registered. Please
  reply STOP if you would like to stop receiving important updates on
  WhatsApp. Thank you." Someone who was not opted out gets no reply to START.
- Android app (`dikho-mobile/`), a Flutter shell around the deployed CRM with
  native downloads, uploads, external-link handling and self-updates, plus its
  update Worker (`cloudflare-updater/`). Built and tested on emulators with a test
  signing key. Not deployed or distributed: that needs a production signing key
  and the owner's approval. See `docs/ANDROID.md` and ADR 0011.
- Larger tap targets on phones for CRM buttons, search and pagination. Desktop is
  unchanged.
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

- Android app V1.1.0, with native screens. The drawer, WhatsApp inbox and a new Phone
  contacts screen are Flutter; every other module stays the CRM in a WebView. See ADR
  0012.
  - The inbox pages through every chat (30 at a time) with server search, opens a chat on
    its newest 50 messages, and updates live over its own realtime connection. All of
    the browser inbox's actions are there: reply, media, voice notes, reactions, stars,
    pins, forwards, rich messages, templates, clear, delete, block.
  - Phone contacts lists the phone's own contacts, which stay on the phone. Call places
    the call directly, and a WhatsApp template can go to any number, with consent asked
    and a daily ceiling across all staff (`WHATSAPP_DIRECT_TEMPLATE_DAILY_CAP`).
  - Voice notes record natively as OGG/Opus on Android 10 and later.
  - The session moves from WebView storage to Keystore-encrypted storage.
  - A release can be required, which blocks the app until it is installed. Optional
    updates can be put off until the app is next opened, and the newest release always
    replaces anything ignored before it.
  - The launcher logo animation is drawn natively and no longer waits on the page.
  - Release builds strip Android logging and obfuscate Dart, and there is a separate
    build for Google Play with no self-update.
- Clients is native in the Android app: the list as you scroll, a server search, details
  with Call and Email, adding and editing a client with the web form's fields and rules, and
  New order, which opens the CRM's sales order form with that client chosen. Saves go
  through Supabase with the person's own session, so RLS decides who may add or edit.
- Back in the Android app no longer jumps to some other page from the screen the app opened
  on. It asks before leaving, as from any first screen.
- Leads is native in the Android app too: a page of 25 at a time as you scroll, a server
  search, the WhatsApp confirmation for each lead, and details with Call, WhatsApp and
  Email. It reads Supabase with the person's own session, so RLS decides what it sees.
- API for the app: `limit`, `cursor`, `q` and `unread` on the conversation list, `limit` on
  a thread, and `POST /api/whatsapp/conversations/template` to send to a phone number.
  D1 migration 0013 adds the indexes and the daily counter.
- Canonical repository and nested `AGENTS.md` guidance for AI-assisted work.
- Product, invariant, architecture, database, testing, deployment, branding,
  configuration, permissions, upgrade and security-audit documentation.
- A visual system handbook with trust-boundary diagrams and synthetic UI
  screenshots.
- Isolated tests for session verification, Turnstile verification, webhook
  signatures and protected-media tickets.

### Changed

- In the Android app, "Saved … to Downloads" with Open now goes after its 10 seconds.
  Flutter keeps any message with a button until it is dismissed, so it stayed over the
  screen and, on native screens, over their own buttons (a tap on New order opened the
  file instead). With a screen reader on, it still stays until dismissed.
- Searching Leads works again. `mobile` is a numeric column, and the search also asked
  for a text match on it, which the database refuses, so searches most likely failed.
  A whole number, with or without its country code, now finds its lead.
- Leads can be opened on a phone. Tapping a lead did nothing, and the columns with its
  number, email and city are hidden at that width. A tap now opens its details with
  Call, WhatsApp and Email.
- WhatsApp Contacts loads 30 at a time as you scroll, searches on the server, shows real
  totals and uses cards on phones. It used to draw every contact at once, which froze
  phones.
- The web app no longer shows its loading logo for routes that load within 300ms, and
  fetches route code ahead of time. Files with a content hash in their name are cached
  for a year, so returning visits do not ask for them again.
- Inbox voice notes can record in browsers. `Permissions-Policy` said
  `microphone=()`, so Chrome refused every recording before asking the person. It
  now says `microphone=(self)`: this origin only, and a cross-origin frame still
  cannot use it. Every other listed feature stays off.
- The open chat no longer runs off the side of phones under about 400px wide,
  which hid the mic, the message times and the chat menu, and no longer pushes
  the conversation list out of view on a phone held sideways or a small tablet.
- The Android launcher icon no longer has its corners cut by round icon masks.
- The campaign wizard after an import: only that file's contacts are listed,
  all selected, 25 to a page with a pager (All contacts shows everyone), and
  the import message has a Continue button, so nobody scrolls thousands of
  rows. The chosen template is clearly marked (outline, tick, Selected) with
  its phone preview beside the list. The Preview step lists every column of
  the file for each variable, including the phone column, and a table shows
  what each number will get, 10 to a page. A First Name column now beats a
  loose name match such as "Original Contact Name".
- Contact imports are read in the browser and shown for checking before
  anything is saved: the WhatsApp number, spare phone columns, name (or first
  plus last name), email and company are detected and can be changed. Numbers
  are checked with `libphonenumber-js` (new dependency, MIT, no dependencies of
  its own, loaded only when a file is chosen), so order IDs, landlines,
  placeholders and numbers Excel rounded to 9.19877E+11 are skipped with a
  reason. Title rows above the headers and sheets with no header row are
  handled, blank or repeated headers keep their columns, and names in one case
  are tidied. A re-import writes only contacts that changed. In the campaign
  wizard the imported file's contacts are selected, even ones older than the
  newest 2,000 the list shows.
- WhatsApp campaigns are sent at a chosen pace (a batch of 40 every 30 seconds
  by default, or every minute, or without pauses), with live progress and a
  Stop button. Sending stops by itself when Meta reports a spam limit, a paused
  or mismatched template, an account block, a payment problem, a bad token or a
  rate limit, or when most of a batch fails; people not yet messaged stay on
  the campaign to send later. Campaigns stopped this way show as Stopped.
- A template's header video, photo or PDF can be uploaded from the wizard; it
  goes to Meta once and every message reuses the media ID.
- People who choose "Stop promotions" in WhatsApp (Meta error 131050) are
  opted out of campaigns automatically.

- The screens that still differed from the agreed mockups now match them:
  - Sign-in is one plain card; the blue welcome half is gone.
  - Sidebar in the mockup's order (Clients, Leads, Sales orders, Vendors,
    Purchase orders, WhatsApp, Email, Users, Settings). Settings is a row in
    the list instead of a gear in the footer; no "Beta" tags; the account
    initials sit on the soft brand tint.
  - WhatsApp panels, tables and inbox columns show their hairline borders.
    Tailwind's border classes never drew a line here because preflight is
    off; `src/tailwind.css` now gives them a style, width and colour.
  - WhatsApp overview is titled "WhatsApp", with delivery health as one
    card of label-left, value-right rows.
  - WhatsApp contacts: a one-line drop box, then the shared search with the
    contact count beside it.
  - WhatsApp inbox: initials on the soft brand tint instead of a bright
    colour per contact, smaller avatars, an outlined search box and filter,
    a line between chats, a white list.
  - User management is called Users, with Add user at the top right.
- One look across the dashboard, phase A of the redesign
  (`docs/DESIGN.md`, `docs/tasks/2026-10-29-site-redesign.md`):
  - Neutral greys in light and dark, with Dikho blue as the only accent.
  - A smaller, calmer type scale and controls on Clients, Vendors, Sales
    orders, Purchase orders and Settings.
  - Details panels show label-left, value-right rows.
  - The sidebar uses neutral text and a softer highlight.
  - Navigation and section names are in sentence case.
- Redesign phase G, the last: sign-in, vendor registration, the account
  and idle dialogs, the no-access page, placeholders and loading screens
  in the same style. Vendor registration labels are in sentence case and
  its dropdown prompts read "Choose media" instead of "— Select Media —".
  The corporate gifting page is unchanged.
- Redesign phase F: Email in the same style (no all-capitals labels,
  two weights, shared button and input sizes, figures as grey tiles).
  Email is still off unless switched on.
- Redesign phase E: WhatsApp in the same style. The overview's totals are
  plain figures, tables have sentence-case headers and size to their
  content, statuses read "Approved" or "Completed", buttons match the rest
  of the app, and the inbox frame is neutral grey. Chats keep WhatsApp's
  bubbles and wallpaper.
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

### Fixed

- WhatsApp campaigns with a photo, video or document header no longer fail
  every message with Meta error 132012 ("Parameter format does not match").
  The send left the header out and only sent the body. The campaign wizard now
  asks for the header file (a public https link or a WhatsApp media ID) and
  sends it as the header component, next to the body variables (named ones
  with `parameter_name`). The API refuses such a campaign without a valid file
  before anything is stored or sent. The file is kept with the campaign's
  variables, so a retry sends it too; a campaign sent before this fix has no
  file saved and its retry is refused with a message saying so. The inbox,
  lead confirmations and staff welcome still do not fill media headers.

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
