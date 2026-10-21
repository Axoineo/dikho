# Permissions and Access Model

Last reviewed: 2026-10-21

Status: **implemented in the repository, not yet deployed.** Rollout steps are
in the [User Management task](tasks/2026-10-06-user-management.md); the decision
and its trade-offs are in [ADR 0007](decisions/0007-user-management-and-permissions.md).
Until rollout, production still runs on the earlier model (and, until the
[hardening rollout](tasks/2026-10-05-security-hardening.md), with sign-up open).

Dikho serves one organization per installation
([ADR 0005](decisions/0005-one-organization-per-instance.md)). Within an
installation every person has explicit, per-action permissions.

## Who can do what

Access is decided in this order, the same way by the database, the API and
the dashboard:

1. The access token's **session still exists** (signing out, or an
   administrator ending it, deletes it).
2. The person has an **active staff record** and is not banned.
3. **Owners** hold every business permission. **Developers** (any developer
   level) hold every permission, including developer tools graded by level.
   Neither is narrowed by templates or overrides.
4. Everyone else: the widest scope from their **template** and their **system
   role**, then their **overrides** replace individual permissions.
5. The permission's **scope** decides which records: `all`, or `own` where the
   table records an owner.

A job title (designation) never grants anything.

| System role | Built-in extra permissions | Can manage |
| --- | --- | --- |
| Staff | none | nobody |
| Manager | none (team-level access arrives with team scopes) | nobody, unless given user-management permissions |
| Admin | view/add/edit users, change roles below Admin, templates on people, suspend, sessions, departments, audit log, Live Assist | Staff and Managers |
| Owner | every business permission | everyone, including other Owners |
| Developer (level, any role) | every permission | everyone except Owners and other developers |

Only an Owner makes someone an Owner or grants/removes developer access. There
is always at least one active Owner.

## Permission catalogue

Keys are `resource.action`, stored in `public.permissions` and shown in the
dashboard's permission grid. Scopes are per permission; `own` is enforced only
where listed.

| Module | Permissions | Enforced in |
| --- | --- | --- |
| Clients | `clients.view/create/edit/delete` | RLS `clients` |
| Leads | `leads.view` | RLS `cg_leads`; API `/cg-leads` |
| Vendors | `vendors.view/create/edit/delete/export` | RLS `vendors`, `vendor_addresses`, `vendor_media`; Storage `vendors_documents/` |
| Sales Orders | `sales_orders.view/edit/delete` (scope `own` or `all`), `sales_orders.create` | RLS `salesorder` rows without `vendor_address_id`, and their items |
| Purchase Orders | `purchase_orders.view/create/edit/delete` | RLS `salesorder` rows with `vendor_address_id`, and items with `purchase_order_id` |
| Invoices | `invoices.view/create/issue` | RLS `invoices`, `invoice_lines`, `invoice_sequences`; `issue_invoice()` |
| Payments | `payments.view/record` | RLS `payments`, `payment_allocations` |
| WhatsApp | `inbox.view/reply/delete/block`, `wa_contacts.view/import/delete`, `campaigns.view/send`, `wa_templates.view`, `whatsapp.maintain` | API routes; inbox Realtime channel needs `inbox.view` |
| Email (not yet deployed) | `email_inbox.view`, `email_mailboxes.manage`, `email_campaigns.view/create/approve`, `email_templates.manage`, `email_consent.manage` | `em_*` functions behind `/api/email`; mailboxes also need membership (below) |
| User Management | `users.view/create/edit/roles/permissions/suspend/sessions`, `templates.manage`, `departments.manage`, `audit_logs.view`, `live_assist.use` | `um_*` functions behind `/api/users` |
| Developer | `developer_tools.access`, `feature_flags.view/manage` | developer access only |

