-- ============================================================================
-- USER MANAGEMENT: staff profiles, system roles, permission templates,
-- per-person overrides, sessions, an append-only audit log, and RLS that
-- checks a permission per action instead of "is any staff member".
--
-- Decision record: docs/decisions/0007-user-management-and-permissions.md.
-- It supersedes ADR 0006's app_metadata role list: membership now lives in
-- public.staff_members, which only SECURITY DEFINER functions write.
--
-- HOW ACCESS IS DECIDED (deterministic, in this order):
--   1. The access token's session still exists in auth.sessions (signing out,
--      or an administrator ending the session, deletes it, so a copied token
--      stops working at once instead of at its expiry).
--   2. The person has an ACTIVE staff_members row and is not banned/deleted.
--   3. Owners hold every permission except developer-only ones. Developers
--      (any developer_level) hold every permission; developer-only ones are
--      graded by level. Neither is changed by overrides.
--   4. Everyone else: the widest scope from their template and their system
--      role's built-in permissions, then their overrides replace that per
--      permission (grant sets the scope, revoke removes it).
--   5. Scope says WHICH records: 'all', or 'own' where a table records an
--      owner (sales orders today). 'team'/'department' exist in the model
--      and switch on per module once those tables carry owner columns.
--
-- WHO MAY CHANGE WHOM (enforced in the um_* functions, not only the UI):
--   rank: owner 40 > developer 30 > admin 20 > manager 10 > staff 0.
--   - Nobody changes their own role, permissions or status.
--   - An actor manages only lower-ranked people; Owners manage everyone.
--   - System roles can be granted only below the actor's rank; only an Owner
--     makes an Owner, and only an Owner grants or removes developer access.
--   - A permission can be granted only at a scope the actor holds themselves.
--   - There is always at least one active Owner.
--
-- ROLLOUT: replaces the role list from 20261006143107_staff_membership.sql.
--   Everyone holding dikho_roles is copied across. Holders of 'admin' become
--   Owners. A 'developer' marker (not one of ADR 0006's roles, set only for
--   this hand-over) gives developer level 'system_owner': a super user who
--   cannot act on Owners. Both are set by SQL before applying, per
--   docs/runbooks/staff-access.md; names and addresses never live in this
--   public repository. The guard below refuses to run when accounts exist but
--   nobody would become an Owner.
--
-- ROLLBACK: there is no safe partial rollback. Re-applying
-- 20261006143107_staff_membership.sql restores the app_metadata gate (its
-- is_staff() definition replaces this one); the tables here can stay.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 0. Guard: never leave an existing team without an Owner.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  v_has_owner boolean := false;
begin
  -- Dynamic: on the first run the table does not exist yet.
  if to_regclass('public.staff_members') is not null then
    execute 'select exists (select 1 from public.staff_members where system_role = ''owner'' and status = ''active'')'
      into v_has_owner;
  end if;

  if exists (select 1 from auth.users where deleted_at is null)
     and not exists (
       select 1 from auth.users
       where deleted_at is null
         and jsonb_typeof(raw_app_meta_data -> 'dikho_roles') = 'array'
         and raw_app_meta_data -> 'dikho_roles' ? 'admin'
     )
     and not v_has_owner
  then
    raise exception 'Nobody would become an Owner. Give the owner''s account the admin role first (docs/runbooks/staff-access.md).';
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists departments_name_key on public.departments (lower(name));

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists teams_department_name_key on public.teams (department_id, lower(name));

-- The permission catalogue. Keys follow resource.action. allowed_scopes lists
-- the scopes this permission can actually enforce today; developer_only rows
-- are invisible to and ungrantable by anyone without developer access.
create table if not exists public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null,
  action text not null,
  label text not null,
  description text,
  allowed_scopes text[] not null default array['all'],
  developer_only boolean not null default false,
  min_developer_level text check (min_developer_level in ('developer', 'senior_developer', 'lead_developer', 'system_owner')),
  sort_order integer not null default 0,
  check (allowed_scopes <@ array['own', 'team', 'department', 'all'] and cardinality(allowed_scopes) > 0)
);

