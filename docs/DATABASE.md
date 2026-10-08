# Database and Storage Guide

Last updated: 2026-10-05

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
- Being signed in is not enough. Every `public` table carries a RESTRICTIVE
  policy, `staff members only`, that requires `public.is_staff()` for the
  `authenticated` role ([ADR 0006](decisions/0006-staff-membership-in-app-metadata.md),
  `20261006143107_staff_membership.sql`). Since
  `20261006150000_user_management.sql`, `is_staff()` reads an active
  `staff_members` row and also requires the token's session to exist in
  `auth.sessions`, so a signed-out or suspended person is refused at once.
- Business tables also carry per-action RESTRICTIVE policies named
  `permission: read/add/change/remove` that call
  `public.has_permission('<module>.<action>')` or `public.permission_scope(...)`
  ([ADR 0007](decisions/0007-user-management-and-permissions.md),
  [Permissions](PERMISSIONS.md)). They can only narrow access. Create them for a
  new business table with `public.apply_crud_policies(table, view, create, edit, delete)`.
- `salesorder.created_by_id` defaults to `auth.uid()` and cannot be changed
  once set (trigger `salesorder_creator_is_fixed`); the `own` scope relies on it.
- **Every new table needs the same restrictive policy in its own migration.**
  The staff migration covered only the tables that existed when it ran:

  ```sql
  create policy "staff members only" on public.<table> as restrictive for all
    to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
  ```
- `SECURITY DEFINER` functions skip RLS, so any one callable by
  `authenticated` must check `public.is_staff()` and the relevant permission
  itself, as `issue_invoice` does (`invoices.issue`).

### User management tables

`staff_members`, `departments`, `teams`, `permissions`, `permission_templates`,
`template_permissions`, `role_permissions`, `staff_permission_overrides`,
`staff_sessions` and `audit_log` have no table privileges for `anon` or
`authenticated`. The browser reaches them only through `my_access()`,
`touch_session()` and `set_my_theme()`; everything else goes through the API
Worker into the `um_*` functions (service role only), which hold the
escalation rules and write `audit_log` in the same transaction.

- `audit_log` is append-only: triggers refuse UPDATE, DELETE and TRUNCATE for
  every role.
- `staff_members.user_id` references `auth.users` with ON DELETE RESTRICT:
  archive people instead of deleting their sign-in account.
- A deferred constraint trigger keeps at least one active Owner. It is
  SECURITY DEFINER because deferred triggers run at COMMIT as the session's
  role.
- Built-in templates are reset to the migration's contents if it is
  re-applied; custom templates are untouched.
- `live_assist_sessions` and `help_requests` (Live Assist, ADR 0008) follow
  the same pattern: no browser privileges, written by the `la_*` functions
  through the Worker. `public.la_can_use_topic()` backs the Realtime policies
  that limit `assist:<session id>` channels to the two participants.
  `la_can_help()` is the rank rule (the helper's level or below),
  `la_may_help()` adds "active" and `live_assist.use`, and `la_busy()` keeps
  each person in at most one live session. `help_requests.helper_id` is the
  one person asked, or null for everyone allowed. Chat and pinned notes are
  never stored.

Avoid new sensitive policies using unconditional `USING (true)` or
`WITH CHECK (true)`.

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
| `messages` | Campaign and conversational messages/status; `payload` holds the structured form of locations, contact cards, buttons, lists, chosen options, addresses, referrals and templates | Phones, message bodies, media metadata, shared contact details and addresses |
| `conversations` | One WhatsApp thread per phone; also the clear boundary and block state | Phone, profile name, activity summary |
| `conversation_events` | Who cleared, deleted or blocked a chat, or deleted a message | Staff user id |
| `message_stars` | Each agent's own starred messages | Staff user id |
| `webhook_events` | Idempotency/reconciliation ledger | Provider payload fragments |
| `gstn_lookup_budget` | Global daily GST lookup count | Aggregate only |
| `template_send_cooldowns` | Per-number/template send suppression | Phone and template |
| `cg_lead_whatsapp_budget` | Global daily confirmation-send count | Aggregate only |
| `cg_lead_outbox` | Delayed confirmation queue | Phone and lead name |

Clear chat, Delete chat and deleting one message hide rows rather than remove
them (`conversations.cleared_through_id`, `status = 'deleted'`,
`messages.hidden_at`), so the record stays and the D1 write cost is one row;
migration 0011 explains the choice and how to restore.

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

The business-document bucket (`Dikho`) is private and consumers generate
short-lived signed URLs. After `20261006160000_vendor_document_storage.sql`:

| Who | Access |
| --- | --- |
| `anon` | none |
| Public vendor form | `POST /api/public/vendor`; the Worker verifies Turnstile and the file's real type and size, then writes `vendors_documents/public/<uuid>.<ext>` with the service role |
| Staff, read | any object under `vendors_documents/` |
| Staff, upload | only `vendors_documents/<existing vendor id>/<file>` (the dashboard's vendor form) |
| Staff, update | nobody |
| Staff, delete | only objects they uploaded themselves |
| Bucket | 10 MB per object; PDF, JPEG, PNG, WEBP only |

Not yet done: per-role read scoping (waits for the permission matrix) and
retention/orphan cleanup. Orphans can predate the Worker path, when the
browser uploaded first and a failed registration left the file behind. List
candidates (names only) with:

```sql
select o.name, o.created_at
from storage.objects o
where o.bucket_id = 'Dikho'
  and o.name like 'vendors_documents/%'
  and not exists (select 1 from public.vendors v where v.vendor_document_file_path = o.name)
order by o.created_at;
```

Deleting any of them is a production data change and needs the owner's
approval.

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
  The root `remote_schema.sql` still contains the broad Storage and
  `USING (true)` policies; never apply it to an existing database.
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

`staff_sessions` (sign-in IP, approximate city, device) is purged after 180
days, each time the same person signs in again. `audit_log` is kept.

Define retention for webhook ledgers, login events, failed outbox rows, imported
contacts, WhatsApp media and orphan documents. Logs and operational tables
should retain only what is needed for reconciliation, compliance and incident
response. Any deletion process must preserve required financial audit records.

See [Security audit](SECURITY-AUDIT.md) for the open database/storage actions.