`inbox.delete` (Clear chat, Delete chat, delete one message) and `inbox.block`
(Block and Unblock on Meta's block list) come with no built-in template except
Administrator; Owners and developers hold them as they hold everything.
Reacting, forwarding, pinning and sending locations, contacts, buttons, lists
and requests need `inbox.reply`; starring needs only `inbox.view`, because a
star is the person's own. Sending an approved template from a chat needs
`campaigns.send`, because templates are charged and can go out after the
24-hour window.

`document_events` follows invoices or payments. `media`/`sub_media` stay
readable by every staff member (and by the public vendor form).

Built-in templates: Sales Executive, Sales Manager, Finance, Operations,
Procurement, WhatsApp Support, Marketing, Management (read everything) and
Administrator (every business permission). Their exact contents are in the
migration and visible under User Management, Permission templates.

## Email mailboxes: a second gate

Status: in the repository behind `EMAIL_HUB_ENABLED`; the two migrations are
not applied anywhere yet ([ADR 0009](decisions/0009-email-hub.md)).

A permission opens the Email module; it never opens a mailbox. Reading or
acting on a mailbox needs **both** `email_inbox.view` **and** a row in
`email_account_members` for that mailbox. This is the one place where Owners
and developers do not get access by holding every permission: they need
membership like anyone else, so nobody reads a colleague's mail because of
their role.

| Mailbox role | Can |
| --- | --- |
| Viewer | Read conversations |
| Responder | Also reply, send, file (labels, read, archive), take or release conversations, add notes and CRM links |
| Manager | Also assign conversations to others |
| Admin | Also choose members and connect or disconnect the mailbox |

- **Personal mailbox:** connected by its owner, who becomes its admin. Only the
  owner adds or removes members; no administrator, Owner or developer can.
- **Shared mailbox** (sales@, accounts@): created by holders of
  `email_mailboxes.manage`, who choose its members. That permission sets a
  mailbox up; it does not let the holder read it, and adding themselves is
  refused: nobody grants themselves membership. Another manager, or the
  mailbox's admins, must add them.
- Every membership change is in the audit log. A mailbox someone may not use
  answers `404`, so its existence is not revealed.
- The CRM panel beside a conversation shows only record kinds the person may
  view (`clients.view`, `vendors.view`, `leads.view`).

Campaigns: `email_campaigns.create` writes and submits; `email_campaigns.approve`
approves or requests changes, never on a campaign the person wrote or
submitted; an approval covers one exact version (its fingerprint). Audiences
include only record kinds the creator may view, and only addresses with
recorded marketing consent. `email_consent.manage` records consent (with how
it was given), unsubscribes and suppression; `email_campaigns.create` may look
an address up. Built-in templates: Administrator gets all seven; Sales
Executive, Sales Manager and WhatsApp Support get `email_inbox.view`;
Marketing gets campaigns view/create and templates; Management gets campaigns
view.

## Rules that stop privilege escalation

Enforced in the `um_*` database functions, atomically with each change:

- Nobody changes their own role, permissions or status.
- An actor manages only people ranked below them
  (Owner 40 > developer 30 > Admin 20 > Manager 10 > Staff 0); Owners manage
  everyone.
- Roles can be assigned only below the actor's rank; Owner only by an Owner.
- A permission can be granted or removed only at a scope the actor holds.
  Assigning a template counts as granting all of its permissions.
- A template used by someone the actor cannot manage cannot be edited by them.
- Developer-only permissions come only with developer access.
- Refused attempts are recorded in the audit log (`access.denied`).

## Emergencies and sessions

| Action | Effect | Who |
| --- | --- | --- |
| Sign out everywhere | Every session deleted; open dashboards sign out at once; the person can sign in again | `users.sessions` |
| End one session | That device signed out (also allowed on your own devices) | `users.sessions`, or yourself |
| Suspend | Sessions deleted and Auth account banned in one go; history kept | `users.suspend` |
| Archive | As suspend, for people who have left; hidden from the default list | `users.suspend` |

The API and the database refuse the old token immediately. Known limits: an
open Realtime connection is cut by the app at once but a tampered client could
keep listening until its token expires (up to an hour); media tickets already
issued stay valid up to six hours.

Administrators see each person's last sign-in, last activity, the section of
Dikho they are in (a route key, never a record), and each session's device and
approximate city from Cloudflare's IP lookup. Employees are told this on their
Settings page. Sign-in history is kept 180 days.

## Live Assist

A helper with `live_assist.use` can ask to see the Dikho tab of a colleague at
their own level or below, never themselves: Admins can help Admins, Managers
and Staff; developers can help developers and everyone below; Owners can help
anyone ([ADR 0008](decisions/0008-live-assist.md)). The employee accepts each
time and can stop at any time. The helper watches, points, highlights, chats
and pins short numbered notes beside things, and suggests pages; they cannot
click or type. One session per person at a time, in either role. Nothing is
recorded: video, chat and notes go browser to browser and are gone when the
session ends; the audit log keeps who helped whom, when, and for how long. Any
staff member can **Ask for help**, which tells everyone who may help them, or
only the one person they choose.

## Surfaces

| Surface | Check |
| --- | --- |
| Dashboard pages and sidebar | Hidden without the page's permission; a typed URL shows "You don't have access". Navigation only |
| `/api/*` dashboard routes | `requireAuth` (one call to `my_access()`), then `requirePermission` per route |
| `/api/users/*` | Route permission, then the `um_*` rules |
| `/api/me/session` | Any active staff member; records their own session only |
| Browser to Supabase tables | RLS as in the catalogue above |
| Vendor documents (Storage) | Staff policy plus `vendors.view` / `vendors.create`/`edit` |
| WhatsApp inbox live updates | Private channel, `inbox.view` |
| Personal notice channel `staff:<id>` | Only that person may listen; only the Worker publishes |
| Live Assist channel `assist:<session id>` | Only the helper and the employee of a waiting or live session may join or send |
| `/api/assist/*` | Any staff member for their own state, help requests and the list of who may help them; `live_assist.use` to start a session; the `la_*` rules for the rest |
| WhatsApp OTP hook | Sends a code only to active staff (`staff_is_active`) |
| `/api/email/*` | `EMAIL_HUB_ENABLED`, `requireAuth`, then the `em_*` rules (permission and, for mailboxes, membership) |
| Email render and preview pages | Ten-minute ticket for one person and one item, membership or permission re-checked on load; sandboxed, separate origin |
| Google OAuth return, Gmail push, SES events, unsubscribe | One-time hashed state with PKCE; Google-signed OIDC token; SNS signature and topic; per-recipient HMAC link. Never grant dashboard access |
| `/api/public/*`, Meta webhook, `/api/gstn` | Unchanged: Turnstile, signatures, rate limits. Never grant dashboard access |

## Verification required for changes

Any change to roles, permissions, policies or the `um_*` functions needs
allowed, denied, missing-session, ended-session, suspended and wrong-record
checks, run directly against the database and the API as well as through the
UI, under the real database roles. Attempt to grant beyond your own access and
to change your own role; both must fail. See [Testing](TESTING.md).