create table if not exists public.permission_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique check (key ~ '^[a-z_]+$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 300),
  built_in boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index if not exists permission_templates_name_key on public.permission_templates (lower(name));

create table if not exists public.template_permissions (
  template_id uuid not null references public.permission_templates (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  scope text not null check (scope in ('own', 'team', 'department', 'all')),
  primary key (template_id, permission_key)
);

-- Built-in permissions of a system role, on top of the template. Owners and
-- developers are not listed: they hold everything (see effective_permissions_for).
create table if not exists public.role_permissions (
  system_role text not null check (system_role in ('staff', 'manager', 'admin')),
  permission_key text not null references public.permissions (key) on delete cascade,
  scope text not null default 'all' check (scope in ('own', 'team', 'department', 'all')),
  primary key (system_role, permission_key)
);

-- One row per person who may use the workspace. Identity (email, phone,
-- last sign-in) stays in auth.users; this holds what the company decides.
-- auth.users rows with a staff record cannot be deleted (archive instead):
-- orders, invoices and the audit log keep pointing at former employees.
create table if not exists public.staff_members (
  user_id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  employee_id text check (char_length(btrim(employee_id)) between 1 and 40),
  designation text check (char_length(designation) <= 80),
  department_id uuid references public.departments (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  reporting_manager_id uuid references public.staff_members (user_id) on delete set null,
  joining_date date,
  system_role text not null default 'staff' check (system_role in ('staff', 'manager', 'admin', 'owner')),
  developer_level text check (developer_level in ('developer', 'senior_developer', 'lead_developer', 'system_owner')),
  template_id uuid references public.permission_templates (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  status_reason text check (char_length(status_reason) <= 500),
  status_changed_at timestamptz,
  status_changed_by uuid,
  theme_preference text not null default 'system' check (theme_preference in ('light', 'dark', 'system')),
  welcome_sent_at timestamptz,
  welcome_channel text check (welcome_channel in ('email', 'whatsapp')),
  last_seen_at timestamptz,
  last_seen_section text check (last_seen_section ~ '^[a-z][a-z0-9-]{0,39}$'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (reporting_manager_id is distinct from user_id)
);
create unique index if not exists staff_members_employee_id_key
  on public.staff_members (lower(employee_id)) where employee_id is not null;
create index if not exists staff_members_manager_idx on public.staff_members (reporting_manager_id);

create table if not exists public.staff_permission_overrides (
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  effect text not null check (effect in ('grant', 'revoke')),
  scope text check (scope in ('own', 'team', 'department', 'all')),
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (user_id, permission_key),
  check ((effect = 'grant') = (scope is not null))
);

-- Sign-ins as the company sees them. session_id is auth.sessions.id but not a
-- foreign key: Supabase deletes that row on sign-out, and this history must
-- outlive it. Location is Cloudflare's IP lookup at sign-in: approximate.
-- Rows older than 180 days are purged when the same person signs in again.
create table if not exists public.staff_sessions (
  session_id uuid primary key,
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  signed_in_at timestamptz not null default now(),
  ip inet,
  city text check (char_length(city) <= 80),
  region text check (char_length(region) <= 80),
  country text check (char_length(country) <= 2),
  user_agent text check (char_length(user_agent) <= 300),
  last_seen_at timestamptz,
  last_seen_section text check (last_seen_section ~ '^[a-z][a-z0-9-]{0,39}$'),
  ended_at timestamptz,
  ended_reason text check (ended_reason in ('signed_out', 'forced', 'suspended', 'archived')),
  ended_by uuid
);
create index if not exists staff_sessions_user_idx on public.staff_sessions (user_id, signed_in_at desc);

-- Append-only. Written only by the SECURITY DEFINER functions below; the
-- triggers refuse UPDATE, DELETE and TRUNCATE for every role, including the
-- service role. Values never include tokens, codes or message text.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  target_user_id uuid,
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  old_value jsonb,
  new_value jsonb,
  ip inet,
  user_agent text check (char_length(user_agent) <= 300),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_time_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_user_id, occurred_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);

create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end
$$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change
  before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_is_append_only();

-- Nobody but these functions touches the new tables. RLS is on with no
-- permissive policy for browser roles, plus the uniform restrictive staff
-- policy every public table carries (ADR 0006).
do $$
declare
  t text;
begin
  foreach t in array array[
    'departments', 'teams', 'permissions', 'permission_templates', 'template_permissions',
    'role_permissions', 'staff_members', 'staff_permission_overrides', 'staff_sessions', 'audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists "staff members only" on public.%I', t);
    execute format(
      'create policy "staff members only" on public.%I as restrictive for all to authenticated '
      'using ((select public.is_staff())) with check ((select public.is_staff()))',
      t
    );
  end loop;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Scope checks that a CHECK constraint cannot express.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.permission_scope_is_allowed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scope is not null and not exists (
    select 1 from public.permissions p
    where p.key = new.permission_key and new.scope = any (p.allowed_scopes)
  ) then
    raise exception 'Scope % is not available for %', new.scope, new.permission_key using errcode = 'PT400';
  end if;
  return new;
end
$$;

drop trigger if exists template_permissions_scope on public.template_permissions;
create trigger template_permissions_scope
  before insert or update on public.template_permissions
  for each row execute function public.permission_scope_is_allowed();
drop trigger if exists staff_permission_overrides_scope on public.staff_permission_overrides;
create trigger staff_permission_overrides_scope
  before insert or update on public.staff_permission_overrides
  for each row execute function public.permission_scope_is_allowed();

-- There is always at least one active Owner. Deferred so a single
-- transaction can hand ownership over. SECURITY DEFINER because a deferred
-- trigger runs at COMMIT as the session's role, outside whatever definer
-- function made the change (a heartbeat from a browser session would
-- otherwise fail on reading this table). Fires only when a role or status
-- changes, not on every heartbeat.
create or replace function public.staff_members_keep_an_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.staff_members)
     and not exists (select 1 from public.staff_members where system_role = 'owner' and status = 'active')
  then
    raise exception 'There must always be at least one active Owner.' using errcode = 'PT409';
  end if;
  return null;
end
$$;

drop trigger if exists staff_members_keep_an_owner on public.staff_members;
create constraint trigger staff_members_keep_an_owner
  after update of system_role, status or delete on public.staff_members
  deferrable initially deferred
  for each row execute function public.staff_members_keep_an_owner();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Seed data: catalogue, templates, departments. Upserts, so re-running
--    keeps labels current without touching anyone's assignments.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.permissions (key, module, action, label, description, allowed_scopes, developer_only, min_developer_level, sort_order) values
  ('clients.view',            'Clients',          'view',    'View clients',              null, array['all'], false, null, 100),
  ('clients.create',          'Clients',          'create',  'Add clients',               null, array['all'], false, null, 101),
  ('clients.edit',            'Clients',          'edit',    'Edit clients',              null, array['all'], false, null, 102),
  ('clients.delete',          'Clients',          'delete',  'Delete clients',            null, array['all'], false, null, 103),
  ('leads.view',              'Leads',            'view',    'View corporate-gifting leads', null, array['all'], false, null, 110),
  ('vendors.view',            'Vendors',          'view',    'View vendors and their documents', null, array['all'], false, null, 120),
  ('vendors.create',          'Vendors',          'create',  'Add vendors',               null, array['all'], false, null, 121),
  ('vendors.edit',            'Vendors',          'edit',    'Edit vendors and documents', null, array['all'], false, null, 122),
  ('vendors.delete',          'Vendors',          'delete',  'Delete vendors',            null, array['all'], false, null, 123),
  ('vendors.export',          'Vendors',          'export',  'Export vendor lists',       null, array['all'], false, null, 124),
  ('sales_orders.view',       'Sales Orders',     'view',    'View sales orders',         'Own: only orders this person created.', array['own', 'all'], false, null, 130),
  ('sales_orders.create',     'Sales Orders',     'create',  'Create sales orders',       null, array['all'], false, null, 131),
  ('sales_orders.edit',       'Sales Orders',     'edit',    'Edit sales orders',         'Own: only orders this person created.', array['own', 'all'], false, null, 132),
  ('sales_orders.delete',     'Sales Orders',     'delete',  'Delete sales orders',       'Own: only orders this person created.', array['own', 'all'], false, null, 133),
  ('purchase_orders.view',    'Purchase Orders',  'view',    'View purchase orders',      null, array['all'], false, null, 140),
  ('purchase_orders.create',  'Purchase Orders',  'create',  'Create purchase orders',    null, array['all'], false, null, 141),
  ('purchase_orders.edit',    'Purchase Orders',  'edit',    'Edit purchase orders',      null, array['all'], false, null, 142),
  ('purchase_orders.delete',  'Purchase Orders',  'delete',  'Delete purchase orders',    null, array['all'], false, null, 143),
  ('invoices.view',           'Invoices',         'view',    'View tax invoices',         null, array['all'], false, null, 150),
  ('invoices.create',         'Invoices',         'create',  'Prepare draft invoices',    null, array['all'], false, null, 151),
  ('invoices.issue',          'Invoices',         'approve', 'Issue invoices',            'Issuing assigns the invoice number and locks the invoice.', array['all'], false, null, 152),
  ('payments.view',           'Payments',         'view',    'View payments',             null, array['all'], false, null, 160),
  ('payments.record',         'Payments',         'create',  'Record and allocate payments', null, array['all'], false, null, 161),
  ('inbox.view',              'WhatsApp Inbox',   'view',    'Read conversations',        null, array['all'], false, null, 170),
  ('inbox.reply',             'WhatsApp Inbox',   'send',    'Reply to customers',        null, array['all'], false, null, 171),
  ('wa_contacts.view',        'WhatsApp Contacts','view',    'View contacts',             null, array['all'], false, null, 180),
  ('wa_contacts.import',      'WhatsApp Contacts','create',  'Import contacts',           null, array['all'], false, null, 181),
  ('wa_contacts.delete',      'WhatsApp Contacts','delete',  'Delete contacts',           null, array['all'], false, null, 182),
  ('campaigns.view',          'WhatsApp Campaigns','view',   'View campaigns and delivery stats', null, array['all'], false, null, 190),
  ('campaigns.send',          'WhatsApp Campaigns','send',   'Send and retry campaigns',  'Spends WhatsApp message credit.', array['all'], false, null, 191),
  ('wa_templates.view',       'WhatsApp Templates','view',   'View message templates',    null, array['all'], false, null, 200),
  ('whatsapp.maintain',       'WhatsApp Templates','approve','Run delivery reconciliation', null, array['all'], false, null, 201),
  ('users.view',              'User Management',  'view',    'View users',                null, array['all'], false, null, 300),
  ('users.create',            'User Management',  'create',  'Add users',                 null, array['all'], false, null, 301),
  ('users.edit',              'User Management',  'edit',    'Edit user profiles',        null, array['all'], false, null, 302),
  ('users.roles',             'User Management',  'approve', 'Change system roles',       'Only roles below your own.', array['all'], false, null, 303),
  ('users.permissions',       'User Management',  'approve', 'Change templates and permissions', 'Only permissions you hold yourself.', array['all'], false, null, 304),
  ('users.suspend',           'User Management',  'delete',  'Suspend, reactivate and archive users', null, array['all'], false, null, 305),
  ('users.sessions',          'User Management',  'view',    'See sessions and force sign-out', null, array['all'], false, null, 306),
  ('templates.manage',        'User Management',  'edit',    'Edit permission templates', null, array['all'], false, null, 307),
  ('departments.manage',      'User Management',  'edit',    'Manage departments and teams', null, array['all'], false, null, 308),
  ('audit_logs.view',         'User Management',  'view',    'View the audit log',        null, array['all'], false, null, 309),
  ('live_assist.use',         'User Management',  'send',    'Use Live Assist',           'View and control a lower-ranked colleague''s Dikho screen.', array['all'], false, null, 310),
  ('developer_tools.access',  'Developer',        'view',    'Open developer tools',      null, array['all'], true, 'developer', 900),
  ('feature_flags.view',      'Developer',        'view',    'View feature flags',        null, array['all'], true, 'developer', 901),
  ('feature_flags.manage',    'Developer',        'edit',    'Change feature flags',      null, array['all'], true, 'lead_developer', 902)
on conflict (key) do update set
  module = excluded.module, action = excluded.action, label = excluded.label,
  description = excluded.description, allowed_scopes = excluded.allowed_scopes,
  developer_only = excluded.developer_only, min_developer_level = excluded.min_developer_level,
  sort_order = excluded.sort_order;

insert into public.role_permissions (system_role, permission_key, scope) values
  ('admin', 'users.view', 'all'),
  ('admin', 'users.create', 'all'),
  ('admin', 'users.edit', 'all'),
  ('admin', 'users.roles', 'all'),
  ('admin', 'users.permissions', 'all'),
  ('admin', 'users.suspend', 'all'),
  ('admin', 'users.sessions', 'all'),
  ('admin', 'departments.manage', 'all'),
  ('admin', 'audit_logs.view', 'all'),
  ('admin', 'live_assist.use', 'all')
on conflict do nothing;

insert into public.permission_templates (key, name, description, built_in) values
  ('sales_executive', 'Sales Executive',   'Clients and their own sales orders; reads vendors; answers WhatsApp.', true),
  ('sales_manager',   'Sales Manager',     'All clients and sales orders, reads purchase orders, WhatsApp inbox and campaigns.', true),
  ('finance',         'Finance',           'Invoices and payments; reads orders, clients and vendors.', true),
  ('operations',      'Operations',        'Vendors and purchase orders; reads sales orders and clients.', true),
  ('procurement',     'Procurement',       'Full vendor and purchase-order management; reads sales orders.', true),
  ('whatsapp_support','WhatsApp Support',  'WhatsApp inbox and contacts; reads campaigns, templates and leads.', true),
  ('marketing',       'Marketing',         'WhatsApp campaigns and contacts; reads leads and the inbox.', true),
  ('management',      'Management',        'Reads every business module and exports vendor lists. No changes.', true),
  ('administrator',   'Administrator',     'Every business permission. User management comes from the Admin role.', true)
on conflict (key) do update set name = excluded.name, description = excluded.description, built_in = true;

-- Built-in template contents are reset to these defaults on every run of this
-- migration; custom templates are never touched.
delete from public.template_permissions tp
using public.permission_templates t
where tp.template_id = t.id and t.built_in;

insert into public.template_permissions (template_id, permission_key, scope)
select t.id, v.permission_key, v.scope
from (values
  ('sales_executive', 'clients.view', 'all'), ('sales_executive', 'clients.create', 'all'), ('sales_executive', 'clients.edit', 'all'),
  ('sales_executive', 'leads.view', 'all'), ('sales_executive', 'vendors.view', 'all'),
  ('sales_executive', 'sales_orders.view', 'own'), ('sales_executive', 'sales_orders.create', 'all'), ('sales_executive', 'sales_orders.edit', 'own'),
  ('sales_executive', 'inbox.view', 'all'), ('sales_executive', 'inbox.reply', 'all'), ('sales_executive', 'wa_contacts.view', 'all'),

  ('sales_manager', 'clients.view', 'all'), ('sales_manager', 'clients.create', 'all'), ('sales_manager', 'clients.edit', 'all'), ('sales_manager', 'clients.delete', 'all'),
  ('sales_manager', 'leads.view', 'all'), ('sales_manager', 'vendors.view', 'all'),
  ('sales_manager', 'sales_orders.view', 'all'), ('sales_manager', 'sales_orders.create', 'all'), ('sales_manager', 'sales_orders.edit', 'all'), ('sales_manager', 'sales_orders.delete', 'all'),
  ('sales_manager', 'purchase_orders.view', 'all'),
  ('sales_manager', 'inbox.view', 'all'), ('sales_manager', 'inbox.reply', 'all'), ('sales_manager', 'wa_contacts.view', 'all'),
  ('sales_manager', 'campaigns.view', 'all'), ('sales_manager', 'wa_templates.view', 'all'),

  ('finance', 'clients.view', 'all'), ('finance', 'vendors.view', 'all'), ('finance', 'vendors.export', 'all'),
  ('finance', 'sales_orders.view', 'all'), ('finance', 'purchase_orders.view', 'all'),
  ('finance', 'invoices.view', 'all'), ('finance', 'invoices.create', 'all'), ('finance', 'invoices.issue', 'all'),
  ('finance', 'payments.view', 'all'), ('finance', 'payments.record', 'all'),

  ('operations', 'clients.view', 'all'), ('operations', 'vendors.view', 'all'), ('operations', 'vendors.create', 'all'), ('operations', 'vendors.edit', 'all'), ('operations', 'vendors.export', 'all'),
  ('operations', 'sales_orders.view', 'all'),
  ('operations', 'purchase_orders.view', 'all'), ('operations', 'purchase_orders.create', 'all'), ('operations', 'purchase_orders.edit', 'all'),

  ('procurement', 'vendors.view', 'all'), ('procurement', 'vendors.create', 'all'), ('procurement', 'vendors.edit', 'all'), ('procurement', 'vendors.delete', 'all'), ('procurement', 'vendors.export', 'all'),
  ('procurement', 'sales_orders.view', 'all'),
  ('procurement', 'purchase_orders.view', 'all'), ('procurement', 'purchase_orders.create', 'all'), ('procurement', 'purchase_orders.edit', 'all'), ('procurement', 'purchase_orders.delete', 'all'),

  ('whatsapp_support', 'inbox.view', 'all'), ('whatsapp_support', 'inbox.reply', 'all'),
  ('whatsapp_support', 'wa_contacts.view', 'all'), ('whatsapp_support', 'wa_contacts.import', 'all'),
  ('whatsapp_support', 'campaigns.view', 'all'), ('whatsapp_support', 'wa_templates.view', 'all'), ('whatsapp_support', 'leads.view', 'all'),

  ('marketing', 'campaigns.view', 'all'), ('marketing', 'campaigns.send', 'all'), ('marketing', 'wa_templates.view', 'all'),
  ('marketing', 'wa_contacts.view', 'all'), ('marketing', 'wa_contacts.import', 'all'), ('marketing', 'wa_contacts.delete', 'all'),
  ('marketing', 'leads.view', 'all'), ('marketing', 'inbox.view', 'all')
) as v (template_key, permission_key, scope)
join public.permission_templates t on t.key = v.template_key;

-- Management reads everything; Administrator holds every business permission.
insert into public.template_permissions (template_id, permission_key, scope)
select t.id, p.key, 'all'
from public.permission_templates t
join public.permissions p on not p.developer_only and p.module <> 'User Management'
where (t.key = 'management' and (p.action = 'view' or p.key = 'vendors.export'))
   or t.key = 'administrator'
on conflict do nothing;

insert into public.departments (name)
select d from unnest(array['Sales', 'Finance', 'Operations', 'Procurement', 'Management', 'Technology', 'Marketing']) as d
where not exists (select 1 from public.departments x where lower(x.name) = lower(d));

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Copy ADR 0006's role holders across. Runs only for people without a
--    staff record, so re-running never overwrites later decisions.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.staff_members (user_id, full_name, system_role, developer_level, template_id, created_at)
select
  u.id,
  left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), u.phone, 'Staff member'), 120),
  case when roles ? 'admin' then 'owner' else 'staff' end,
  case when roles ? 'developer' then 'system_owner' end,
  (select t.id from public.permission_templates t where t.key = case
     when roles ? 'admin' or roles ? 'developer' then 'administrator'
     when roles ? 'finance' then 'finance'
     when roles ? 'sales' then 'sales_manager'
     when roles ? 'operations' then 'operations'
     else 'whatsapp_support' end),
  coalesce(u.created_at, now())
