# Runbook: Staff Access

Last reviewed: 2026-10-06

Who may use Dikho, and what each person can do, is managed in the dashboard
under **User Management** ([Permissions](../PERMISSIONS.md),
[ADR 0007](../decisions/0007-user-management-and-permissions.md)). This
runbook covers the steps that happen outside it: the first Owner, and what to
do when the dashboard itself is unavailable.

A Supabase session proves only that someone controls an email or phone. What
makes an account a user of the workspace is an active row in
`public.staff_members`, which only the database's own functions write.

## Prerequisite: sign-up must be off

In the Supabase dashboard, open **Authentication → Sign In / Providers** and
turn off **Allow new users to sign up**. Accounts are created by
administrators, never by self-service. Check it with the public publishable key:

```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $PUBLISHABLE_KEY" | grep -o '"disable_signup":[a-z]*'
```

Expected: `"disable_signup":true`.

## The first Owner

On an existing installation, mark the people who should start with access
in the SQL editor **before** applying `20261006150000_user_management.sql`:
`admin` makes an Owner, `developer` makes a developer super user (level System
Owner: every permission, but cannot act on Owners). The migration refuses to
run if accounts exist and nobody holds `admin`. Use the addresses each person
signs in with; never commit them.

```sql
-- Owners
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('dikho_roles', jsonb_build_array('admin'))
where email in ('first-owner@example.com', 'second-owner@example.com');

-- Developer super user
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('dikho_roles', jsonb_build_array('developer'))
where email = 'developer@example.com';

-- Check: three rows, with the roles above
select email, raw_app_meta_data -> 'dikho_roles' from auth.users
where raw_app_meta_data ? 'dikho_roles';
```

The owner decided the starting set on 2026-10-06 (two Owners, one developer
super user); names stay out of this public repository. Everyone else is added
from the dashboard afterwards.

On a fresh installation (migrations applied, nobody added yet):

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/add-auth-user.mjs +919812345678 owner@example.com --owner "Full Name"
```

It refuses once an active Owner exists. Everyone else is added from the
dashboard.

## Everyday tasks (in the dashboard)

| Task | Where |
| --- | --- |
| Add someone | User Management → Add user. They sign in with the usual one-time code to the email or WhatsApp number you entered |
| Give extra access or remove some | Their profile → Access & permissions |
| See where they are signed in | Their profile → Sessions |
| Sign them out everywhere | Their profile → Sign out everywhere |
| Suspend (emergency) | Their profile → Suspend. Ends every session and blocks sign-in |
| Someone has left | Their profile → Archive. Nothing is deleted |
| Who changed what | User Management → Audit log |

## When the dashboard is unavailable

Run these in the Supabase SQL editor. They act directly, without the
dashboard's checks, so record why in the reason.

Suspend someone and end every session:

```sql
begin;
update public.staff_members
set status = 'suspended', status_reason = 'Emergency: <why>', status_changed_at = now()
where user_id = (select id from auth.users where email = 'person@example.com');
select public.um_end_sessions(
  (select id from auth.users where email = 'person@example.com'), null, 'suspended', null);
commit;
```

Then ban the account in **Authentication → Users** so it cannot sign in again
until reactivated. Reactivate by setting `status = 'active'` and lifting the
ban.

List who has access:

```sql
select m.full_name, u.email, u.phone, m.system_role, m.developer_level, m.status,
       u.last_sign_in_at, m.last_seen_at
from public.staff_members m join auth.users u on u.id = m.user_id
order by m.status, m.full_name;
```

Effect of a suspension or forced sign-out: API requests and database queries
from that person are refused at once, and an open dashboard signs itself out.
A tampered browser could keep receiving inbox events until its token expires
(at most an hour), and media tickets already issued stay valid until they
expire (at most six hours). For a hostile departure also rotate anything they
could have copied ([Credential rotation](credential-rotation.md)).

## Verify after a change

Use synthetic identities, never a customer record.

| Check | Expected |
| --- | --- |
| A Sales Executive loads Clients and their own sales orders | Works; other people's sales orders are not listed |
| The same person opens `/users` | "You don't have access to this page" |
| The same person calls `GET /api/users` with their token | `403` |
| An Admin tries to make someone an Owner | Refused: "Only an Owner can make someone an Owner." Recorded as `access.denied` |
| Suspend a test user while they have Dikho open | Their screen returns to sign-in with a notice; their old token gets `401` |
| An account with no staff record signs in by email | "No access to this workspace" |
| A number without a staff record requests a WhatsApp code | No message sent; the API log shows `auth.whatsapp_otp.not_staff` |
