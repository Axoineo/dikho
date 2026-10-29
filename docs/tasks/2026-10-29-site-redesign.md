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

## Remaining work

- Phases B to G.

## Verification

| Check | Result | Evidence/notes |
| --- | --- | --- |
| `npm run check` (phase A) | pass | lint 0 errors, 228/228 tests, build, secret scan |
| Screenshots (phase A) | pass | Clients, Vendors, Sales orders form, Settings at 1440 and 390, light and dark; collapsed sidebar; compact density |
| Contrast (phase A) | pass | text and muted at least 5:1 on every light and dark surface; placeholder 4.5:1 or better on input fills |
| Client edit and save (phase A) | pass | preview harness: toast "Client saved", record updated |