from auth.users u
cross join lateral (select u.raw_app_meta_data -> 'dikho_roles' as roles) r
where u.deleted_at is null
  and jsonb_typeof(roles) = 'array'
  and roles ?| array['admin', 'finance', 'sales', 'operations', 'support', 'developer']
  and not exists (select 1 from public.staff_members m where m.user_id = u.id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Core checks. Every policy and RPC goes through these.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.current_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when (auth.jwt() ->> 'session_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then (auth.jwt() ->> 'session_id')::uuid
  end
$$;

create or replace function public.session_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = public.current_session_id()
      and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
  )
$$;

-- Active staff, not banned or deleted. No session check: used for people
-- other than the caller (the OTP hook, the Worker acting for an admin).
create or replace function public.staff_is_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_members m
    join auth.users u on u.id = m.user_id
    where m.user_id = p_user
      and m.status = 'active'
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
  )
$$;

-- Replaces the app_metadata check from 20261006143107_staff_membership. Every restrictive
-- "staff members only" policy, the vendor-document Storage policies and the
-- inbox Realtime policy call this, so all of them now also require a live
-- session and an active staff record.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_is_active(auth.uid()) and public.session_is_live()
$$;

comment on function public.is_staff() is
  'True when the caller has an active staff_members row, is not banned, and the token''s session still exists.';

create or replace function public.scope_rank(p_scope text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_position(array['own', 'team', 'department', 'all'], p_scope), 0)
$$;

create or replace function public.developer_rank(p_level text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_position(array['developer', 'senior_developer', 'lead_developer', 'system_owner'], p_level), 0)
$$;

