# Branding and Organization Identity

Last reviewed: 2026-10-04

The current application serves Dikho Global Media LLP. The planned public
release will let one organization configure its own isolated instance. That
direction is accepted in [ADR 0005](decisions/0005-one-organization-per-instance.md);
the configuration mechanism described below is **proposed, not implemented**.

Today, replacing the main logo or changing one CSS color does not fully rebrand
the application. Identity appears in the HTML boot screen, React screens,
public marketing content, assets and document templates. Settings currently
provides a personal light/dark/system preference, not an organization editor.

## Current customization map

These are source locations verified during this documentation pass. Review
them again before implementation; this table does not authorize a bulk rename.

| Surface | Current source | Customization work still needed |
| --- | --- | --- |
| Main logo and browser icons | [main SVG](../public/dikho-logo.svg), [HTML](../index.html), `public/favicon*`, `public/apple-touch-icon.png` | Supply logo variants and regenerate favicon/touch assets. Existing layout assumes the current logo proportions. |
| Browser title and social previews | [HTML](../index.html), [public layout](../src/layouts/PublicLayout.jsx), [authenticated layout](../src/layouts/AuthenticatedLayout.jsx), `public/og-image.png` | Derive initial HTML and route titles from the same public identity; replace social preview artwork and description. |
| Boot splash and route loading | [HTML](../index.html), [BrandLoader](../src/components/BrandLoader.jsx), [route error boundary](../src/components/RouteBoundary.jsx) | HTML embeds glyph definitions; React references their IDs. Replace the coupled animation with a generic logo loader or generate matching assets, preserving the ready/error/reload behavior. |
| Navigation and authentication | [Sidebar](../src/components/Sidebar.jsx), [Login](../src/features/auth/Login.jsx), [Settings](../src/features/settings/SettingsPage.jsx) | Centralize logo paths, accessible names and organization copy. Check collapsed navigation and mobile layouts with different logo shapes. |
| Internal theme | [design tokens](../src/index.css), [Tailwind mapping](../tailwind.config.js) | Centralize brand colors plus their light/dark foregrounds, tints, borders and focus states; replace remaining literal brand colors deliberately. |
| Public lead page | [page component](../src/features/public/PublicClientWelcome.jsx), [page stylesheet](../src/features/public/corporate-gifting.css), [clientele data](../src/features/public/clientele.js) | Configure marketing copy, website/social links and approved proof content. The page uses a separate fixed-light palette, so internal theme tokens alone do not update it. |
| Public vendor form | [form component](../src/features/public/PublicVendorForm.jsx), `pvf-*` rules in [stylesheet](../src/index.css) | Configure logo, accessible names and public copy; preserve verification, validation and server-controlled defaults. |
| Sales-order PDF export | [export caller](../src/features/sales-orders/SalesOrdersPage.jsx), [PDF generator](../src/features/invoices/generateTaxInvoice.js), `public/Temps/SO_template.pdf` | Replace or generate the branded template. Current text placement uses fixed coordinates and separate font assets; a new template must be verified against those constraints. |
| Order actor fallback | [sales-order helpers](../src/features/sales-orders/salesOrderHelpers.js), [purchase-order page](../src/features/purchase-orders/PurchaseOrdersPage.jsx) | The `created_by` fallback contains a brand label. Define authoritative actor attribution separately; substituting an organization name is not an audit solution. |
| Persistent preferences and storage | [authenticated layout](../src/layouts/AuthenticatedLayout.jsx), [public vendor form](../src/features/public/PublicVendorForm.jsx) | Brand-bearing local-storage keys and an existing Storage bucket are technical identifiers. Preserve compatibility or plan a specific migration rather than renaming them with display text. |

The WhatsApp thread/preview has deliberate provider-specific colors in
[Tailwind](../tailwind.config.js) and [CSS](../src/index.css). Organization
branding should cover surrounding application chrome while retaining the
chosen messaging treatment unless an explicit design decision changes it.
Success, warning and danger colors also carry meaning beyond brand identity.

Files under `public/` are downloadable assets. Audit templates and examples,
embedded PDF text/metadata, images and marketing proof before distribution;
do not treat that directory as storage for private organization records.

## Proposed configuration contract

Start with a versioned, validated build-time configuration consumed by both
HTML generation and the React application. This fits one organization per
instance and avoids a new runtime dependency for the initial release. A future
administrator editor would require its own authorization, validation, history
and publish workflow.

The field names below are a design proposal, not an existing API or an
instruction to add environment variables.

| Proposed group | Allowed content | Rules |
| --- | --- | --- |
| `schemaVersion` | Supported configuration version | Reject unknown versions with an actionable build error. |
| `identity` | Public display name, product title, tagline and optional approved legal name | Bound string lengths; render as text, never executable HTML. Do not infer who created a financial record from these values. |
| `assets` | Reviewed logo variants, compact mark, favicon, touch icon and social image | Prefer same-origin build assets. Validate format, size and dimensions; review SVGs for scripts, external references and other active content. |
| `theme.light` and `theme.dark` | Primary, primary foreground, accent, surface, text, border and focus tokens | Accept a strict color format; validate the complete token set and contrast combinations. Generate dependent tints consistently. |
| `publicTheme` | Explicit public-page palette or a reference to the validated light palette | Public pages retain predictable appearance independent of a staff member's saved theme. |
| `publicContent` | Approved headings, descriptions, website/social links and optional marketing sections | Bound text; allow only intended URL schemes; omit sections without content. Do not ship the current organization's testimonials or customer logos as another organization's claims. |
| `documentPresentation` | Reviewed logo/template asset references and layout version | Keep document presentation separate from authoritative issuer, payment and transaction records. |

