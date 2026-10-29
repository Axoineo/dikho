# Interface design rules

Dikho's screens follow one look, agreed with the owner on 2026-10-29 from the
Settings mockup: quiet surfaces, thin borders, rows with the label on the left
and the value or control on the right, small controls, and one blue action
per screen. Restyles move screens onto these rules without changing what they
do.

The tokens live in [`src/index.css`](../src/index.css) (`:root` and
`[data-theme="dark"]`) and [`src/components/crm/crm.css`](../src/components/crm/crm.css)
(`--crm-*`). Shared React pieces are in
[`src/components/crm/CrmUi.jsx`](../src/components/crm/CrmUi.jsx). Prefer them
to page-specific styles.

## Colour

- Neutral greys: `--page` behind everything, `--surface` for cards, panels
  and dialogs, `--crm-subtle` for tiles and read-only values, `--crm-fill`
  for the chosen option of a segmented control.
- Text: `--text` for content, `--muted` for labels and secondary lines (at
  least 5:1 on every light surface), `--crm-placeholder` only inside inputs.
- Borders: `--line` around cards and inputs, `--line-soft` between rows.
- Dikho blue is the only accent: the main button (`--brand-blue`), the
  selected navigation item (`--brand-blue-soft` with `--brand-ink`), links
  and focus. Blue text always uses `--brand-ink`.
- Colour otherwise only means status: green active or done, amber pending,
  red failed or suspended, blue approved or information, purple developer.
- Every colour has a dark-mode value. Check contrast in both themes: 4.5:1
  for text, 3:1 for large text and control outlines.

## Type

Google Sans Text for the interface, Google Sans for titles.

| Use | Size | Token |
| --- | --- | --- |
| Labels, table headers, secondary lines, hints | 12px | `--crm-text-xs`, `--crm-text-sm` |
| Body, table cells, inputs, buttons | 13px | `--crm-text-md` |
| Panel and dialog titles | 15px | `--crm-text-lg` |
| Hero figures | 18px | `--crm-text-xl` |
| Page titles | 20px | `--crm-text-2xl` |

Two weights only: 400 and 500. Sentence case everywhere, including table
headers, buttons and navigation. No all-capitals labels above titles.
Fixed-width figures (`.crm-mono`) for order numbers, GSTIN, PAN and account
numbers.

## Shape and size

- Corners: 8px on controls, 12px on cards and dialogs, round on pills.
- Controls: buttons 32px (28px small), inputs and selects 34px, segmented
  options 26px. Outlined buttons by default; one filled primary per view;
  red only to confirm deleting, suspending or similar.
- No shadows on cards. Floating layers (details panel, dialogs, popovers,
  toasts) keep a soft shadow so they read as above the page.

## Patterns

- **Page header:** title, one-line description, actions on the right.
- **Toolbar:** search (with icon), filters, then the record count.
- **Table:** inside a card; 12px muted headers; two-line cells (main line,
  quieter line under it); rows 48px (40px in compact density); the open
  row tinted grey; pagination in the card's footer.
- **Details panel:** a header (title, status, actions), then sections whose
  12px muted title sits above a card of label-left, value-right rows.
- **Form dialog:** sections with a 13px title, 12px muted field labels above
  inputs, rarely used fields under "More details", and a footer that stays
  in view with any total on the left and Cancel plus the main action on the
  right.
- **Settings and similar:** cards of rows, the setting's name and hint on
  the left and its control on the right.
- **Status:** small round pill, tinted, no dot.
- **Empty state:** an icon, a short title, one line, one action.
- **Toast:** bottom centre, round, three seconds.

## Rules that still apply

- Labelled inputs carry no example text; hints go below the box.
- No em dashes in on-screen text.
- Tailwind's preflight is off, so a `<button>` needs its colour and
  background set.
- Declare `-webkit-backdrop-filter` before `backdrop-filter`.
- The corporate gifting page keeps its own fixed-light design.
