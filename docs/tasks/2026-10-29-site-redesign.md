# Task: One look for every screen

Status: active
Owner: Dikho Global Media LLP (owner) with a coding agent
Started: 2026-10-29
Last updated: 2026-10-29

## Goal

Every screen follows [the design rules](../DESIGN.md), taken from the
Settings mockup the owner chose: neutral surfaces, thin borders, label-left
rows, small controls, one blue action per screen.

## Why now

The owner wants the whole CRM to look like that mockup. The app had three
visual systems (the CRM layer, the older global styles, and the WhatsApp and
Email kits), so screens looked unrelated.

## Non-goals

- No behaviour, data or permission changes inside a restyle, except the
  extras listed under decisions.
- The corporate gifting page (`/corporategifting`) is not touched.

## Acceptance criteria

- [ ] Each phase matches the mockups at desktop, tablet and phone widths, in
      light and dark.
- [ ] Text contrast at least 4.5:1 on the surfaces it sits on, both themes.
- [ ] Existing flows (add/edit client, vendor, sales and purchase orders,
      Settings) still save.

## Relevant sources

- Design rules: `docs/DESIGN.md`.
- Code paths: `src/index.css`, `src/components/crm/`, `src/components/Sidebar.jsx`,
  then each module under `src/features/`.

## Plan

One PR per phase, verified locally before pushing; the owner merges.

1. A, foundation: tokens, CRM layer, sidebar.
2. B, CRM screens and Leads, plus the extras below.
3. C, Settings pages.
4. D, Users and Live Assist.
5. E, WhatsApp (the chat keeps WhatsApp's bubbles and wallpaper).
6. F, Email.
7. G, sign-in, vendor registration, account and idle dialogs, no-access and
   placeholder pages.

## Decisions made

- 2026-10-29: Keep Google Sans. Light sidebar, no section labels. WhatsApp
  chat keeps its own look; only the frame changes.
- 2026-10-29: Extras left to judgement and reviewed later: a status filter
  on Sales orders, "New order" and "New PO" shortcuts in the client and
  vendor panels, the vendor's bank account number masked in the panel with
  a Show button. Not doing: a Leads source filter (one source today), a
  CRM card in the WhatsApp contact panel.

## Work completed

- Phase A (branch `ux/redesign-foundation`):
  - Neutral palette in `src/index.css` for light and dark.
  - CRM type scale (12/13/15/18/20px), weights 400 and 500, 32px buttons,
    34px inputs, 48px table rows, quieter table headers and status pills.
  - Details panels as label-left rows on the page tone.
  - Form dialogs with muted labels and a tinted footer.
  - Sidebar: neutral text, 8px highlight, 34px rows.
  - Sentence-case navigation and section names.
  - Table rows no longer show a monogram beside the name.

- Phase B (branch `ux/redesign-crm-pages`, built on phase A):
  - Leads moved onto the shared CRM components: metric tiles, search,
    table, pagination, status pills, rows-per-page preference. Its own
    stylesheet is deleted.
  - Sales orders: a status filter beside the search box.
  - "New order" in a client's panel opens a new sales order with that
    client and contact chosen. "New PO" in a vendor's panel opens a new
    purchase order with that vendor (and its only address) chosen. Each
    shows only to people who can create that order.
  - The vendor panel shows the bank account number as its last four
    digits, with Show and Hide.
  - The Vendors filter panel, "/" suggestions and filter chips use the new
    style.
  - Shared `MetricTile`/`Metrics` and `MaskedValue` in `CrmUi.jsx`.
  - Preview harness: Leads route with sample leads and WhatsApp statuses.

- Phase C (branch `ux/redesign-settings`):
  - Card names sit above their cards in small grey type.
  - Company and Bank are label-left rows with the input on the right
    (`FieldRow` in `SettingsParts.jsx`). Errors show under the label.
  - Regional uses two segmented rows whose choices are written the way
    they will look ("29 Oct 2026", "₹1,00,000"). The large choice cards
    are gone.
  - Lists and media, the Settings navigation and the sessions cards use
    smaller rows and controls.

- Phase D (branch `ux/redesign-users`):
  - User management uses the shared page header (no all-capitals label)
    and sentence-case names ("User management", "Departments and teams",
    "Access and permissions").
  - `users.css` rewritten on the design tokens: quieter tabs, metric-style
    tiles, 32px controls, round status and role pills, label-left rows on
    the profile cards, a lighter permission grid, tighter templates,
    departments and audit log. The older shared pieces it uses (search
    box, buttons, form fields, table card, error note, dialogs) are
    restyled inside `.um-page` only.
  - Phones: the people list shortens long addresses and hides the row
    arrow, so it fits without sideways scrolling.
  - Live Assist dialogs, toasts and pill on the same type and buttons,
    using only app-wide tokens (they appear over any page).
  - Preview harness: `/users`, `/users/:id` with sample people, templates,
    departments and audit entries; `/assist` and `/assist/incoming` show
    the Live Assist pieces.

## Remaining work

- Phases E to G.

## Verification

| Check | Result | Evidence/notes |
| --- | --- | --- |
| `npm run check` (phase A) | pass | lint 0 errors, 228/228 tests, build, secret scan |
| Screenshots (phase A) | pass | Clients, Vendors, Sales orders form, Settings at 1440 and 390, light and dark; collapsed sidebar; compact density |
| Contrast (phase A) | pass | text and muted at least 5:1 on every light and dark surface; placeholder 4.5:1 or better on input fills |
| Client edit and save (phase A) | pass | preview harness: toast "Client saved", record updated |
| `npm run check` (phase B) | pass | lint 0 errors, 228/228 tests, build, secret scan |
| Phase B flows | pass | status filter (only Completed rows, count, empty state); New order from a client saves with client and contact; New PO from a vendor picks vendor and address; account number masked, Show reveals it; viewer sees neither shortcut |
| Screenshots (phase B) | pass | Leads light, dark and phone; Vendors panel, filters (light and dark) and "/" suggestions; Sales orders panel (dark); new purchase order form |
| `npm run check` (phase C) | pass | lint 0 errors, 228/228 tests, build, secret scan |
| Phase C flows | pass | Company: bad GSTIN blocked with the reason under its label, focus moved, valid GSTIN fills the state code and saves; Regional: date and number style save; Lists: add and hide |
| Screenshots (phase C) | pass | all six sections at 1440; Company, Regional, Lists in dark; Company and Regional at 390; Company at 820 |
| `npm run check` (phase D) | pass | lint 0 errors, 228/228 tests, build, secret scan |
| Screenshots (phase D) | pass | People (light, dark, phone), templates, departments, audit log, profile overview, access grid (light and dark), sessions, Add user and Suspend dialogs, profile on a phone (dark); Live Assist ask dialog (light and dark), pill, helper toast, consent dialog. Phone people table measured: no overflow |