create or replace function public.staff_rank(p_role text, p_developer_level text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_role = 'owner' then 40
    when p_developer_level is not null then 30
    when p_role = 'admin' then 20
    when p_role = 'manager' then 10
    else 0
  end
$$;

-- The one place effective permissions are computed. Internal: browser roles
-- reach it only through permission_scope()/my_access(), which pass auth.uid().
create or replace function public.effective_permissions_for(p_user uuid)
returns table (permission_key text, scope text, source text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.user_id, m.system_role, m.developer_level, m.template_id
    from public.staff_members m
    where m.user_id = p_user and public.staff_is_active(p_user)
  ),
  superuser as (
    select p.key, 'all'::text as scope,
           case when me.developer_level is not null then 'developer' else 'owner' end as source
    from me
    join public.permissions p on
      (me.developer_level is not null
        and (not p.developer_only
             or public.developer_rank(me.developer_level) >= public.developer_rank(p.min_developer_level)))
      or (me.developer_level is null and me.system_role = 'owner' and not p.developer_only)
    where me.system_role = 'owner' or me.developer_level is not null
  ),
  inherited as (
    select tp.permission_key as key, tp.scope, 'template'::text as source
    from me join public.template_permissions tp on tp.template_id = me.template_id
    union all
    select rp.permission_key, rp.scope, 'role'
    from me join public.role_permissions rp on rp.system_role = me.system_role
  ),
  widest as (
    select distinct on (key) key, scope, source
    from inherited
    order by key, public.scope_rank(scope) desc, source desc
  ),
  merged as (
    select w.key, w.scope, w.source
    from widest w
    where not exists (
      select 1 from public.staff_permission_overrides o
      where o.user_id = p_user and o.permission_key = w.key
    )
    union all
    select o.permission_key, o.scope, 'override'
    from public.staff_permission_overrides o
    join me on me.user_id = o.user_id
    where o.effect = 'grant'
  )
  select key, scope, source from superuser
  union all
  select m.key, m.scope, m.source
  from merged m
  join public.permissions p on p.key = m.key and not p.developer_only
  where not exists (select 1 from superuser)
$$;

create or replace function public.permission_scope(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.session_is_live() then 'none'
    else coalesce((
      select e.scope from public.effective_permissions_for(auth.uid()) e where e.permission_key = p_key
    ), 'none')
  end
$$;

create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.permission_scope(p_key) <> 'none'
$$;

-- What the dashboard and the API Worker load once per page / request. One
-- call: proves the token (PostgREST validates it), the live session, the
-- staff record, and returns the permission map.
create or replace function public.my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'signed_out');
  end if;
  if not public.session_is_live() then
    return jsonb_build_object('status', 'session_ended');
  end if;

  select jsonb_build_object(
    'status', case
      when u.banned_until is not null and u.banned_until > now() and m.status = 'active' then 'suspended'
      else m.status end,
    'user_id', m.user_id,
    'session_id', public.current_session_id(),
    'email', u.email,
    'phone', u.phone,
    'full_name', m.full_name,
    'system_role', m.system_role,
    'developer_level', m.developer_level,
    'theme', m.theme_preference,
    'permissions', coalesce((
      select jsonb_object_agg(e.permission_key, e.scope)
      from public.effective_permissions_for(v_uid) e
    ), '{}'::jsonb)
  )
  into v_result
  from public.staff_members m
  join auth.users u on u.id = m.user_id
  where m.user_id = v_uid and u.deleted_at is null;

  return coalesce(v_result, jsonb_build_object('status', 'not_staff'));
end
$$;

-- Heartbeat: once a minute while someone is using the dashboard, and on
-- page change. Records "last active" and the section (a route key, never
-- page content). Returns why access stopped so the browser can sign out.
create or replace function public.touch_session(p_section text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.current_session_id();
  v_section text := case when p_section ~ '^[a-z][a-z0-9-]{0,39}$' then p_section end;
begin
  if v_uid is null then return 'signed_out'; end if;
  if not public.session_is_live() then return 'session_ended'; end if;
  if not public.staff_is_active(v_uid) then return 'no_access'; end if;

  insert into public.staff_sessions as s (session_id, user_id, signed_in_at, last_seen_at, last_seen_section)
  values (v_sid, v_uid, now(), now(), v_section)
  on conflict (session_id) do update
    set last_seen_at = now(), last_seen_section = coalesce(excluded.last_seen_section, s.last_seen_section)
    where s.user_id = v_uid;

  update public.staff_members
  set last_seen_at = now(), last_seen_section = coalesce(v_section, last_seen_section)
  where user_id = v_uid;

  return 'ok';
end
$$;

create or replace function public.set_my_theme(p_theme text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_theme not in ('light', 'dark', 'system') then
    raise exception 'Unknown theme' using errcode = 'PT400';
  end if;
  if not public.is_staff() then
    raise exception 'Not signed in' using errcode = 'PT401';
  end if;
  update public.staff_members set theme_preference = p_theme where user_id = auth.uid();
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Permission-aware RLS on business tables. Restrictive policies AND with
--    the existing permissive ones and with "staff members only", so they can
--    only narrow access. `(select ...)` evaluates each check once per query.
--
--    Sales and purchase orders share public.salesorder: a row with
--    vendor_address_id is a purchase order (the convention the dashboard
--    uses). Their items share public.salesorderdocument: purchase_order_id
--    marks a purchase-order item.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.apply_crud_policies(
  p_table text, p_view text, p_create text, p_edit text, p_delete text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('drop policy if exists "permission: read" on public.%I', p_table);
  execute format('drop policy if exists "permission: add" on public.%I', p_table);
  execute format('drop policy if exists "permission: change" on public.%I', p_table);
  execute format('drop policy if exists "permission: remove" on public.%I', p_table);
  execute format('create policy "permission: read" on public.%I as restrictive for select to authenticated using (%s)', p_table, p_view);
  execute format('create policy "permission: add" on public.%I as restrictive for insert to authenticated with check (%s)', p_table, p_create);
  execute format('create policy "permission: change" on public.%I as restrictive for update to authenticated using (%s) with check (%s)', p_table, p_edit, p_edit);
  execute format('create policy "permission: remove" on public.%I as restrictive for delete to authenticated using (%s)', p_table, p_delete);
end
$$;
revoke all on function public.apply_crud_policies(text, text, text, text, text) from public, anon, authenticated;

select public.apply_crud_policies('clients',
  '(select public.has_permission(''clients.view''))',
  '(select public.has_permission(''clients.create''))',
  '(select public.has_permission(''clients.edit''))',
  '(select public.has_permission(''clients.delete''))');

select public.apply_crud_policies('vendors',
  '(select public.has_permission(''vendors.view''))',
  '(select public.has_permission(''vendors.create''))',
  '(select public.has_permission(''vendors.edit''))',
  '(select public.has_permission(''vendors.delete''))');

-- Addresses and media are part of the vendor record: adding a vendor adds
-- its addresses, and editing a vendor may replace them.
select public.apply_crud_policies(t,
  '(select public.has_permission(''vendors.view''))',
  '((select public.has_permission(''vendors.create'')) or (select public.has_permission(''vendors.edit'')))',
  '(select public.has_permission(''vendors.edit''))',
  '((select public.has_permission(''vendors.edit'')) or (select public.has_permission(''vendors.delete'')))')
from unnest(array['vendor_addresses', 'vendor_media']) as t;

select public.apply_crud_policies('cg_leads',
  '(select public.has_permission(''leads.view''))', 'false', 'false', 'false');

select public.apply_crud_policies(t,
  '(select public.has_permission(''invoices.view''))',
  '(select public.has_permission(''invoices.create''))',
  '(select public.has_permission(''invoices.create''))',
  '(select public.has_permission(''invoices.create''))')
from unnest(array['invoices', 'invoice_lines']) as t;

select public.apply_crud_policies('invoice_sequences',
  '(select public.has_permission(''invoices.view''))', 'false', 'false', 'false');

select public.apply_crud_policies(t,
  '(select public.has_permission(''payments.view''))',
  '(select public.has_permission(''payments.record''))',
  '(select public.has_permission(''payments.record''))',
  '(select public.has_permission(''payments.record''))')
from unnest(array['payments', 'payment_allocations']) as t;

select public.apply_crud_policies('document_events',
  '((select public.has_permission(''invoices.view'')) or (select public.has_permission(''payments.view'')))',
  '((select public.has_permission(''invoices.create'')) or (select public.has_permission(''payments.record'')))',
  'false', 'false');

-- Sales orders: 'own' means created_by_id is the caller. Purchase orders: all
-- or nothing. The WITH CHECK side also stops a row being flipped between the
-- two kinds by someone who holds only one of the permissions.
select public.apply_crud_policies('salesorder',
  $p$(case when vendor_address_id is null then
        (select public.permission_scope('sales_orders.view')) = 'all'
        or ((select public.permission_scope('sales_orders.view')) = 'own' and created_by_id = (select auth.uid()))
      else (select public.has_permission('purchase_orders.view')) end)$p$,
  $p$(case when vendor_address_id is null then
        (select public.has_permission('sales_orders.create')) and created_by_id = (select auth.uid())
      else (select public.has_permission('purchase_orders.create')) end)$p$,
  $p$(case when vendor_address_id is null then
        (select public.permission_scope('sales_orders.edit')) = 'all'
        or ((select public.permission_scope('sales_orders.edit')) = 'own' and created_by_id = (select auth.uid()))
      else (select public.has_permission('purchase_orders.edit')) end)$p$,
  $p$(case when vendor_address_id is null then
        (select public.permission_scope('sales_orders.delete')) = 'all'
        or ((select public.permission_scope('sales_orders.delete')) = 'own' and created_by_id = (select auth.uid()))
      else (select public.has_permission('purchase_orders.delete')) end)$p$);

-- Items: a sales-order item follows its order's scope; adding items is part
-- of creating or editing an order. Purchase-order items follow PO rights.
select public.apply_crud_policies('salesorderdocument',
  $p$(case when purchase_order_id is null then
        (select public.permission_scope('sales_orders.view')) = 'all'
        or ((select public.permission_scope('sales_orders.view')) = 'own' and exists (
          select 1 from public.salesorder so
          where so.id = salesorderdocument.sales_order_id and so.created_by_id = (select auth.uid())))
      else (select public.has_permission('purchase_orders.view')) end)$p$,
  $p$(case when purchase_order_id is null then
        (select public.permission_scope('sales_orders.edit')) = 'all'
        or (((select public.permission_scope('sales_orders.edit')) = 'own' or (select public.has_permission('sales_orders.create')))
            and exists (
              select 1 from public.salesorder so
              where so.id = salesorderdocument.sales_order_id and so.created_by_id = (select auth.uid())))
      else (select public.has_permission('purchase_orders.create')) or (select public.has_permission('purchase_orders.edit')) end)$p$,
  $p$(case when purchase_order_id is null then
        (select public.permission_scope('sales_orders.edit')) = 'all'
        or ((select public.permission_scope('sales_orders.edit')) = 'own' and exists (
          select 1 from public.salesorder so
          where so.id = salesorderdocument.sales_order_id and so.created_by_id = (select auth.uid())))
      else (select public.has_permission('purchase_orders.edit')) end)$p$,
  $p$(case when purchase_order_id is null then
        (select public.permission_scope('sales_orders.edit')) = 'all'
        or (select public.permission_scope('sales_orders.delete')) = 'all'
        or ((select public.permission_scope('sales_orders.edit')) = 'own' and exists (
          select 1 from public.salesorder so
          where so.id = salesorderdocument.sales_order_id and so.created_by_id = (select auth.uid())))
      else (select public.has_permission('purchase_orders.edit')) or (select public.has_permission('purchase_orders.delete')) end)$p$);

-- The creator is filled in by the database and cannot be changed afterwards,
-- so "own" cannot be gamed by editing created_by_id.
alter table public.salesorder alter column created_by_id set default auth.uid();

create or replace function public.salesorder_creator_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.created_by_id is not null and new.created_by_id is distinct from old.created_by_id then
    raise exception 'The creator of an order cannot be changed.' using errcode = 'PT400';
  end if;
  return new;
end
$$;

drop trigger if exists salesorder_creator_is_fixed on public.salesorder;
create trigger salesorder_creator_is_fixed
  before update on public.salesorder
  for each row execute function public.salesorder_creator_is_fixed();

-- issue_invoice: unchanged from 20261006143107_staff_membership except the permission check.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice_id uuid)
 RETURNS public.invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  invoice_row public.invoices;
  profile_row public.organization_profiles;
  line_count integer;
  calculated_subtotal numeric(14,2);
  calculated_tax_total numeric(14,2);
  calculated_grand_total numeric(14,2);
  next_number integer;
  period_start date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to issue an invoice.';
  END IF;
  -- SECURITY DEFINER bypasses RLS, so the permission the tables enforce has
  -- to be checked here as well.
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only staff can issue invoices.';
  END IF;
  IF NOT public.has_permission('invoices.issue') THEN
    RAISE EXCEPTION 'You do not have permission to issue invoices.';
  END IF;

  SELECT * INTO invoice_row FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;
  IF invoice_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be issued.';
  END IF;

  SELECT * INTO profile_row FROM public.organization_profiles WHERE id = invoice_row.organization_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invoice organization profile no longer exists.';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(taxable_amount), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(total_amount), 0)
  INTO line_count, calculated_subtotal, calculated_tax_total, calculated_grand_total
  FROM public.invoice_lines
  WHERE invoice_id = invoice_row.id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'Add at least one invoice line before issuing.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_lines
    WHERE invoice_id = invoice_row.id
      AND (btrim(description) = '' OR hsn_sac IS NULL OR btrim(hsn_sac) = '')
  ) THEN
    RAISE EXCEPTION 'Every invoice line needs a description and HSN/SAC code before issuing.';
  END IF;
  IF calculated_grand_total <> calculated_subtotal + calculated_tax_total THEN
    RAISE EXCEPTION 'Invoice totals do not reconcile.';
  END IF;

  period_start := date_trunc('month', invoice_row.invoice_date)::date;
  INSERT INTO public.invoice_sequences (organization_profile_id, invoice_month, last_number)
  VALUES (invoice_row.organization_profile_id, period_start, 1)
  ON CONFLICT (organization_profile_id, invoice_month)
  DO UPDATE SET last_number = public.invoice_sequences.last_number + 1
  RETURNING last_number INTO next_number;

  UPDATE public.invoices
  SET status = 'issued',
      invoice_number = profile_row.invoice_prefix || '/' || upper(to_char(invoice_row.invoice_date, 'MON')) || next_number || '/' || to_char(invoice_row.invoice_date, 'YY'),
      subtotal = calculated_subtotal,
      tax_total = calculated_tax_total,
      grand_total = calculated_grand_total,
      due_date = COALESCE(invoice_row.due_date, invoice_row.invoice_date + profile_row.invoice_terms_days),
      seller_snapshot = jsonb_build_object(
        'legal_name', profile_row.legal_name,
        'gstin', profile_row.gstin,
        'pan', profile_row.pan,
        'address_line1', profile_row.address_line1,
        'address_line2', profile_row.address_line2,
        'city', profile_row.city,
        'state', profile_row.state,
        'state_code', profile_row.state_code,
        'country', profile_row.country,
        'pincode', profile_row.pincode,
        'bank_name', profile_row.bank_name,
        'bank_account_name', profile_row.bank_account_name,
        'bank_account_number', profile_row.bank_account_number,
        'bank_ifsc', profile_row.bank_ifsc,
        'bank_branch', profile_row.bank_branch
      ),
      issued_at = now(),
      issued_by = auth.uid()
  WHERE id = invoice_row.id
  RETURNING * INTO invoice_row;

  INSERT INTO public.document_events (entity_type, entity_id, event_type, payload)
  VALUES ('invoice', invoice_row.id, 'issued', jsonb_build_object('invoice_number', invoice_row.invoice_number, 'grand_total', invoice_row.grand_total));

  RETURN invoice_row;
END;
$function$;

revoke all on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated, service_role;

-- Vendor documents in Storage follow vendor permissions. Restrictive and
-- limited to that folder, so other buckets and paths are unaffected.
drop policy if exists "permission: vendor documents read" on storage.objects;
create policy "permission: vendor documents read" on storage.objects
  as restrictive for select to authenticated
  using (not (bucket_id = 'Dikho' and (storage.foldername(name))[1] = 'vendors_documents')
         or (select public.has_permission('vendors.view')));

drop policy if exists "permission: vendor documents upload" on storage.objects;
create policy "permission: vendor documents upload" on storage.objects
  as restrictive for insert to authenticated
  with check (not (bucket_id = 'Dikho' and (storage.foldername(name))[1] = 'vendors_documents')
              or (select public.has_permission('vendors.create'))
              or (select public.has_permission('vendors.edit')));

drop policy if exists "permission: vendor documents delete" on storage.objects;
create policy "permission: vendor documents delete" on storage.objects
  as restrictive for delete to authenticated
  using (not (bucket_id = 'Dikho' and (storage.foldername(name))[1] = 'vendors_documents')
         or (select public.has_permission('vendors.edit')));

-- The WhatsApp inbox channel (20261006143107_staff_membership) now also needs inbox.view.
drop policy if exists "staff receive inbox broadcasts" on realtime.messages;
create policy "staff receive inbox broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    (select public.is_staff())
    and (select realtime.topic()) = 'wa-inbox'
    and realtime.messages.extension in ('broadcast')
    and (select public.has_permission('inbox.view'))
  );

-- Each person's own private channel, used by the Worker to tell an open
-- dashboard that an administrator ended its session. Only that person may
-- listen; only the service role publishes.
drop policy if exists "staff receive their own notices" on realtime.messages;
create policy "staff receive their own notices"
  on realtime.messages
  for select
  to authenticated
  using (
    (select public.is_staff())
    and (select realtime.topic()) = 'staff:' || (select auth.uid())::text
    and realtime.messages.extension in ('broadcast')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 7. User-management operations. Called only by the API Worker with the
--    service role, AFTER it has verified the actor's own session; p_actor is
--    that verified user. Every rule is re-checked here against the database,
--    atomically with the change and its audit entry, so a bug or a forged
--    request in the Worker cannot skip them.
--
--    Errors use PostgREST's PTxxx codes so the HTTP status matches.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.um_fail(p_status integer, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text := 'PT' || p_status;
begin
  raise exception using errcode = v_code, message = p_message;
end
$$;

create or replace function public.um_audit(
  p_actor uuid, p_target uuid, p_event text, p_old jsonb, p_new jsonb, p_ctx jsonb, p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip inet;
begin
  begin
    v_ip := nullif(p_ctx ->> 'ip', '')::inet;
  exception when others then
    v_ip := null;
  end;
  insert into public.audit_log (actor_id, target_user_id, event_type, old_value, new_value, ip, user_agent, metadata)
  values (p_actor, p_target, p_event, p_old, p_new, v_ip, left(p_ctx ->> 'user_agent', 300), coalesce(p_metadata, '{}'::jsonb));
end
$$;

-- The verified actor, or a 403. Also returns their permission map.
create or replace function public.um_actor(p_actor uuid, p_permission text)
returns public.staff_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.staff_members;
begin
  if p_actor is null or not public.staff_is_active(p_actor) then
    perform public.um_fail(403, 'Your account does not have access.');
  end if;
  if p_permission is not null and not exists (
    select 1 from public.effective_permissions_for(p_actor) e where e.permission_key = p_permission
  ) then
    perform public.um_fail(403, 'You do not have permission to do this.');
  end if;
  select * into v_row from public.staff_members where user_id = p_actor;
  return v_row;
end
$$;

-- Actor may change target: never themselves, and only someone ranked below
-- them (Owners may manage other Owners).
create or replace function public.um_can_manage(p_actor public.staff_members, p_target public.staff_members)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_actor.user_id <> p_target.user_id
     and (p_actor.system_role = 'owner'
          or public.staff_rank(p_actor.system_role, p_actor.developer_level)
             > public.staff_rank(p_target.system_role, p_target.developer_level))
$$;

create or replace function public.um_target(p_actor public.staff_members, p_target uuid, p_allow_self boolean default false)
returns public.staff_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.staff_members;
begin
  select * into v_row from public.staff_members where user_id = p_target;
  if not found then
    perform public.um_fail(404, 'That user does not exist.');
  end if;
  if p_allow_self and v_row.user_id = p_actor.user_id then
    return v_row;
  end if;
  if v_row.user_id = p_actor.user_id then
    perform public.um_fail(403, 'You cannot change your own access. Ask another administrator.');
  end if;
  if not public.um_can_manage(p_actor, v_row) then
    perform public.um_fail(403, 'You can only manage people below your own role.');
  end if;
  return v_row;
end
$$;

-- An actor can hand out a permission only at a scope they hold themselves.
create or replace function public.um_assert_can_grant(p_actor uuid, p_key text, p_scope text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
begin
  if not exists (select 1 from public.permissions where key = p_key) then
    perform public.um_fail(400, format('Unknown permission %s.', p_key));
  end if;
  if exists (select 1 from public.permissions where key = p_key and developer_only) then
    perform public.um_fail(403, 'Developer permissions come from developer access, not from permissions.');
  end if;
  select e.scope into v_scope from public.effective_permissions_for(p_actor) e where e.permission_key = p_key;
  if v_scope is null or public.scope_rank(v_scope) < public.scope_rank(coalesce(p_scope, v_scope)) then
    perform public.um_fail(403, format('You cannot grant %s beyond your own access.', p_key));
  end if;
end
$$;

-- Effective permissions of someone else, with where each one comes from,
-- for the permission matrix.
create or replace function public.um_member_permissions(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.permission_key, jsonb_build_object('scope', e.scope, 'source', e.source)), '{}'::jsonb)
  from public.effective_permissions_for(p_user) e
$$;

create or replace function public.um_member_json(p_user uuid, p_include_section boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', m.user_id,
    'full_name', m.full_name,
    'email', u.email,
    'phone', u.phone,
    'avatar_url', u.raw_user_meta_data ->> 'avatar_url',
    'employee_id', m.employee_id,
    'designation', m.designation,
    'department_id', m.department_id,
    'department', d.name,
    'team_id', m.team_id,
    'team', t.name,
    'reporting_manager_id', m.reporting_manager_id,
    'reporting_manager', rm.full_name,
    'joining_date', m.joining_date,
    'system_role', m.system_role,
    'developer_level', m.developer_level,
    'template_id', m.template_id,
    'template', pt.name,
    'status', case
      when m.status = 'active' and u.banned_until is not null and u.banned_until > now() then 'suspended'
      when m.status = 'active' and u.last_sign_in_at is null then 'invited'
      else m.status end,
    'status_reason', m.status_reason,
    'status_changed_at', m.status_changed_at,
    'last_sign_in_at', u.last_sign_in_at,
    'last_seen_at', m.last_seen_at,
    'last_seen_section', case when p_include_section then m.last_seen_section end,
    'active_sessions', (select count(*) from auth.sessions s where s.user_id = m.user_id and (s.not_after is null or s.not_after > now())),
    'online', coalesce(m.last_seen_at > now() - interval '2 minutes', false)
              and exists (select 1 from auth.sessions s where s.user_id = m.user_id and (s.not_after is null or s.not_after > now())),
    'welcome_sent_at', m.welcome_sent_at,
    'welcome_channel', m.welcome_channel,
    'created_at', m.created_at,
    'rank', public.staff_rank(m.system_role, m.developer_level)
  )
  from public.staff_members m
  join auth.users u on u.id = m.user_id
  left join public.departments d on d.id = m.department_id
  left join public.teams t on t.id = m.team_id
  left join public.staff_members rm on rm.user_id = m.reporting_manager_id
  left join public.permission_templates pt on pt.id = m.template_id
  where m.user_id = p_user
$$;

create or replace function public.um_list_members(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'users.view');
  v_sessions boolean := exists (select 1 from public.effective_permissions_for(p_actor) e where e.permission_key = 'users.sessions');
begin
  return coalesce((
    select jsonb_agg(public.um_member_json(m.user_id, v_sessions) order by m.status <> 'active', lower(m.full_name))
    from public.staff_members m
  ), '[]'::jsonb);
end
$$;

create or replace function public.um_get_member(p_actor uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_self boolean := p_actor = p_target;
  v_actor public.staff_members := public.um_actor(p_actor, case when v_self then null else 'users.view' end);
  v_perms jsonb := public.um_member_permissions(p_actor);
  v_member jsonb;
begin
  v_member := public.um_member_json(p_target, v_self or v_perms ? 'users.sessions');
  if v_member is null then
    perform public.um_fail(404, 'That user does not exist.');
  end if;

  return v_member || jsonb_build_object(
    'permissions', public.um_member_permissions(p_target),
    'overrides', coalesce((
      select jsonb_object_agg(o.permission_key, jsonb_build_object('effect', o.effect, 'scope', o.scope))
      from public.staff_permission_overrides o where o.user_id = p_target
    ), '{}'::jsonb),
    'can_manage', (select public.um_can_manage(v_actor, m) from public.staff_members m where m.user_id = p_target),
    'sessions', case when v_self or v_perms ? 'users.sessions' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id', s.id,
        'signed_in_at', coalesce(ss.signed_in_at, s.created_at),
        'last_seen_at', coalesce(ss.last_seen_at, s.refreshed_at::timestamptz, s.updated_at),
        'section', ss.last_seen_section,
        'city', ss.city, 'region', ss.region, 'country', ss.country,
        'ip', host(coalesce(ss.ip, s.ip)),
        'user_agent', coalesce(ss.user_agent, left(s.user_agent, 300))
      ) order by coalesce(ss.last_seen_at, s.updated_at) desc)
      from auth.sessions s
      left join public.staff_sessions ss on ss.session_id = s.id
      where s.user_id = p_target and (s.not_after is null or s.not_after > now())
    ), '[]'::jsonb) end,
    'recent_sign_ins', case when v_self or v_perms ? 'users.sessions' then coalesce((
      select jsonb_agg(x order by (x ->> 'signed_in_at') desc) from (
        select jsonb_build_object(
          'signed_in_at', ss.signed_in_at, 'ended_at', ss.ended_at, 'ended_reason', ss.ended_reason,
          'city', ss.city, 'region', ss.region, 'country', ss.country,
          'user_agent', ss.user_agent) as x
        from public.staff_sessions ss
        where ss.user_id = p_target
        order by ss.signed_in_at desc
        limit 20
      ) recent
    ), '[]'::jsonb) end
  );
