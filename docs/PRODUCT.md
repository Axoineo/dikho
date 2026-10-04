# Product Direction

Last reviewed: 2026-10-04

This document explains what Dikho is trying to achieve. It describes product
intent rather than implementation. Architecture and operational details belong
in the other documents under `docs/`.

## Product mission

Dikho currently gives Dikho Global Media LLP one dependable workspace for
clients, vendors, sales and purchase orders, invoicing, public lead intake and
WhatsApp communication.

The system should replace fragmented spreadsheets and repeated manual work
without sacrificing financial accuracy, customer privacy or operator control.

After the internal product is complete, hardened and documented, the intended
next horizon is a configurable public release for small organizations. An
organization should be able to apply its logo and brand colors, provision its
own hosting, database and storage, configure its own API/provider credentials,
create its administrator and run an isolated instance without building a custom
operations platform from scratch.

The initial distribution target is one organization per self-hosted instance,
not unrelated organizations sharing one database. A shared multi-tenant SaaS
would require a separate architecture and business decision.

## Primary users

- Operations staff managing clients, vendors and campaign execution.
- Sales staff creating and tracking orders and customer relationships.
- Finance staff preparing invoices, receipts and payment allocations.
- Support/communications staff handling WhatsApp conversations and campaigns.
- Administrators provisioning users and managing integrations.
- External visitors submitting vendor registrations or corporate-gifting leads.
- Future organization owners deploying and configuring their own instance.

The current access model assumes one trusted internal team at Dikho Global Media
LLP. The public-release target still requires roles within each organization,
but isolation initially comes from separate deployments rather than a shared
multi-tenant database.

## Core workflows

### Advertising operations

```text
Client → Sales order → Vendor selection → Purchase order
       → Campaign execution → Invoice/payment → Profit review
```

### Vendor onboarding

An external vendor submits business/contact information and supporting
documents. Staff review the pending record before it becomes trusted operational
data.

### Corporate-gifting intake

An external visitor submits a lead. The system records it and may send a delayed,
budget-controlled WhatsApp confirmation.

### WhatsApp operations

Staff import opted-in contacts, send approved templates without duplicates,
track delivery state, retry failures safely and reply to inbound conversations
inside the customer-service window.

## Product principles

1. **Correct before fast.** Financial totals, delivery state and audit history
   must be trustworthy.
2. **Human control over irreversible actions.** Sending, deletion, issuing and
   deployment should be explicit.
3. **No invisible partial failure.** Interrupted imports, sends and writes must
   be recoverable or clearly reported.
4. **Privacy by default.** Store, expose and log only what the workflow needs.
5. **Public does not mean unlimited.** Public forms require verification,
   validation and hard cost/storage limits.
6. **One source of truth per fact.** Derived totals and statuses should have a
   clear authoritative record.
7. **Operational simplicity.** Prefer designs the team and coding agents can
   understand, verify and safely maintain.

## Current priorities

1. Close the anonymous vendor-document upload and broad Storage-policy risks.
2. Add explicit roles/permissions before broadening the user base.
3. Add safe upload/import limits and automated security regression tests.
4. Improve operational visibility, backup/restore confidence and runbooks.
5. Continue improving CRM, finance and WhatsApp workflows without weakening the
   invariants above.
6. Separate organization branding/configuration from core logic and prove a
   clean-room self-hosted installation before public release.

See `ROADMAP.md` for delivery order and `SECURITY-AUDIT.md` for security
detail.

## Non-goals for the current phase

- Open public account registration.
- Multi-tenant SaaS isolation without a designed organization model.
- A central service that holds every adopter's provider credentials.
- Arbitrary WhatsApp messaging outside approved templates/provider policy.
- Treating the browser as a trusted enforcement layer.
- Replacing audited financial records with editable presentation-only state.
- Adding infrastructure or dependencies solely for novelty.

## Success measures

- Operators can complete core workflows without parallel spreadsheets.
- No duplicate or unaccounted WhatsApp sends.
- Public abuse has a measurable, enforced upper bound.
- Financial documents reconcile to their line items and allocations.
- Permission-denied behavior is tested and observable.
- A new developer or coding agent can identify the correct component, invariant,
  verification command and deployment boundary without guesswork.
- A new organization can configure a fresh isolated instance using placeholders
  and documented setup without editing security-critical source.

## Open product questions

These require owner decisions before related implementation:

- Which staff roles are required, and which operations must each role perform?
- What retention periods apply to leads, contacts, login events, webhook
  payloads, documents and WhatsApp media?
- Which actions require dual approval or an immutable audit event?
- What recovery-time and recovery-point objectives are acceptable?
- Which license, support policy and upgrade guarantees will govern the public
  release?
- Which modules and providers must be optional in the first distributable
  version?

Record an answer as an ADR or invariant when it becomes durable.
