# Database and Storage Guide

Last updated: 2026-10-04

Dikho uses two databases for different responsibilities:

- Supabase PostgreSQL stores CRM, vendor, sales, purchase, invoice, payment,
  device and public-lead records.
- Cloudflare D1 stores WhatsApp contacts, conversations, messages, campaigns,
  webhook events, budgets, cooldowns and delayed-send work.

Supabase Storage contains business documents. Cloudflare R2 contains re-hosted
WhatsApp media and avatars.

This guide describes the intended schema from repository migrations. Always
inspect the effective production schema and policies before making access-control
decisions.

## Supabase PostgreSQL

The browser accesses many business tables through PostgREST with its Supabase
session. PostgreSQL RLS is therefore a primary security boundary.

### Main domains

| Domain | Representative objects | Purpose |
| --- | --- | --- |
| CRM | `clients`, `vendors`, `vendor_addresses` | Client/vendor master records |
| Reference data | `media`, `sub_media`, `vendor_media` | Advertising categories |
| Sales/procurement | `salesorders`, `salesorder`, `salesorderdocument`, `purchaseorders` | Orders and line items across schema generations |
| Finance | `organization_profiles`, `invoices`, `invoice_lines`, `payments`, `payment_allocations`, `invoice_sequences`, `document_events` | Invoice/payment lifecycle and audit events |
| Public intake | `cg_leads` and public-write RPCs | Corporate-gifting leads and vendor registration |
| Login audit | `user_devices`, `login_events` | Per-user device and sign-in records |

Some legacy and newer object names coexist. Check the feature query and the
ordered migrations before renaming or removing an object.

### Public write RPCs

Public vendor and corporate-gifting submissions use narrow `SECURITY DEFINER`
functions. They:

- whitelist inserted columns;
- assign server-controlled defaults;
- use an empty `search_path` and qualified object names;
- are executable by the service role, not browser-facing roles, after the
  Turnstile lockdown migration.

The API Worker verifies Turnstile before calling these functions. Re-granting
anonymous execution would bypass that control.

### RLS baseline

- RLS must remain enabled on all browser-exposed business tables.
- `user_devices` and `login_events` allow users to view only their own rows;
  writes are performed by the Edge Function service role.
- Public reference tables may allow anonymous read when the data is intentionally
  public and needed by a public form.
- Direct anonymous mutation of vendor/client/lead tables is removed by the
  lockdown migrations.
- Several business and finance policies still grant all authenticated users
  team-wide access. That is an explicit limitation of the current single-team
  model, not safe multi-tenant isolation.

Before adding users with different trust levels, add organization membership
and role-aware policies. Avoid new sensitive policies using unconditional
`USING (true)` or `WITH CHECK (true)`.

### Finance invariants

Monetary columns use fixed-precision numeric values. Application and database
logic should preserve:

- line total = taxable amount + tax amount;
- tax amount = CGST + SGST + IGST + UTGST;
- order subtotal = sum of line taxable amounts;
- order tax total = sum of line tax amounts;
- order grand total = subtotal + tax total;
- issued invoices and their lines are immutable except through explicit void or
  correction workflows;
- payment allocations may not exceed their payment or invoice balance.

Security-definer financial functions must verify `auth.uid()` and any required
organization/role before reading or mutating rows.

## Cloudflare D1

D1 migrations are in the top-level `migrations/` directory and are applied to
the API Worker's configured database.

### Core tables

| Table | Purpose | Sensitive content |
| --- | --- | --- |
| `contacts` | Campaign/import contacts and template attributes | Phone, name, email, company |
| `campaigns` | Template campaign metadata and stored audience | Sender identity, audience IDs |
| `messages` | Campaign and conversational messages/status | Phones, message bodies, media metadata |
| `conversations` | One WhatsApp thread per phone | Phone, profile name, activity summary |
| `webhook_events` | Idempotency/reconciliation ledger | Provider payload fragments |
| `gstn_lookup_budget` | Global daily GST lookup count | Aggregate only |
| `template_send_cooldowns` | Per-number/template send suppression | Phone and template |
| `cg_lead_whatsapp_budget` | Global daily confirmation-send count | Aggregate only |
| `cg_lead_outbox` | Delayed confirmation queue | Phone and lead name |

D1 has no browser-facing SQL endpoint. All access passes through the API Worker,
so route authentication and authorization are its row-access boundary.

### Idempotency and message ordering

- Campaign sends claim recipient rows before calling Meta.
- A unique campaign/contact constraint prevents duplicate sends for the same
  campaign recipient.
- Webhook events use stable idempotency keys.
- Delivery receipts can precede storage of the provider message ID; unmatched
  receipts are retained and reconciled later.
- Campaign audience IDs are stored so interrupted sends can identify recipients
  never attempted.

### Budgets

Daily budget tables place a hard upper bound on upstream requests/sends. Their
updates are guarded so a reached cap stops additional writes and spend. A
per-IP edge limiter is a useful brake but is not treated as an accounting-grade
global limit.

## Storage

### Supabase Storage

The business-document bucket is private and consumers generate short-lived
signed URLs. The current public vendor flow still performs a browser-direct
anonymous INSERT under a vendor-document prefix. This is a known high-priority
risk because it bypasses Turnstile and server-side file validation.

Historical authenticated policies also allow broad bucket-level actions. The
target policy model is:

- anonymous users have no direct object mutation;
- a server issues or performs one narrowly scoped upload after verification;
- reads are scoped by organization/vendor permission;
- update/delete require an appropriate staff role;
- object paths are server-generated and immutable identifiers are used;
- size, type, retention and orphan-cleanup controls are enforced.

### Cloudflare R2

R2 stores WhatsApp media and avatars. WhatsApp objects are returned only with a
valid short-lived media ticket. Avatar reads are public but can address only a
validated user UUID under the fixed avatar prefix.

Media tickets are bearer capabilities. Do not store them in logs, analytics,
referrers or permanent database fields.

## Migration directories and order

- `supabase/migrations/`: ordered Postgres, RLS and Storage changes.
- `migrations/`: ordered Cloudflare D1 changes.
- `remote_schema.sql` and imported remote-schema migrations: historical
  snapshots used for reference/bootstrap, not proof of current production state.
- `supabase/seed/`: development/seed material, not production migrations.

Never edit an already-deployed migration. Add a forward migration with explicit
rollback guidance. Policy migrations coupled to new code require a staged
rollout so the old client is not cut off before the new server path is live.

## Secure migration checklist

- [ ] Back up affected data and document rollback.
- [ ] Use the correct database/environment and verify the target before apply.
- [ ] Enable RLS before granting browser-facing table access.
- [ ] Test allowed and denied operations as `anon` and `authenticated`.
- [ ] Scope policies by organization, owner and role where data is sensitive.
- [ ] Revoke implicit `PUBLIC` execution from security-definer functions.
- [ ] Use an explicit safe `search_path` and qualified object names.
- [ ] Avoid logging migration output containing row data or credentials.
- [ ] Confirm effective policies after deployment, not only migration success.
- [ ] Run public-form and authenticated smoke tests after policy changes.

## Data retention and privacy

Define retention for webhook ledgers, login events, failed outbox rows, imported
contacts, WhatsApp media and orphan documents. Logs and operational tables
should retain only what is needed for reconciliation, compliance and incident
response. Any deletion process must preserve required financial audit records.

See [Security audit](SECURITY-AUDIT.md) for the open database/storage actions.