end
$$;

create or replace function public.um_catalog(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'users.view');
  v_is_dev boolean := v_actor.developer_level is not null;
begin
  return jsonb_build_object(
    'permissions', (
      select jsonb_agg(jsonb_build_object(
        'key', p.key, 'module', p.module, 'action', p.action, 'label', p.label,
        'description', p.description, 'allowed_scopes', p.allowed_scopes, 'developer_only', p.developer_only
      ) order by p.sort_order)
      from public.permissions p
      where v_is_dev or not p.developer_only
    ),
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'key', t.key, 'name', t.name, 'description', t.description, 'built_in', t.built_in,
        'members', (select count(*) from public.staff_members m where m.template_id = t.id),
        'permissions', coalesce((
          select jsonb_object_agg(tp.permission_key, tp.scope)
          from public.template_permissions tp where tp.template_id = t.id
        ), '{}'::jsonb)
      ) order by t.built_in desc, lower(t.name))
      from public.permission_templates t
    ), '[]'::jsonb),
    'role_permissions', coalesce((
      select jsonb_object_agg(r.system_role, r.perms) from (
        select system_role, jsonb_object_agg(permission_key, scope) as perms
        from public.role_permissions group by system_role
      ) r
    ), '{}'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'archived', d.archived_at is not null,
        'members', (select count(*) from public.staff_members m where m.department_id = d.id),
        'teams', coalesce((
          select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'archived', t.archived_at is not null,
            'members', (select count(*) from public.staff_members m where m.team_id = t.id)) order by lower(t.name))
          from public.teams t where t.department_id = d.id
        ), '[]'::jsonb)
      ) order by lower(d.name))
      from public.departments d
    ), '[]'::jsonb),
    'actor', jsonb_build_object(
      'user_id', v_actor.user_id,
      'system_role', v_actor.system_role,
      'developer_level', v_actor.developer_level,
      'rank', public.staff_rank(v_actor.system_role, v_actor.developer_level),
      'permissions', (select coalesce(jsonb_object_agg(e.permission_key, e.scope), '{}'::jsonb) from public.effective_permissions_for(p_actor) e)
    )
  );
