# Task: Clients, Vendors, Sales Orders and Purchase Orders look and work like one product

Status: active (awaiting owner review; nothing committed or deployed)
Owner: Dikho Global Media LLP (owner) with a coding agent
Started: 2026-10-28
Last updated: 2026-10-28 (implementation complete, not committed)

## Goal

The four CRM modules share one calm, consistent layout: page header,
toolbar, table, details panel and form. Controls that do nothing are gone,
records that should be editable are, and the order forms show what most
orders need with the rest one click away.

## Why now

The owner reported that the site's formatting "looks weird" and that days of
work had not produced a change worth showing. A design audit on 2026-10-28
found the causes: no type scale (69 font sizes in CSS, 172 one-off sizes in
JSX), duplicated counts, inert checkboxes, inline-styled popovers, and order
forms with ~30 header fields and ~18 fields per line item.

## Non-goals

- No change to how orders are saved, totalled or reconciled
  (`reconcileSalesOrderTotals`, `writeRows` fallbacks, item upsert/delete).
- No database, RLS or migration changes. Edit buttons rely on the existing
  `clients.edit` / `vendors.edit` permissions and RLS update policies.
- No redesign of WhatsApp, Email Hub, Users or the public pages.

## Acceptance criteria

- [x] All four list pages: one header (title, short subtitle, actions), one
      search/toolbar row, a table whose rows open the details panel on a
      single click, one result count, pagination with correct arrows.
- [x] No selection checkboxes on Clients or Vendors.
- [x] Clients and Vendors have Edit in their details panel, shown only with
      the edit permission; saving updates the row in place.
- [x] Sales and Purchase Order forms show essentials first; every other
      existing field is still editable under "More details".
- [x] Dead purchase-order delete dialog removed.
- [x] Verified in light and dark, desktop and phone width, with the
      `scripts/preview/crm.html` harness.
- [x] Purchase orders are listed from the table they are saved to, and
      editing one keeps it a purchase order (found during this task).

## Relevant sources

- Code paths: `src/features/{clients,vendors,sales-orders,purchase-orders}/`,
  shared rules in `src/index.css`, `src/components/`.
- Permissions: `supabase/migrations/20261006150000_user_management.sql`
  (`apply_crud_policies` for `clients` and `vendors`).

## Decisions made

- 2026-10-28 (owner): add Edit to Clients and Vendors.
- 2026-10-28 (owner): remove the inert checkboxes rather than restore export.
- 2026-10-28 (owner): hide rarely used order fields under "More details"
  instead of deleting them, so no data becomes uneditable.
- 2026-10-28 (owner): orders stay non-deletable; remove the unreachable
  purchase-order delete dialog.

## Work completed

- `src/components/crm/` (`CrmUi.jsx`, `crm.css`): the shared header, search,
  table, pagination, details panel, form modal, fields, segmented control,
  "More details" disclosure, share link and toast. rem type scale, tokens
  for both themes, Escape closes the top layer only.
- Clients: new table, panel, and `ClientForm.jsx` (add and edit; replaces
  `AddClientModal.jsx`). Writes `country_dialcode`, which the old form showed
  but never saved.
- Vendors: same layout; `VendorForm.jsx` (add and edit; replaces
  `AddVendorModal.jsx`) updates the vendor and its primary address; a new
  document is uploaded beside the old one. Search, the "/" chain and the
  filter panel are unchanged. `ContactHoverAction` removed (plain links).
- Sales orders: list, panel (money summary, items, order, campaign, history,
  Invoice button) and form regrouped; save logic untouched. Invoice errors
  show inline instead of `alert()`.
- Purchase orders: list reads `salesorder` with `vendor_address_id` set,
  embedding vendor and address, plus the linked SO number from its items.
  `poToForm` keeps vendor, address and SO. A vendor address is required and
  auto-picked when there is one. Unused media lookups and the unreachable
  delete dialog removed.
- `src/index.css`: 397 rules whose classes no source file references were
  removed (4,342 to 3,252 lines). The three chip states built at runtime
  (`is-${token.status}`) were restored by hand.
- `src/lib/format.js`: `formatDisplayDate`, `formatDateRange`,
  `formatRupees`, `formatPhone` for screens only.
- `scripts/preview/crm.html`: harness with the real sidebar, a PostgREST
  stand-in that keeps writes, `?role=viewer`, and `window.__crmDb`.
- Owner follow-up: example text removed from every labelled input box across
  the app (CRM forms, vendor registration, sign-in, Add user, Email Hub,
  WhatsApp send dialogs, Ask for help). Kept: search bars, message boxes,
  dropdown prompts. The corporate gifting page was left alone at the owner's
  request.

## Remaining work

- Apply the same layer to Leads, Users, WhatsApp and Email screens, which
  still use the legacy styles.
- Not verified against the real database: client/vendor edit, PO list and
  PO save (production had 0 purchase orders on 2026-10-28). First real use
  should be watched.

## Verification

| Check | Result | Evidence/notes |
| --- | --- | --- |
| `npm run check` | pass | lint 0 errors, 228/228 tests, build, secret scan |
| Harness screenshots, light/dark, desktop/phone | pass | headless Chrome, all four modules, list, panel, form |
| Add/edit round trips against the stub | pass | client add+edit, vendor edit, SO edit, PO edit (address kept), PO new (saved as PO, linked) |
| Untouched screens unchanged after CSS pruning | pass | 0 px difference: sign-in, WhatsApp overview, Email settings, vendor registration; gifting page differs only in its moving logo strip |
| Against the real database | not run | no production writes were made |

## Risks, blockers and rollback

- Risk: the shared CSS classes (`.page-header`, `.table-card`, `.modal-card`,
  `.field`) are used by other screens too; check them after changing.
- Rollback: revert the branch; there is no data or schema change.