Every value exposed through this contract is public. Provider credentials,
session material, signed URLs, bank account records and private organization
settings must not enter the brand configuration, browser bundle or screenshots.
API/database bindings and security settings belong to the configuration and
deployment guides, not the theme contract.

Use an explicit allowlist of schema fields; reject unknown fields rather than
accidentally passing an entire server configuration into the browser. Validation
errors should name the failing field and rule without echoing its value.
Configuration must not accept arbitrary JavaScript, CSS, HTML, fetch URLs or
authorization overrides. Render optional missing artwork with a readable text
fallback; fail the build for missing required identity or invalid asset inputs.

An example configuration should be added only alongside its schema, loader and
real consumers. Until then, no `config/brand.example.json` is advertised as a
working setup mechanism.

## Financial identity is a separate concern

Changing display branding must not rewrite historical issuer identity, tax
information, payment instructions, document numbering, persisted totals or
actor attribution. A new organization needs its own reviewed issuer profile;
changing that profile is a controlled business operation, not a color setting.

Before general distribution, decide how issued documents retain their issuer
and presentation version: for example, an immutable stored artifact and/or a
versioned issuance snapshot. This is a requirement to design and verify, not
a claim that the current PDF generator already implements it. Rebranding must
not silently change the identity shown when an issued document is reproduced.

The current PDF generator draws onto a fixed template. Test long names,
addresses, supported scripts, many line items and tax groups; overflow must be
handled visibly or rejected safely. A logo change does not establish that the
financial output is correct or that the template suits another jurisdiction.

## Migration sequence

1. **Inventory and choose the initial contract.** Use the map above, search for
   remaining brand literals and classify each as display content, technical
   identifier, financial identity or provider configuration. Keep the existing
   installation's identity as the reviewed default during the transition.
2. **Implement validation and consumers together.** Add the schema, loader,
   synthetic example and explicit public projection. Make invalid configuration
   stop the build before deployment; test representative valid/invalid inputs.
3. **Connect the application shell.** Generate matching HTML metadata, icons,
   boot loader and React identity. Preserve loader failure/retry handling and
   accessibility. Avoid an initial flash of a different organization name.
4. **Connect themes and public pages.** Map semantic CSS/Tailwind tokens and
   route-scoped public colors. Configure optional marketing sections; replace
   organization-specific copy and proof only with reviewed content.
5. **Handle documents and identifiers explicitly.** Design issuer/version
   behavior, validate templates and preserve financial history. Any bucket,
   database or preference-key migration gets a separate compatibility plan.
6. **Prove a second installation.** Use a synthetic organization, different
   logo proportions and contrasting colors in an isolated local/staging setup.
   Complete the acceptance checks below and update the installation guide and
   [visual map](../VISUALIZE.md) with evidence.

These steps are roadmap work. This document does not change deployed branding,
enable self-service installation or close any existing security finding.

## Acceptance checks for implementation

- Public/direct-loaded routes, sign-in, navigation, settings, loading and error
  states show the chosen identity. Check tab titles, initial HTML, favicon,
  social metadata and accessible image names, not just the visible dashboard.
- Check desktop and small-phone layouts, expanded/collapsed navigation,
  keyboard focus, light/dark/system preferences and intentionally fixed-light
  public pages. Verify foreground/background contrast for real token pairings.
- Test wide, tall, monochrome and missing optional logos; long organization
  names; slow assets; failed asset loading; and reduced-motion preferences.
- Generate PDFs with synthetic data. Inspect logo placement, issuer details,
  fonts, totals, line/tax overflow, print output and embedded metadata. Confirm
  previously issued documents keep their historical identity.
- Search the built HTML/JavaScript, generated assets and downloadable templates
  for unintended prior-organization identity. Review matches manually: internal
  compatibility identifiers are not automatically errors.
- Prove that branding changes leave permissions, RLS, Turnstile, uploads,
  webhook verification, message budgets/idempotency and financial calculations
  intact. Theme/module visibility must not become an authorization control.
- Run `npm run check`, the relevant behavior checks in
  [TESTING.md](TESTING.md), and a targeted secret scan of new configuration,
  documentation and outputs. Record what ran; a passing build alone does not
  verify rebranding or isolation.
- Keep screenshots, example configurations and fixture documents synthetic.
  Do not reuse production business data to demonstrate a fresh installation.

See [PRODUCT.md](PRODUCT.md), [INVARIANTS.md](INVARIANTS.md) and
[ROADMAP.md](ROADMAP.md) for the product boundary and delivery priorities.