end
$$;

-- Validates a profile patch shared by create and update. Returns nothing;
-- raises on the first problem.
create or replace function public.um_check_profile(p_actor public.staff_members, p_patch jsonb, p_target uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := p_patch ->> 'system_role';
  v_dept uuid;
  v_team uuid;
  v_manager uuid;
  v_template uuid;
  v_key text;
  v_scope text;
begin
  if p_patch ? 'full_name' and char_length(btrim(coalesce(p_patch ->> 'full_name', ''))) not between 1 and 120 then
    perform public.um_fail(400, 'Enter a name (up to 120 characters).');
  end if;

  if p_patch ? 'system_role' then
    if v_role not in ('staff', 'manager', 'admin', 'owner') then
      perform public.um_fail(400, 'Unknown system role.');
    end if;
    if not exists (select 1 from public.effective_permissions_for(p_actor.user_id) e where e.permission_key = 'users.roles')
       and v_role <> 'staff' then
      perform public.um_fail(403, 'You do not have permission to assign system roles.');
    end if;
    if v_role = 'owner' and p_actor.system_role <> 'owner' then
      perform public.um_fail(403, 'Only an Owner can make someone an Owner.');
    end if;
    if p_actor.system_role <> 'owner'
       and public.staff_rank(v_role, null) >= public.staff_rank(p_actor.system_role, p_actor.developer_level) then
      perform public.um_fail(403, 'You can only assign roles below your own.');
    end if;
  end if;

  if p_patch ? 'developer_level' and p_actor.system_role <> 'owner' then
    perform public.um_fail(403, 'Only an Owner can grant or remove developer access.');
  end if;
  if p_patch ? 'developer_level' and jsonb_typeof(p_patch -> 'developer_level') <> 'null'
     and (p_patch ->> 'developer_level') not in ('developer', 'senior_developer', 'lead_developer', 'system_owner') then
    perform public.um_fail(400, 'Unknown developer level.');
  end if;

  if nullif(p_patch ->> 'department_id', '') is not null then
    v_dept := (p_patch ->> 'department_id')::uuid;
    if not exists (select 1 from public.departments where id = v_dept and archived_at is null) then
      perform public.um_fail(400, 'That department does not exist.');
    end if;
  end if;
  if nullif(p_patch ->> 'team_id', '') is not null then
    v_team := (p_patch ->> 'team_id')::uuid;
    if not exists (
      select 1 from public.teams t where t.id = v_team and t.archived_at is null
        and t.department_id = coalesce(v_dept, (select department_id from public.staff_members where user_id = p_target))
    ) then
      perform public.um_fail(400, 'Choose a team that belongs to the selected department.');
    end if;
  end if;
  if nullif(p_patch ->> 'reporting_manager_id', '') is not null then
    v_manager := (p_patch ->> 'reporting_manager_id')::uuid;
    if v_manager = p_target or not exists (select 1 from public.staff_members where user_id = v_manager and status = 'active') then
      perform public.um_fail(400, 'Choose an active colleague as reporting manager.');
    end if;
  end if;

  if nullif(p_patch ->> 'template_id', '') is not null then
    v_template := (p_patch ->> 'template_id')::uuid;
    if not exists (select 1 from public.permission_templates where id = v_template) then
      perform public.um_fail(400, 'That permission template does not exist.');
    end if;
    if not exists (select 1 from public.effective_permissions_for(p_actor.user_id) e where e.permission_key = 'users.permissions') then
      perform public.um_fail(403, 'You do not have permission to change permission templates.');
    end if;
    for v_key, v_scope in
      select tp.permission_key, tp.scope from public.template_permissions tp where tp.template_id = v_template
    loop
      perform public.um_assert_can_grant(p_actor.user_id, v_key, v_scope);
    end loop;
  end if;

  if nullif(p_patch ->> 'joining_date', '') is not null and (p_patch ->> 'joining_date') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public.um_fail(400, 'Joining date must be a date.');
  end if;
end
$$;

-- Looks up an existing auth account by email or phone, so the Worker can
-- attach a staff record to it instead of creating a duplicate. has_password
-- matters: accounts made here never have one, so a password means someone
-- created the account themselves (sign-up was open until 2026-10). Staff
-- access must not be attached to an account a stranger may hold.
create or replace function public.um_find_account(p_email text, p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', u.id,
    'is_staff', exists (select 1 from public.staff_members m where m.user_id = u.id),
    'has_password', coalesce(u.encrypted_password, '') <> '',
    'email', u.email, 'phone', u.phone)
  from auth.users u
  where u.deleted_at is null
    and ((p_email is not null and lower(u.email) = lower(p_email))
      or (p_phone is not null and u.phone = p_phone))
  order by (p_email is not null and lower(u.email) = lower(p_email)) desc
  limit 1
$$;

-- Dry run for creating someone: the Worker calls this before creating the
-- auth account, so a refused request never leaves an orphan account behind.
create or replace function public.um_check_create(p_actor uuid, p_profile jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'users.create');
begin
  if not (p_profile ? 'full_name') then
    perform public.um_fail(400, 'Enter a name.');
  end if;
  perform public.um_check_profile(v_actor, p_profile, null);
  if nullif(p_profile ->> 'employee_id', '') is not null and exists (
    select 1 from public.staff_members where lower(employee_id) = lower(btrim(p_profile ->> 'employee_id'))
  ) then
    perform public.um_fail(409, 'Another person already has that employee ID.');
  end if;
end
$$;

create or replace function public.um_create_member(p_actor uuid, p_user uuid, p_profile jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'users.create');
  v_template uuid;
begin
  perform public.um_check_create(p_actor, p_profile);
  if not exists (select 1 from auth.users where id = p_user and deleted_at is null) then
    perform public.um_fail(404, 'The sign-in account does not exist.');
  end if;
  if exists (select 1 from public.staff_members where user_id = p_user) then
    perform public.um_fail(409, 'This person is already a user of the workspace.');
  end if;

  v_template := nullif(p_profile ->> 'template_id', '')::uuid;

  insert into public.staff_members (
    user_id, full_name, employee_id, designation, department_id, team_id, reporting_manager_id,
    joining_date, system_role, developer_level, template_id, created_by, updated_by
  ) values (
    p_user,
    btrim(p_profile ->> 'full_name'),
    nullif(btrim(p_profile ->> 'employee_id'), ''),
    nullif(btrim(p_profile ->> 'designation'), ''),
    nullif(p_profile ->> 'department_id', '')::uuid,
    nullif(p_profile ->> 'team_id', '')::uuid,
    nullif(p_profile ->> 'reporting_manager_id', '')::uuid,
    nullif(p_profile ->> 'joining_date', '')::date,
    coalesce(p_profile ->> 'system_role', 'staff'),
    nullif(p_profile ->> 'developer_level', ''),
    v_template,
    p_actor, p_actor
  );

  perform public.um_audit(p_actor, p_user, 'user.created', null, public.um_member_json(p_user, false), p_ctx);
  return public.um_member_json(p_user, false);
end
$$;

create or replace function public.um_update_member(p_actor uuid, p_target uuid, p_patch jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'users.edit');
  v_target public.staff_members := public.um_target(v_actor, p_target);
  v_before jsonb := public.um_member_json(p_target, false);
  v_after jsonb;
  v_allowed text[] := array['full_name', 'employee_id', 'designation', 'department_id', 'team_id',
    'reporting_manager_id', 'joining_date', 'system_role', 'developer_level', 'template_id'];
  v_key text;
begin
  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any (v_allowed) then
      perform public.um_fail(400, format('%s cannot be changed here.', v_key));
    end if;
  end loop;

  perform public.um_check_profile(v_actor, p_patch, p_target);

  if p_patch ? 'employee_id' and nullif(btrim(p_patch ->> 'employee_id'), '') is not null and exists (
    select 1 from public.staff_members
    where lower(employee_id) = lower(btrim(p_patch ->> 'employee_id')) and user_id <> p_target
  ) then
    perform public.um_fail(409, 'Another person already has that employee ID.');
  end if;

  update public.staff_members m set
    full_name = case when p_patch ? 'full_name' then btrim(p_patch ->> 'full_name') else m.full_name end,
    employee_id = case when p_patch ? 'employee_id' then nullif(btrim(p_patch ->> 'employee_id'), '') else m.employee_id end,
    designation = case when p_patch ? 'designation' then nullif(btrim(p_patch ->> 'designation'), '') else m.designation end,
    department_id = case when p_patch ? 'department_id' then nullif(p_patch ->> 'department_id', '')::uuid else m.department_id end,
    team_id = case
      when p_patch ? 'team_id' then nullif(p_patch ->> 'team_id', '')::uuid
      when p_patch ? 'department_id' then null
      else m.team_id end,
    reporting_manager_id = case when p_patch ? 'reporting_manager_id' then nullif(p_patch ->> 'reporting_manager_id', '')::uuid else m.reporting_manager_id end,
    joining_date = case when p_patch ? 'joining_date' then nullif(p_patch ->> 'joining_date', '')::date else m.joining_date end,
    system_role = case when p_patch ? 'system_role' then p_patch ->> 'system_role' else m.system_role end,
    developer_level = case when p_patch ? 'developer_level' then nullif(p_patch ->> 'developer_level', '') else m.developer_level end,
    template_id = case when p_patch ? 'template_id' then nullif(p_patch ->> 'template_id', '')::uuid else m.template_id end,
    updated_at = now(),
    updated_by = p_actor
  where m.user_id = p_target;

  v_after := public.um_member_json(p_target, false);

  if (v_before ->> 'system_role') is distinct from (v_after ->> 'system_role') then
    perform public.um_audit(p_actor, p_target, 'user.role_changed',
      jsonb_build_object('system_role', v_before -> 'system_role'), jsonb_build_object('system_role', v_after -> 'system_role'), p_ctx);
  end if;
  if (v_before ->> 'developer_level') is distinct from (v_after ->> 'developer_level') then
    perform public.um_audit(p_actor, p_target,
      case when v_after ->> 'developer_level' is null then 'user.developer_revoked' else 'user.developer_granted' end,
      jsonb_build_object('developer_level', v_before -> 'developer_level'), jsonb_build_object('developer_level', v_after -> 'developer_level'), p_ctx);
  end if;
  if (v_before ->> 'template_id') is distinct from (v_after ->> 'template_id') then
    perform public.um_audit(p_actor, p_target, 'user.template_changed',
      jsonb_build_object('template', v_before -> 'template'), jsonb_build_object('template', v_after -> 'template'), p_ctx);
  end if;
  if (v_before - array['system_role', 'developer_level', 'template_id', 'template', 'rank', 'online', 'last_seen_at', 'active_sessions'])
     is distinct from (v_after - array['system_role', 'developer_level', 'template_id', 'template', 'rank', 'online', 'last_seen_at', 'active_sessions']) then
    perform public.um_audit(p_actor, p_target, 'user.updated',
      (select jsonb_object_agg(k, v_before -> k) from jsonb_object_keys(p_patch) k where k not in ('system_role', 'developer_level', 'template_id')),
      (select jsonb_object_agg(k, v_after -> k) from jsonb_object_keys(p_patch) k where k not in ('system_role', 'developer_level', 'template_id')),
      p_ctx);
  end if;

  return public.um_get_member(p_actor, p_target);
end
$$;

-- Replaces a person's overrides with the given set:
--   { "clients.delete": {"effect": "grant", "scope": "all"}, "vendors.view": {"effect": "revoke"} }
-- Only keys whose override actually changes are checked against the actor's
-- own access, so an admin can still edit the rest of someone's matrix.
create or replace function public.um_set_overrides(p_actor uuid, p_target uuid, p_overrides jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'users.permissions');
  v_target public.staff_members := public.um_target(v_actor, p_target);
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_value jsonb;
  v_old jsonb;
begin
  if jsonb_typeof(p_overrides) <> 'object' then
    perform public.um_fail(400, 'Overrides must be an object.');
  end if;
  if (select count(*) from jsonb_object_keys(p_overrides)) > 200 then
    perform public.um_fail(400, 'Too many overrides.');
  end if;

  select coalesce(jsonb_object_agg(o.permission_key, jsonb_strip_nulls(jsonb_build_object('effect', o.effect, 'scope', o.scope))), '{}'::jsonb)
  into v_before
  from public.staff_permission_overrides o where o.user_id = p_target;

  -- Every key that changes, in either direction, must be within the actor's
  -- own access: you cannot grant or take away what you do not hold.
  for v_key in
    select k from jsonb_object_keys(p_overrides) k
    union
    select k from jsonb_object_keys(v_before) k
  loop
    v_value := jsonb_strip_nulls(p_overrides -> v_key);
    v_old := v_before -> v_key;
    continue when v_value is not distinct from v_old;
    if v_value is not null and (v_value ->> 'effect') not in ('grant', 'revoke') then
      perform public.um_fail(400, format('Unknown override for %s.', v_key));
    end if;
    perform public.um_assert_can_grant(p_actor, v_key,
      case when v_value ->> 'effect' = 'grant' then v_value ->> 'scope' end);
  end loop;

  delete from public.staff_permission_overrides where user_id = p_target;
  insert into public.staff_permission_overrides (user_id, permission_key, effect, scope, created_by)
  select p_target, k, v ->> 'effect', case when v ->> 'effect' = 'grant' then coalesce(v ->> 'scope', 'all') end, p_actor
  from jsonb_each(p_overrides) as e (k, v)
  where jsonb_typeof(v) = 'object';

  select coalesce(jsonb_object_agg(o.permission_key, jsonb_strip_nulls(jsonb_build_object('effect', o.effect, 'scope', o.scope))), '{}'::jsonb)
  into v_after
  from public.staff_permission_overrides o where o.user_id = p_target;

  if v_before is distinct from v_after then
    perform public.um_audit(p_actor, p_target, 'user.permissions_changed', v_before, v_after, p_ctx);
  end if;

  return public.um_get_member(p_actor, p_target);
end
$$;

-- Ends sessions without any permission check. Internal: callers check first.
create or replace function public.um_end_sessions(p_target uuid, p_session uuid, p_reason text, p_by uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.staff_sessions
  set ended_at = now(), ended_reason = p_reason, ended_by = p_by
  where user_id = p_target and ended_at is null and (p_session is null or session_id = p_session);

  delete from auth.sessions where user_id = p_target and (p_session is null or id = p_session);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Ends sessions. With p_session, just that one (e.g. a lost phone; allowed
-- on yourself); without it, every session of the target.
create or replace function public.um_revoke_sessions(p_actor uuid, p_target uuid, p_session uuid, p_ctx jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_self boolean := p_actor = p_target;
  v_actor public.staff_members;
  v_count integer;
begin
  if v_self and p_session is null then
    perform public.um_fail(400, 'Choose which of your sessions to end.');
  end if;
  v_actor := public.um_actor(p_actor, case when v_self then null else 'users.sessions' end);
  perform public.um_target(v_actor, p_target, v_self);
  if p_session is not null and not exists (select 1 from auth.sessions where id = p_session and user_id = p_target) then
    perform public.um_fail(404, 'That session has already ended.');
  end if;

  v_count := public.um_end_sessions(p_target, p_session, case when v_self then 'signed_out' else 'forced' end, p_actor);

  perform public.um_audit(p_actor, p_target,
    case when p_session is null then 'user.signed_out_everywhere' else 'user.session_ended' end,
    null, jsonb_build_object('sessions_ended', v_count), p_ctx,
    case when p_session is null then '{}'::jsonb else jsonb_build_object('session_id', p_session) end);
  return v_count;
end
$$;

-- Suspend, reactivate or archive. Suspending/archiving also ends every
-- session in the same transaction; the Worker then bans the account in
-- Supabase Auth so it cannot sign in again until reactivated.
create or replace function public.um_set_status(p_actor uuid, p_target uuid, p_status text, p_reason text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'users.suspend');
  v_target public.staff_members := public.um_target(v_actor, p_target);
  v_ended integer := 0;
begin
  if p_status not in ('active', 'suspended', 'archived') then
    perform public.um_fail(400, 'Unknown status.');
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then
    perform public.um_fail(400, 'Keep the reason under 500 characters.');
  end if;
  if v_target.status = p_status then
    return public.um_get_member(p_actor, p_target);
  end if;

  update public.staff_members
  set status = p_status,
      status_reason = nullif(btrim(p_reason), ''),
      status_changed_at = now(),
      status_changed_by = p_actor,
      updated_at = now(),
      updated_by = p_actor
  where user_id = p_target;

  if p_status <> 'active' then
    v_ended := public.um_end_sessions(p_target, null, p_status, p_actor);
  end if;

  perform public.um_audit(p_actor, p_target,
    case p_status when 'active' then 'user.reactivated' when 'suspended' then 'user.suspended' else 'user.archived' end,
    jsonb_build_object('status', v_target.status),
    jsonb_build_object('status', p_status, 'sessions_ended', v_ended),
    p_ctx,
    jsonb_strip_nulls(jsonb_build_object('reason', nullif(btrim(p_reason), ''))));

  return public.um_get_member(p_actor, p_target);
end
$$;

create or replace function public.um_list_audit(p_actor uuid, p_target uuid, p_before bigint, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'audit_logs.view');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'occurred_at', a.occurred_at, 'event_type', a.event_type,
      'actor_id', a.actor_id, 'actor', ma.full_name,
      'target_user_id', a.target_user_id, 'target', mt.full_name,
      'old_value', a.old_value, 'new_value', a.new_value, 'metadata', a.metadata,
      'ip', host(a.ip)
    ) order by a.id desc)
    from (
      select * from public.audit_log
      where (p_target is null or target_user_id = p_target or actor_id = p_target)
        and (p_before is null or id < p_before)
      order by id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) a
    left join public.staff_members ma on ma.user_id = a.actor_id
    left join public.staff_members mt on mt.user_id = a.target_user_id
  ), '[]'::jsonb);
