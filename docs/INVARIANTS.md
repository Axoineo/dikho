# System Invariants

Last reviewed: 2026-10-04

An invariant is a condition that must remain true across refactors, feature work
and infrastructure changes. If a requested change conflicts with one, stop and
make the tradeoff explicit rather than silently weakening it.

## Identity and authorization

- Sign-in is invite-only; OTP requests must not create new users.
- Supabase owns OTP generation, verification and session issuance.
- A valid session establishes identity, not authorization.
- User provisioning is an administrator action.
- Before users have different trust levels, sensitive operations must gain
  explicit role and organization checks in both API code and RLS.
- Client-side route guards, disabled buttons and CORS are never relied on as the
  sole access-control layer.

## Secrets and privacy

- Privileged credentials never enter browser bundles or `VITE_` variables.
- Secrets, OTPs, session tokens and signed media URLs never enter Git or normal
  application logs.
- Phone numbers, email addresses, message content and documents are logged only
  when strictly required, sanitized and retention-controlled.
- Public identifiers are not treated as authentication credentials.

## Public intake

- Public database writes pass through a server-controlled verification path.
- Turnstile verification checks success, expected action and allowed hostname
  and fails closed on missing configuration.
- Turnstile adds bot friction but is not treated as a hard volume/spend limit.
- Operations that spend quota, send messages or consume storage have an
  enforceable global bound.
- Security-sensitive defaults such as approval status and opening balance are
  assigned server-side.
- The current direct anonymous vendor-document upload violates the desired
  public-write invariant and remains tracked as an open finding; it must not be
  copied to another feature.

## WhatsApp

- Meta webhooks are accepted only after verifying the raw-body HMAC.
- Provider retries cannot duplicate message records or side effects.
- A campaign/contact pair is claimed before send and cannot be successfully sent
  twice by concurrent/replayed requests.
- The intended campaign audience is recorded so unattempted recipients remain
  recoverable after interruption.
- Status processing does not downgrade a message from a stronger known delivery
  state.
- Free-form replies respect the provider customer-service window.
- Public confirmation sends obey both per-number cooldown and global daily cap.
- Re-hosted customer media remains private and is exposed only through
  authentication or a short-lived scoped capability.

## Financial data

- Monetary values use fixed precision; floating-point display state is not the
  authoritative amount.
- A line total equals taxable amount plus total tax.
- Total tax equals the sum of applicable GST components.
- An order subtotal/tax/grand total reconcile to its line items.
- Payment allocations cannot exceed the payment amount or invoice balance.
- Issued financial documents and their line items are not silently mutated;
  corrections use an explicit workflow and audit record.
- Generated documents reflect persisted authoritative data.

## Data and migrations

- Supabase browser access is constrained by enabled RLS.
- Private Storage still requires narrow object policies.
- Deployed migrations are append-only; corrections use new forward migrations.
- Security-definer functions use a safe `search_path`, qualified objects,
  narrow inputs and explicit grants.
- Historical schema snapshots do not define current production truth.
- D1 timestamp formats remain sortable within each table/query.
- Destructive production changes require backup, rollback and explicit approval.

## Files and untrusted content

- Upload/import byte limits are checked before complete buffering where
  practical.
- Accepted formats are allowlisted and content is validated beyond filename and
  caller-provided MIME type.
- Archive entry count, expanded size and compression ratio are bounded.
- Row count, column count and field/cell length are bounded.
- Storage keys are generated or strictly validated server-side.

Some current import/media paths do not yet satisfy every file-processing
invariant. Treat this as remediation work, not precedent.

## Operations and observability

- External errors do not reveal stack traces, SQL text or credential state.
- Required upstream calls have bounded timeouts.
- Idempotency and audit records needed for reconciliation are retained long
  enough to repair expected races/failures.
- A passing build is not represented as passing tests.
- Deployments, remote migrations, credential changes, real message sends and
  destructive actions require explicit human authorization.

## Productization and branding

- The current installation serves Dikho Global Media LLP.
- The first public distribution model is one organization per isolated
  self-hosted instance; shared multi-tenant isolation must not be implied.
- Logos, colors, organization copy and provider selection are configuration,
  not forks of authorization or data-integrity logic.
- Branding must never weaken authentication, RLS, file validation, webhook
  verification, idempotency, budgets or audit history.
- Private provider credentials remain in the deploying organization's server
  secret stores and never enter theme files, browser configuration or setup
  screenshots.

## Changing an invariant

Change an invariant only through a reviewed ADR that documents:

1. why the old condition is no longer correct;
2. impact on security, privacy, money and operations;
3. the replacement condition;
4. migration and rollback steps;
5. new verification that enforces it.