end
$$;

create or replace function public.um_save_template(p_actor uuid, p_template jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'templates.manage');
  v_id uuid := nullif(p_template ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_template ->> 'name', ''));
  v_perms jsonb := coalesce(p_template -> 'permissions', '{}'::jsonb);
  v_before jsonb;
  v_key text;
begin
  if char_length(v_name) not between 1 and 80 then
    perform public.um_fail(400, 'Give the template a name (up to 80 characters).');
  end if;
  if jsonb_typeof(v_perms) <> 'object' then
    perform public.um_fail(400, 'Permissions must be an object.');
  end if;
  for v_key in select jsonb_object_keys(v_perms) loop
    perform public.um_assert_can_grant(p_actor, v_key, v_perms ->> v_key);
  end loop;
  if exists (select 1 from public.permission_templates where lower(name) = lower(v_name) and id is distinct from v_id) then
    perform public.um_fail(409, 'Another template already has that name.');
  end if;
  -- A template change reaches everyone on it, so it must not let an actor
  -- reshape the access of anyone they could not manage directly.
  if v_id is not null and exists (
    select 1 from public.staff_members m
    where m.template_id = v_id and m.user_id <> p_actor and not public.um_can_manage(v_actor, m)
  ) then
    perform public.um_fail(403, 'Someone at or above your role uses this template, so only they or an Owner can change it.');
  end if;

  if v_id is null then
    insert into public.permission_templates (name, description, created_by, updated_by)
    values (v_name, nullif(btrim(p_template ->> 'description'), ''), p_actor, p_actor)
    returning id into v_id;
  else
    select jsonb_build_object('name', t.name, 'permissions', coalesce((
      select jsonb_object_agg(tp.permission_key, tp.scope) from public.template_permissions tp where tp.template_id = t.id), '{}'::jsonb))
    into v_before
    from public.permission_templates t where t.id = v_id;
    if v_before is null then
      perform public.um_fail(404, 'That template does not exist.');
    end if;
    update public.permission_templates
    set name = v_name, description = nullif(btrim(p_template ->> 'description'), ''), updated_at = now(), updated_by = p_actor
    where id = v_id;
    delete from public.template_permissions where template_id = v_id;
  end if;

  insert into public.template_permissions (template_id, permission_key, scope)
  select v_id, k, v_perms ->> k from jsonb_object_keys(v_perms) k;

  perform public.um_audit(p_actor, null, case when v_before is null then 'template.created' else 'template.updated' end,
    v_before, jsonb_build_object('name', v_name, 'permissions', v_perms), p_ctx, jsonb_build_object('template_id', v_id));
  return public.um_catalog(p_actor);
end
$$;

create or replace function public.um_delete_template(p_actor uuid, p_template uuid, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'templates.manage');
  v_row public.permission_templates;
begin
  select * into v_row from public.permission_templates where id = p_template;
  if not found then
    perform public.um_fail(404, 'That template does not exist.');
  end if;
  if v_row.built_in then
    perform public.um_fail(400, 'Built-in templates cannot be deleted.');
  end if;
  if exists (select 1 from public.staff_members where template_id = p_template) then
    perform public.um_fail(409, 'Move everyone off this template before deleting it.');
  end if;
  delete from public.permission_templates where id = p_template;
  perform public.um_audit(p_actor, null, 'template.deleted', jsonb_build_object('name', v_row.name), null, p_ctx,
    jsonb_build_object('template_id', p_template));
  return public.um_catalog(p_actor);
end
$$;

-- Departments and teams: create, rename, archive/restore.
--   { "kind": "department"|"team", "id": uuid?, "name": text, "department_id": uuid?, "archived": bool? }
create or replace function public.um_save_org_unit(p_actor uuid, p_unit jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'departments.manage');
  v_kind text := p_unit ->> 'kind';
  v_id uuid := nullif(p_unit ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_unit ->> 'name', ''));
  v_archived timestamptz := case when (p_unit ->> 'archived')::boolean then now() end;
begin
  if v_kind not in ('department', 'team') then
    perform public.um_fail(400, 'Unknown kind.');
  end if;
  if char_length(v_name) not between 1 and 80 then
    perform public.um_fail(400, 'Enter a name (up to 80 characters).');
  end if;

  begin
    if v_kind = 'department' then
      if v_id is null then
        insert into public.departments (name) values (v_name) returning id into v_id;
      else
        update public.departments set name = v_name,
          archived_at = case when p_unit ? 'archived' then v_archived else archived_at end
        where id = v_id;
        if not found then perform public.um_fail(404, 'That department does not exist.'); end if;
      end if;
    else
      if v_id is null then
        insert into public.teams (department_id, name)
        values ((p_unit ->> 'department_id')::uuid, v_name) returning id into v_id;
      else
        update public.teams set name = v_name,
          archived_at = case when p_unit ? 'archived' then v_archived else archived_at end
        where id = v_id;
        if not found then perform public.um_fail(404, 'That team does not exist.'); end if;
      end if;
    end if;
  exception
    when unique_violation then perform public.um_fail(409, format('A %s with that name already exists.', v_kind));
    when foreign_key_violation or not_null_violation then perform public.um_fail(400, 'Choose a department for the team.');
  end;

  perform public.um_audit(p_actor, null, v_kind || '.saved', null,
    jsonb_build_object('name', v_name, 'archived', v_archived is not null), p_ctx, jsonb_build_object('id', v_id));
  return public.um_catalog(p_actor);
end
$$;

-- The Worker records where a session signed in from (Cloudflare's IP
-- lookup). p_user/p_session come from the caller's verified token.
create or replace function public.um_record_session(
  p_user uuid, p_session uuid, p_ip text, p_city text, p_region text, p_country text, p_user_agent text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ip inet;
begin
  if not public.staff_is_active(p_user)
     or not exists (select 1 from auth.sessions where id = p_session and user_id = p_user) then
    return;
  end if;
  begin
    v_ip := nullif(p_ip, '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.staff_sessions as s (session_id, user_id, signed_in_at, ip, city, region, country, user_agent)
  values (p_session, p_user,
    coalesce((select created_at from auth.sessions where id = p_session), now()),
    v_ip, left(p_city, 80), left(p_region, 80), left(upper(p_country), 2), left(p_user_agent, 300))
  on conflict (session_id) do update
    set ip = coalesce(s.ip, excluded.ip),
        city = coalesce(s.city, excluded.city),
        region = coalesce(s.region, excluded.region),
        country = coalesce(s.country, excluded.country),
        user_agent = coalesce(s.user_agent, excluded.user_agent)
    where s.user_id = p_user;

  delete from public.staff_sessions
  where user_id = p_user and signed_in_at < now() - interval '180 days';
end
$$;

-- Records that a welcome message went out; refuses a resend within 10
-- minutes and more than 30 per day across the workspace (a runaway loop or
-- a compromised admin must not become a bulk sender).
create or replace function public.um_claim_welcome(p_actor uuid, p_target uuid, p_channel text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'users.create');
  v_target public.staff_members;
begin
  select * into v_target from public.staff_members where user_id = p_target for update;
  if not found then
    perform public.um_fail(404, 'That user does not exist.');
  end if;
  if v_target.status <> 'active' then
    perform public.um_fail(409, 'Reactivate this person before sending a welcome message.');
  end if;
  if p_channel not in ('email', 'whatsapp') then
    perform public.um_fail(400, 'Unknown channel.');
  end if;
  if v_target.welcome_sent_at > now() - interval '10 minutes' then
    perform public.um_fail(429, 'A welcome message was sent a few minutes ago. Try again later.');
  end if;
  if (select count(*) from public.audit_log
      where event_type = 'user.welcome_sent' and occurred_at > now() - interval '1 day') >= 30 then
    perform public.um_fail(429, 'The daily limit for welcome messages has been reached.');
  end if;

  update public.staff_members set welcome_sent_at = now(), welcome_channel = p_channel where user_id = p_target;
  perform public.um_audit(p_actor, p_target, 'user.welcome_sent', null, jsonb_build_object('channel', p_channel), p_ctx);
  return jsonb_build_object('channel', p_channel);
end
$$;

-- The send after a claim failed: record it and free the cooldown so the
-- administrator can retry. The attempt still counts toward the daily cap.
create or replace function public.um_welcome_failed(p_actor uuid, p_target uuid, p_channel text, p_reason text, p_ctx jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.staff_members set welcome_sent_at = null, welcome_channel = null where user_id = p_target;
  perform public.um_audit(p_actor, p_target, 'user.welcome_failed', null,
    jsonb_build_object('channel', p_channel), p_ctx, jsonb_build_object('reason', left(p_reason, 120)));
end
$$;

-- A refused user-management request, recorded by the Worker after the
-- refusal (inside the refused call it would roll back with everything else).
create or replace function public.um_log_denied(p_actor uuid, p_target uuid, p_action text, p_message text, p_ctx jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.um_audit(p_actor, p_target, 'access.denied', null, null, p_ctx,
    jsonb_build_object('action', left(p_action, 60), 'message', left(p_message, 200)));
end
$$;

-- First Owner of a fresh installation (scripts/add-auth-user.mjs --owner).
-- Refuses once any active Owner exists: after that, Owners are made in the app.
create or replace function public.um_bootstrap_owner(p_user uuid, p_full_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.staff_members where system_role = 'owner' and status = 'active') then
    perform public.um_fail(409, 'An Owner already exists. Add people from User Management instead.');
  end if;
  if not exists (select 1 from auth.users where id = p_user and deleted_at is null) then
    perform public.um_fail(404, 'That account does not exist.');
  end if;
  insert into public.staff_members (user_id, full_name, system_role, template_id, created_by, updated_by)
  values (p_user, left(btrim(coalesce(nullif(p_full_name, ''), 'Owner')), 120), 'owner',
    (select id from public.permission_templates where key = 'administrator'), p_user, p_user)
  on conflict (user_id) do update set system_role = 'owner', status = 'active', updated_at = now();
  perform public.um_audit(null, p_user, 'user.owner_bootstrapped', null, jsonb_build_object('system_role', 'owner'), '{}'::jsonb);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Grants. Browser sessions get the three self-service calls; everything
--    um_* is for the Worker's service role only.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'current_session_id', 'session_is_live', 'staff_is_active', 'is_staff', 'scope_rank', 'developer_rank',
        'staff_rank', 'effective_permissions_for', 'permission_scope', 'has_permission', 'my_access',
        'touch_session', 'set_my_theme', 'apply_crud_policies', 'um_fail', 'um_audit', 'um_actor',
        'um_can_manage', 'um_target', 'um_assert_can_grant', 'um_member_permissions', 'um_member_json',
        'um_list_members', 'um_get_member', 'um_catalog', 'um_check_profile', 'um_find_account',
        'um_check_create', 'um_create_member', 'um_update_member', 'um_set_overrides', 'um_revoke_sessions',
        'um_set_status', 'um_list_audit', 'um_save_template', 'um_delete_template', 'um_save_org_unit',
        'um_record_session', 'um_claim_welcome', 'um_welcome_failed', 'um_end_sessions', 'um_log_denied', 'um_bootstrap_owner', 'audit_log_is_append_only', 'permission_scope_is_allowed',
        'staff_members_keep_an_owner', 'salesorder_creator_is_fixed'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end
$$;

-- Used inside RLS policies and by the dashboard.
grant execute on function public.current_session_id() to authenticated;
grant execute on function public.session_is_live() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.permission_scope(text) to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.touch_session(text) to authenticated;
grant execute on function public.set_my_theme(text) to authenticated;

notify pgrst, 'reload schema';
