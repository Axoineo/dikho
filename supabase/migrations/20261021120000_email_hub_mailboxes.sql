-- ============================================================================
-- EMAIL HUB, part 1: connected mailboxes, who may use them, and the cached
-- thread metadata the inbox lists. Decision record: docs/decisions/0009-email-hub.md.
--
-- WHAT IS STORED
--   - email_accounts: one row per connected Google Workspace mailbox, personal
--     (one owner) or shared (a team address that is a real Google account).
--     Sync bookkeeping (Gmail history cursor, watch expiry, lease) lives here.
--   - email_account_members: who may use a mailbox, and how far
--     (viewer < responder < manager < admin).
--   - email_oauth_credentials: the refresh token, ENCRYPTED BY THE WORKER
--     (AES-256-GCM, key held only as a Worker secret, account id as associated
--     data). This database never sees a usable token.
--   - email_oauth_states: one-time OAuth state + PKCE verifier, 10 minutes.
--   - email_threads: thread METADATA only (subject, participants, dates,
--     labels, unread, attachment flag) plus Dikho's own workflow columns
--     (assignee, status). Message bodies and attachments are never stored;
--     the Worker fetches them from Gmail when a thread is opened.
--   - email_thread_notes / email_thread_links: internal notes and links to
--     clients, vendors and leads. Dikho data; never written to Gmail.
--   - email_mailbox_sends: one row per send attempt from the composer, keyed
--     by an id the browser generates, so a double submit cannot send twice.
--
-- WHO MAY DO WHAT (enforced in the em_* functions below, not only the UI)
--   - Using a mailbox needs BOTH the email_inbox.view permission AND a
--     membership row. Owners and developers hold every permission but get no
--     implicit membership: a global permission never opens a mailbox.
--   - Nobody grants or changes their own membership (leaving is allowed).
--   - A personal mailbox's members are chosen only by its owner, and never
--     above manager. If the owner stops being active staff, the mailbox is
--     closed to everyone and is not synced.
--   - A shared mailbox is created by a holder of email_mailboxes.manage, who
--     does NOT become a member by doing so. Its members are managed by its
--     admins or by holders of email_mailboxes.manage.
--   - Roles: viewer reads; responder also replies, labels, archives, notes,
--     links and takes threads; manager also assigns threads to others; admin
--     (shared mailboxes) also manages members and the connection.
--   - Connecting, disconnecting, removing and every membership change is
--     written to the append-only audit_log.
--
-- BROWSER ACCESS: none. RLS is on with no permissive policy, every table has
-- the restrictive "staff members only" policy, and anon/authenticated hold
-- no privileges. The API Worker calls the em_* functions with the service
-- role, passing the actor it verified in requireAuth; each function
-- re-checks that actor.
--
-- ORDER: needs 20261006150000_user_management.sql (staff_members, um_*).
-- Harmless before the API that uses it is deployed: nothing reads these
-- tables, and the permissions grant nothing on their own.
-- If applied with the Supabase MCP `apply_migration` tool, rename this file to
-- the version it records (supabase/AGENTS.md).
--
-- ROLLBACK: the module is off unless the Worker has EMAIL_HUB_ENABLED=true.
-- The tables can stay. To remove them entirely: drop the em_* functions,
-- then the email_* tables, then delete the email_* permission keys.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Permissions. They open the module; they never open a mailbox.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.permissions (key, module, action, label, description, allowed_scopes, developer_only, min_developer_level, sort_order) values
  ('email_inbox.view',        'Email', 'view',    'Use the Email inbox',
   'Opens the Email Hub and lets the person connect their own mailbox. Shows only mailboxes they have been added to; never anyone else''s.', array['all'], false, null, 400),
  ('email_mailboxes.manage',  'Email', 'edit',    'Set up shared mailboxes',
   'Add shared mailboxes and choose who may use them. Does not let them read a mailbox they are not a member of.', array['all'], false, null, 401)
on conflict (key) do update set
  module = excluded.module, action = excluded.action, label = excluded.label,
  description = excluded.description, allowed_scopes = excluded.allowed_scopes,
  developer_only = excluded.developer_only, min_developer_level = excluded.min_developer_level,
  sort_order = excluded.sort_order;

-- Administrator holds every business permission. Sales and support work in
-- the inbox; nobody else gets it by default.
insert into public.template_permissions (template_id, permission_key, scope)
select t.id, v.permission_key, 'all'
from (values
  ('administrator', 'email_inbox.view'), ('administrator', 'email_mailboxes.manage'),
  ('sales_executive', 'email_inbox.view'), ('sales_manager', 'email_inbox.view'),
  ('whatsapp_support', 'email_inbox.view')
) as v (template_key, permission_key)
join public.permission_templates t on t.key = v.template_key
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Tables
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('personal', 'shared')),
  provider text not null default 'google' check (provider in ('google')),
  email_address text not null check (
    char_length(email_address) <= 254
    and email_address = lower(email_address)
    and email_address ~ '^[^[:space:]@]{1,64}@[^[:space:]@]{1,189}\.[^[:space:]@]{2,63}$'),
  display_name text check (char_length(display_name) <= 120),
  -- Personal mailboxes only. Never deleted (staff records are archived), so
  -- RESTRICT keeps a mailbox from outliving the record of whose it was.
  owner_id uuid references public.staff_members (user_id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'reauth_required', 'disconnected')),
  google_subject text check (char_length(google_subject) <= 64),
  -- Gmail's history cursor: an unsigned 64-bit number, compared numerically.
  history_id numeric(20, 0),
  needs_full_sync boolean not null default true,
  sync_lease_until timestamptz,
  last_synced_at timestamptz,
  last_sync_error text check (char_length(last_sync_error) <= 300),
  watch_expires_at timestamptz,
  created_by uuid not null references public.staff_members (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'personal') = (owner_id is not null))
);
create unique index if not exists email_accounts_address_key on public.email_accounts (email_address);
create index if not exists email_accounts_owner_idx on public.email_accounts (owner_id) where owner_id is not null;

create table if not exists public.email_account_members (
  account_id uuid not null references public.email_accounts (id) on delete cascade,
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  role text not null check (role in ('viewer', 'responder', 'manager', 'admin')),
  granted_by uuid references public.staff_members (user_id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index if not exists email_account_members_user_idx on public.email_account_members (user_id);

-- Ciphertext only: 'k<key id>.<iv>.<ciphertext>' produced by the Worker.
create table if not exists public.email_oauth_credentials (
  account_id uuid primary key references public.email_accounts (id) on delete cascade,
  refresh_token_enc text not null check (char_length(refresh_token_enc) between 16 and 4096),
  scopes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.email_oauth_states (
  -- SHA-256 (hex) of the state value; the value itself is only in the
  -- browser's redirect, so a database reader cannot complete someone's flow.
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  account_id uuid references public.email_accounts (id) on delete cascade,
  code_verifier text not null check (char_length(code_verifier) between 43 and 128),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index if not exists email_oauth_states_user_idx on public.email_oauth_states (user_id);

create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts (id) on delete cascade,
  gmail_thread_id text not null check (gmail_thread_id ~ '^[0-9a-f]{1,32}$'),
  subject text check (char_length(subject) <= 998),
  participants jsonb not null default '[]'::jsonb check (jsonb_typeof(participants) = 'array'),
  participant_emails text[] not null default '{}',
  search_text text not null default '' check (char_length(search_text) <= 2000),
  last_message_at timestamptz not null,
  message_count integer not null default 0 check (message_count >= 0),
  unread boolean not null default false,
  starred boolean not null default false,
  label_ids text[] not null default '{}',
  has_attachments boolean not null default false,
  -- Removed in Gmail (permanently deleted). Kept so notes and links survive;
  -- hidden from every list.
  gmail_deleted_at timestamptz,
  synced_at timestamptz not null default now(),
  -- Dikho workflow. Never written to Gmail.
  assigned_to uuid references public.staff_members (user_id) on delete set null,
  workflow_status text not null default 'open' check (workflow_status in ('open', 'pending', 'closed')),
  workflow_updated_at timestamptz,
  unique (account_id, gmail_thread_id)
);
create index if not exists email_threads_list_idx
  on public.email_threads (account_id, last_message_at desc, id desc) where gmail_deleted_at is null;
create index if not exists email_threads_assigned_idx
  on public.email_threads (assigned_to, last_message_at desc) where assigned_to is not null;
create index if not exists email_threads_participants_idx on public.email_threads using gin (participant_emails);

create table if not exists public.email_thread_notes (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads (id) on delete cascade,
  author_id uuid not null references public.staff_members (user_id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists email_thread_notes_thread_idx on public.email_thread_notes (thread_id, created_at);
create index if not exists email_thread_notes_author_idx on public.email_thread_notes (author_id);

create table if not exists public.email_thread_links (
  thread_id uuid not null references public.email_threads (id) on delete cascade,
  entity_type text not null check (entity_type in ('client', 'vendor', 'lead')),
  -- clients/vendors have bigint ids, leads uuid ids.
  entity_id text not null check (entity_id ~ '^[0-9a-f-]{1,36}$'),
  linked_by uuid references public.staff_members (user_id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (thread_id, entity_type, entity_id)
);
create index if not exists email_thread_links_entity_idx on public.email_thread_links (entity_type, entity_id);

create table if not exists public.email_mailbox_sends (
  id uuid primary key,
  account_id uuid not null references public.email_accounts (id) on delete cascade,
  user_id uuid not null references public.staff_members (user_id) on delete restrict,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'uncertain')),
  gmail_message_id text check (gmail_message_id ~ '^[0-9a-f]{1,32}$'),
  gmail_thread_id text check (gmail_thread_id ~ '^[0-9a-f]{1,32}$'),
  error text check (char_length(error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_mailbox_sends_time_idx on public.email_mailbox_sends (created_at);
create index if not exists email_mailbox_sends_account_idx on public.email_mailbox_sends (account_id);
create index if not exists email_mailbox_sends_user_idx on public.email_mailbox_sends (user_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'email_accounts', 'email_account_members', 'email_oauth_credentials', 'email_oauth_states',
    'email_threads', 'email_thread_notes', 'email_thread_links', 'email_mailbox_sends'
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
-- 3. Core checks
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.em_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_position(array['viewer', 'responder', 'manager', 'admin'], p_role), 0)
$$;

create or replace function public.em_holds(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.effective_permissions_for(p_user) e where e.permission_key = p_permission)
$$;

-- The person's role in a mailbox, or null. Null unless they are active staff
-- holding email_inbox.view, the mailbox is open (a personal mailbox closes
-- when its owner stops being active), and they have a membership row.
create or replace function public.em_mailbox_role(p_user uuid, p_account uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.email_account_members m
  join public.email_accounts a on a.id = m.account_id
  where m.account_id = p_account
    and m.user_id = p_user
    and (a.kind = 'shared' or public.staff_is_active(a.owner_id))
    and public.staff_is_active(p_user)
    and public.em_holds(p_user, 'email_inbox.view')
$$;

-- May this person change a mailbox's members and connection? Personal: its
-- owner. Shared: its admins, or holders of email_mailboxes.manage.
create or replace function public.em_can_configure(p_user uuid, p_account public.email_accounts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: a non-member's role is NULL, and NULL = 'admin' is not false.
  select coalesce(public.staff_is_active(p_user) and case
    when p_account.kind = 'personal' then p_account.owner_id = p_user
    else public.em_holds(p_user, 'email_mailboxes.manage')
      or public.em_mailbox_role(p_user, p_account.id) = 'admin'
  end, false)
$$;

create or replace function public.em_account_json(p_account public.email_accounts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_account.id,
    'kind', p_account.kind,
    'email_address', p_account.email_address,
    'display_name', p_account.display_name,
    'owner_id', p_account.owner_id,
    'owner_name', (select m.full_name from public.staff_members m where m.user_id = p_account.owner_id),
    'status', p_account.status,
    'last_synced_at', p_account.last_synced_at,
    'last_sync_error', p_account.last_sync_error,
    'watch_expires_at', p_account.watch_expires_at,
    'created_at', p_account.created_at
  )
$$;

-- Access to one mailbox at a minimum role, or a refusal. A mailbox the actor
-- cannot see is "not found", so its existence is not revealed. Returns the
-- account, the actor's role and the encrypted token for the Worker's own use
-- (never sent to the browser).
create or replace function public.em_access(p_actor uuid, p_account uuid, p_min_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.email_accounts;
  v_role text;
begin
  perform public.um_actor(p_actor, 'email_inbox.view');
  select * into v_account from public.email_accounts where id = p_account;
  v_role := public.em_mailbox_role(p_actor, p_account);
  if v_account.id is null or v_role is null then
    perform public.um_fail(404, 'Mailbox not found.');
  end if;
  if public.em_role_rank(v_role) < public.em_role_rank(p_min_role) then
    perform public.um_fail(403, 'Your role in this mailbox does not allow this.');
  end if;
  return public.em_account_json(v_account) || jsonb_build_object(
    'role', v_role,
    'history_id', v_account.history_id::text,
    'token_enc', (select c.refresh_token_enc from public.email_oauth_credentials c where c.account_id = v_account.id)
  );
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Mailboxes and members
-- ─────────────────────────────────────────────────────────────────────────

-- What the Email Hub shows this person: the mailboxes they are a member of
-- (with unread counts) and, for holders of email_mailboxes.manage, every
-- shared mailbox's configuration (no content).
create or replace function public.em_list_accounts(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inbox boolean;
  v_manage boolean;
begin
  perform public.um_actor(p_actor, null);
  v_inbox := public.em_holds(p_actor, 'email_inbox.view');
  v_manage := public.em_holds(p_actor, 'email_mailboxes.manage');

  return jsonb_build_object(
    'can_connect_personal', v_inbox,
    'can_manage_shared', v_manage,
    'mailboxes', coalesce((
      select jsonb_agg(public.em_account_json(a) || jsonb_build_object(
          'role', m.role,
          'unread_count', (select count(*) from public.email_threads t
                           where t.account_id = a.id and t.unread and t.gmail_deleted_at is null
                             and 'INBOX' = any (t.label_ids)),
          'can_configure', public.em_can_configure(p_actor, a))
        order by (a.kind = 'personal') desc, a.email_address)
      from public.email_account_members m
      join public.email_accounts a on a.id = m.account_id
      where v_inbox and m.user_id = p_actor
        and (a.kind = 'shared' or public.staff_is_active(a.owner_id))
    ), '[]'::jsonb),
    'shared_setup', case when v_manage then coalesce((
      select jsonb_agg(public.em_account_json(a) || jsonb_build_object(
          'member_count', (select count(*) from public.email_account_members x where x.account_id = a.id))
        order by a.email_address)
      from public.email_accounts a
      where a.kind = 'shared'
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end
$$;

create or replace function public.em_create_shared(p_actor uuid, p_email text, p_display_name text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_account public.email_accounts;
begin
  perform public.um_actor(p_actor, 'email_mailboxes.manage');
  if v_email !~ '^[^[:space:]@]{1,64}@[^[:space:]@]{1,189}\.[^[:space:]@]{2,63}$' or char_length(v_email) > 254 then
    perform public.um_fail(400, 'Enter a valid email address.');
  end if;
  if exists (select 1 from public.email_accounts where email_address = v_email) then
    perform public.um_fail(409, 'This address is already set up in Dikho.');
  end if;
  insert into public.email_accounts (kind, email_address, display_name, created_by)
  values ('shared', v_email, nullif(btrim(left(p_display_name, 120)), ''), p_actor)
  returning * into v_account;
  perform public.um_audit(p_actor, null, 'email_mailbox.created', null,
    jsonb_build_object('email_address', v_email, 'kind', 'shared'), p_ctx,
    jsonb_build_object('account_id', v_account.id));
  return public.em_account_json(v_account);
end
$$;

create or replace function public.em_list_members(p_actor uuid, p_account uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.email_accounts;
begin
  perform public.um_actor(p_actor, null);
  select * into v_account from public.email_accounts where id = p_account;
  if v_account.id is null
     or not (public.em_can_configure(p_actor, v_account) or public.em_mailbox_role(p_actor, p_account) is not null) then
    perform public.um_fail(404, 'Mailbox not found.');
  end if;
  return jsonb_build_object(
    'account', public.em_account_json(v_account),
    'can_configure', public.em_can_configure(p_actor, v_account),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
          'user_id', m.user_id,
          'full_name', s.full_name,
          'role', m.role,
          'is_owner', m.user_id = v_account.owner_id,
          'active', public.staff_is_active(m.user_id),
          'granted_at', m.granted_at,
          'granted_by_name', g.full_name)
        order by public.em_role_rank(m.role) desc, s.full_name)
      from public.email_account_members m
      join public.staff_members s on s.user_id = m.user_id
      left join public.staff_members g on g.user_id = m.granted_by
      where m.account_id = p_account
    ), '[]'::jsonb)
  );
end
$$;

-- Adds, changes (p_role) or removes (p_role null) one member.
create or replace function public.em_set_member(p_actor uuid, p_account uuid, p_target uuid, p_role text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.email_accounts;
  v_old text;
begin
  perform public.um_actor(p_actor, null);
  select * into v_account from public.email_accounts where id = p_account for update;
  if v_account.id is null then
    perform public.um_fail(404, 'Mailbox not found.');
  end if;
  if p_role is not null and p_role not in ('viewer', 'responder', 'manager', 'admin') then
    perform public.um_fail(400, 'Unknown mailbox role.');
  end if;
  if p_target is null then
    perform public.um_fail(400, 'Choose a person.');
  end if;
  select role into v_old from public.email_account_members where account_id = p_account and user_id = p_target;

  if p_target = p_actor then
    -- Leaving is always allowed, except for the owner of a personal mailbox
    -- (they remove the mailbox instead). Granting or raising your own access
    -- never is: someone else has to decide that.
    if p_role is not null or v_old is null then
      perform public.um_fail(403, 'You cannot change your own access to a mailbox. Ask someone who manages it.');
    end if;
    if v_account.owner_id = p_actor then
      perform public.um_fail(400, 'You own this mailbox. Remove the mailbox instead of leaving it.');
    end if;
  else
    if not public.em_can_configure(p_actor, v_account) then
      -- Personal mailboxes are invisible to non-members, shared ones to
      -- anyone neither a member nor a holder of email_mailboxes.manage.
      if public.em_mailbox_role(p_actor, p_account) is null
         and not (v_account.kind = 'shared' and public.em_holds(p_actor, 'email_mailboxes.manage')) then
        perform public.um_fail(404, 'Mailbox not found.');
      end if;
      perform public.um_fail(403, 'Only the mailbox''s owner or its administrators can change who may use it.');
    end if;
    if v_account.kind = 'personal' then
      if p_target = v_account.owner_id then
        perform public.um_fail(400, 'The owner''s access to their own mailbox cannot be changed.');
      end if;
      if p_role = 'admin' then
        perform public.um_fail(400, 'A personal mailbox has one administrator: its owner. Choose viewer, responder or manager.');
      end if;
    end if;
    if p_role is not null and not public.staff_is_active(p_target) then
      perform public.um_fail(400, 'That person is not an active user of Dikho.');
    end if;
  end if;

  if p_role is null then
    delete from public.email_account_members where account_id = p_account and user_id = p_target;
  else
    insert into public.email_account_members (account_id, user_id, role, granted_by)
    values (p_account, p_target, p_role, p_actor)
    on conflict (account_id, user_id) do update set role = excluded.role, granted_by = excluded.granted_by, granted_at = now();
  end if;

  -- Someone who can no longer answer this mailbox's mail no longer holds its threads.
  if p_role is null or p_role = 'viewer' then
    update public.email_threads set assigned_to = null, workflow_updated_at = now()
    where account_id = p_account and assigned_to = p_target;
  end if;

  if v_old is distinct from p_role then
    perform public.um_audit(p_actor, p_target,
      case when v_old is null then 'email_mailbox.member_added'
           when p_role is null then 'email_mailbox.member_removed'
           else 'email_mailbox.member_changed' end,
      case when v_old is null then null else jsonb_build_object('role', v_old) end,
      case when p_role is null then null else jsonb_build_object('role', p_role) end,
      p_ctx, jsonb_build_object('account_id', p_account, 'email_address', v_account.email_address));
  end if;
  return public.em_list_members(p_actor, p_account);
end
$$;

-- Active staff, names only: who can be added to a mailbox.
create or replace function public.em_directory(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.um_actor(p_actor, null);
  if not (public.em_holds(p_actor, 'email_inbox.view') or public.em_holds(p_actor, 'email_mailboxes.manage')) then
    perform public.um_fail(403, 'You do not have permission to do this.');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'full_name', m.full_name,
             'has_inbox', public.em_holds(m.user_id, 'email_inbox.view')) order by m.full_name)
    from public.staff_members m
    where public.staff_is_active(m.user_id)
  ), '[]'::jsonb);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Connecting a mailbox (Google OAuth). The Worker generates the state and
--    PKCE verifier, stores them here, and later takes them back exactly once.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.em_begin_connect(p_actor uuid, p_account uuid, p_state_hash text, p_verifier text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.email_accounts;
begin
  if p_account is null then
    perform public.um_actor(p_actor, 'email_inbox.view');
  else
    perform public.um_actor(p_actor, null);
    select * into v_account from public.email_accounts where id = p_account;
    if v_account.id is null or v_account.kind <> 'shared' then
      perform public.um_fail(404, 'Mailbox not found.');
    end if;
    if not public.em_can_configure(p_actor, v_account) then
      perform public.um_fail(403, 'Only this mailbox''s administrators can connect it.');
    end if;
  end if;

  delete from public.email_oauth_states where expires_at < now();
  if (select count(*) from public.email_oauth_states where user_id = p_actor) >= 5 then
    perform public.um_fail(429, 'Too many connection attempts in progress. Wait ten minutes and try again.');
  end if;
  insert into public.email_oauth_states (state_hash, user_id, account_id, code_verifier)
  values (p_state_hash, p_actor, p_account, p_verifier);
  return jsonb_build_object('login_hint', v_account.email_address);
end
$$;

-- Takes a state back exactly once. A replayed, unknown or expired state is a 400.
create or replace function public.em_take_state(p_state_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_state public.email_oauth_states;
begin
  delete from public.email_oauth_states where state_hash = p_state_hash returning * into v_state;
  if v_state.state_hash is null or v_state.expires_at < now() then
    return null;
  end if;
  return jsonb_build_object('user_id', v_state.user_id, 'account_id', v_state.account_id, 'code_verifier', v_state.code_verifier);
end
$$;

-- Stores the result of a completed Google sign-in. p_email and p_subject come
-- from Google's id_token, checked by the Worker. Personal: creates or
-- reconnects the actor's own mailbox. Shared: the Google account must be the
-- mailbox's address.
create or replace function public.em_store_connection(
  p_actor uuid, p_account uuid, p_email text, p_subject text, p_display_name text,
  p_token_enc text, p_scopes text[], p_ctx jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_account public.email_accounts;
  v_new boolean := false;
begin
  if p_account is null then
    perform public.um_actor(p_actor, 'email_inbox.view');
    select * into v_account from public.email_accounts where email_address = v_email for update;
    if v_account.id is null then
      insert into public.email_accounts (kind, email_address, display_name, owner_id, created_by)
      values ('personal', v_email, nullif(btrim(left(p_display_name, 120)), ''), p_actor, p_actor)
      returning * into v_account;
      v_new := true;
    elsif v_account.kind <> 'personal' or v_account.owner_id <> p_actor then
      perform public.um_fail(409, 'This mailbox is already connected to Dikho by someone else, or is set up as a shared mailbox.');
    end if;
    insert into public.email_account_members (account_id, user_id, role, granted_by)
    values (v_account.id, p_actor, 'admin', p_actor)
    on conflict (account_id, user_id) do update set role = 'admin';
  else
    perform public.um_actor(p_actor, null);
    select * into v_account from public.email_accounts where id = p_account for update;
    if v_account.id is null or v_account.kind <> 'shared' then
      perform public.um_fail(404, 'Mailbox not found.');
    end if;
    if not public.em_can_configure(p_actor, v_account) then
      perform public.um_fail(403, 'Only this mailbox''s administrators can connect it.');
    end if;
    if v_account.email_address <> v_email then
      perform public.um_fail(409, 'You signed in to Google as a different address than this shared mailbox. Sign in as the shared mailbox itself.');
    end if;
  end if;

  insert into public.email_oauth_credentials (account_id, refresh_token_enc, scopes, updated_at)
  values (v_account.id, p_token_enc, coalesce(p_scopes, '{}'), now())
  on conflict (account_id) do update set refresh_token_enc = excluded.refresh_token_enc, scopes = excluded.scopes, updated_at = now();

  update public.email_accounts
  set status = 'connected',
      needs_full_sync = needs_full_sync or v_new or google_subject is distinct from p_subject or history_id is null,
      google_subject = p_subject,
      display_name = coalesce(display_name, nullif(btrim(left(p_display_name, 120)), '')),
      last_sync_error = null,
      updated_at = now()
  where id = v_account.id
  returning * into v_account;

  perform public.um_audit(p_actor, v_account.owner_id, 'email_mailbox.connected', null,
    jsonb_build_object('email_address', v_account.email_address, 'kind', v_account.kind), p_ctx,
    jsonb_build_object('account_id', v_account.id, 'scopes', to_jsonb(coalesce(p_scopes, '{}'))));
  return public.em_account_json(v_account);
end
$$;

-- Stops using a mailbox: deletes the stored token (returned once so the
-- Worker can revoke it at Google) and keeps the cached metadata, notes and
-- links. p_remove also deletes the mailbox and everything cached for it.
create or replace function public.em_disconnect(p_actor uuid, p_account uuid, p_remove boolean, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.email_accounts;
  v_token text;
begin
  perform public.um_actor(p_actor, null);
  select * into v_account from public.email_accounts where id = p_account for update;
  if v_account.id is null
     or not (public.em_can_configure(p_actor, v_account) or public.em_mailbox_role(p_actor, p_account) is not null) then
    perform public.um_fail(404, 'Mailbox not found.');
  end if;
  if not public.em_can_configure(p_actor, v_account) then
    perform public.um_fail(403, 'Only the mailbox''s owner or its administrators can disconnect it.');
  end if;

  delete from public.email_oauth_credentials where account_id = p_account returning refresh_token_enc into v_token;
  if p_remove then
    delete from public.email_accounts where id = p_account;
  else
    update public.email_accounts
    set status = 'disconnected', watch_expires_at = null, sync_lease_until = null, updated_at = now()
    where id = p_account;
  end if;
  perform public.um_audit(p_actor, v_account.owner_id,
    case when p_remove then 'email_mailbox.removed' else 'email_mailbox.disconnected' end,
    jsonb_build_object('email_address', v_account.email_address, 'kind', v_account.kind, 'status', v_account.status),
    null, p_ctx, jsonb_build_object('account_id', p_account));
  return jsonb_build_object('token_enc', v_token, 'email_address', v_account.email_address);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Sync bookkeeping. System calls: the Worker has already decided this
--    work is due (a push from Google, or someone using the Email Hub).
-- ─────────────────────────────────────────────────────────────────────────

-- Claims a mailbox for one sync run. Null when another run holds it, the
-- mailbox is not connected, or its personal owner is no longer active.
create or replace function public.em_claim_sync(p_account uuid, p_lease_seconds integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.email_accounts;
begin
  update public.email_accounts a
  set sync_lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 10), 300))
  where a.id = p_account
    and a.status = 'connected'
    and (a.kind = 'shared' or public.staff_is_active(a.owner_id))
    and (a.sync_lease_until is null or a.sync_lease_until < now())
  returning * into v_account;
  if v_account.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_account.id,
    'email_address', v_account.email_address,
    'history_id', v_account.history_id::text,
    'needs_full_sync', v_account.needs_full_sync,
    'watch_expires_at', v_account.watch_expires_at,
    'token_enc', (select c.refresh_token_enc from public.email_oauth_credentials c where c.account_id = v_account.id)
  );
end
$$;

create or replace function public.em_finish_sync(
  p_account uuid, p_history_id text, p_full boolean, p_error text, p_watch_expires_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_history numeric(20, 0) := case when p_history_id ~ '^[0-9]{1,20}$' then p_history_id::numeric end;
begin
  update public.email_accounts
  set sync_lease_until = null,
      last_sync_error = case when p_error is null then null else left(p_error, 300) end,
      last_synced_at = case when p_error is null then now() else last_synced_at end,
      history_id = case
        when p_error is not null or v_history is null then history_id
        when p_full then v_history
        else greatest(coalesce(history_id, 0), v_history) end,
      needs_full_sync = case when p_error is null and p_full then false else needs_full_sync end,
      watch_expires_at = coalesce(p_watch_expires_at, watch_expires_at),
      updated_at = now()
  where id = p_account;
end
$$;

-- Gmail no longer has history that old (or the token was revoked): next
-- run starts over, or the owner has to sign in again.
create or replace function public.em_mark_account(p_account uuid, p_state text, p_error text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_state not in ('full_sync', 'reauth_required') then
    raise exception 'Unknown mailbox state %', p_state using errcode = 'PT400';
  end if;
  update public.email_accounts
  set needs_full_sync = needs_full_sync or p_state = 'full_sync',
      status = case when p_state = 'reauth_required' then 'reauth_required' else status end,
      watch_expires_at = case when p_state = 'reauth_required' then null else watch_expires_at end,
      last_sync_error = left(p_error, 300),
      sync_lease_until = null,
      updated_at = now()
  where id = p_account;
end
$$;

-- Connected mailboxes worth syncing now, for one person (on their visit) or
-- for everyone (p_user null): stale, never synced, or a watch about to lapse.
create or replace function public.em_sync_due(p_user uuid, p_limit integer)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.id), '{}')
  from (
    select a.id
    from public.email_accounts a
    where a.status = 'connected'
      and (a.kind = 'shared' or public.staff_is_active(a.owner_id))
      and (a.sync_lease_until is null or a.sync_lease_until < now())
      and (a.last_synced_at is null
           or a.last_synced_at < now() - interval '3 minutes'
           or a.needs_full_sync
           or a.watch_expires_at < now() + interval '1 day')
      and (p_user is null or exists (
            select 1 from public.email_account_members m where m.account_id = a.id and m.user_id = p_user))
    order by a.last_synced_at nulls first
    limit least(greatest(p_limit, 1), 10)
  ) x
$$;

-- A Gmail push for this address. Returns the mailbox id when the push carries
-- history the mailbox has not seen yet; null otherwise (duplicate, stale,
-- unknown or disconnected), so replays do no work.
create or replace function public.em_push_target(p_email text, p_history_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.email_accounts a
  where a.email_address = lower(btrim(p_email))
    and a.status = 'connected'
    and p_history_id ~ '^[0-9]{1,20}$'
    and (a.history_id is null or p_history_id::numeric > a.history_id)
$$;

-- Upserts thread metadata from Gmail. Dikho's workflow columns are kept.
create or replace function public.em_upsert_threads(p_account uuid, p_threads jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_threads) <> 'array' or jsonb_array_length(p_threads) > 100 then
    raise exception 'Expected at most 100 threads' using errcode = 'PT400';
  end if;

  insert into public.email_threads as t (
    account_id, gmail_thread_id, subject, participants, participant_emails, search_text,
    last_message_at, message_count, unread, starred, label_ids, has_attachments, gmail_deleted_at, synced_at)
  select
    p_account, x.id, left(x.subject, 998), p.participants, p.emails,
    left(lower(coalesce(x.subject, '') || ' ' || p.words), 2000),
    x.last_message_at, greatest(coalesce(x.message_count, 0), 0), coalesce(x.unread, false),
    'STARRED' = any (coalesce(x.label_ids, '{}')), coalesce(x.label_ids, '{}'),
    coalesce(x.has_attachments, false), null, now()
  from jsonb_to_recordset(p_threads) as x (
    id text, subject text, participants jsonb, last_message_at timestamptz,
    message_count integer, unread boolean, label_ids text[], has_attachments boolean)
  cross join lateral (
    select
      coalesce(jsonb_agg(jsonb_build_object('name', left(e ->> 'name', 120), 'email', lower(left(e ->> 'email', 254)))), '[]'::jsonb) as participants,
      coalesce(array_agg(distinct lower(left(e ->> 'email', 254))) filter (where e ->> 'email' is not null), '{}') as emails,
      coalesce(string_agg(coalesce(left(e ->> 'name', 120), '') || ' ' || coalesce(left(e ->> 'email', 254), ''), ' '), '') as words
    from (
      select e from jsonb_array_elements(case when jsonb_typeof(x.participants) = 'array' then x.participants else '[]'::jsonb end) e
      limit 50
    ) limited
  ) p
  where x.id ~ '^[0-9a-f]{1,32}$' and x.last_message_at is not null
  on conflict (account_id, gmail_thread_id) do update set
    subject = excluded.subject,
    participants = excluded.participants,
    participant_emails = excluded.participant_emails,
    search_text = excluded.search_text,
    last_message_at = excluded.last_message_at,
    message_count = excluded.message_count,
    unread = excluded.unread,
    starred = excluded.starred,
    label_ids = excluded.label_ids,
    has_attachments = excluded.has_attachments,
    gmail_deleted_at = null,
    synced_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Labels as Gmail reported them after a change made from Dikho (read,
-- archive, star, label), so the list is right before the next sync.
create or replace function public.em_set_thread_labels(p_account uuid, p_gmail_thread_id text, p_label_ids text[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.email_threads
  set label_ids = coalesce(p_label_ids, '{}'),
      unread = 'UNREAD' = any (coalesce(p_label_ids, '{}')),
      starred = 'STARRED' = any (coalesce(p_label_ids, '{}')),
      synced_at = now()
  where account_id = p_account and gmail_thread_id = p_gmail_thread_id
$$;

create or replace function public.em_mark_threads_deleted(p_account uuid, p_gmail_thread_ids text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if cardinality(p_gmail_thread_ids) > 500 then
    raise exception 'Expected at most 500 threads' using errcode = 'PT400';
  end if;
  update public.email_threads
  set gmail_deleted_at = now()
  where account_id = p_account and gmail_thread_id = any (p_gmail_thread_ids) and gmail_deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Reading and working on threads
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.em_thread_json(p_thread public.email_threads)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_thread.id,
    'account_id', p_thread.account_id,
    'gmail_thread_id', p_thread.gmail_thread_id,
    'subject', p_thread.subject,
    'participants', p_thread.participants,
    'last_message_at', p_thread.last_message_at,
    'message_count', p_thread.message_count,
    'unread', p_thread.unread,
    'starred', p_thread.starred,
    'label_ids', to_jsonb(p_thread.label_ids),
    'has_attachments', p_thread.has_attachments,
    'assigned_to', p_thread.assigned_to,
    'assigned_name', (select m.full_name from public.staff_members m where m.user_id = p_thread.assigned_to),
    'workflow_status', p_thread.workflow_status,
    'link_count', (select count(*) from public.email_thread_links l where l.thread_id = p_thread.id),
    'note_count', (select count(*) from public.email_thread_notes n where n.thread_id = p_thread.id)
  )
$$;

-- One page of threads across the mailboxes the actor may read (or one of
-- them). Keyset pagination on (last_message_at, id): stable while new mail
-- arrives. p_params: account, folder, unread, search, before_at, before_id, limit.
create or replace function public.em_list_threads(p_actor uuid, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_accounts uuid[];
  v_account uuid := case when p_params ->> 'account' ~ '^[0-9a-f-]{36}$' then (p_params ->> 'account')::uuid end;
  v_folder text := coalesce(p_params ->> 'folder', 'inbox');
  v_unread boolean := coalesce((p_params ->> 'unread')::boolean, false);
  v_search text := nullif(lower(btrim(left(p_params ->> 'search', 100))), '');
  v_before_at timestamptz := (p_params ->> 'before_at')::timestamptz;
  v_before_id uuid := case when p_params ->> 'before_id' ~ '^[0-9a-f-]{36}$' then (p_params ->> 'before_id')::uuid end;
  v_limit integer := least(greatest(coalesce((p_params ->> 'limit')::integer, 30), 1), 50);
  v_rows jsonb;
  v_count integer;
begin
  perform public.um_actor(p_actor, 'email_inbox.view');
  if v_folder not in ('inbox', 'sent', 'drafts', 'starred', 'archived', 'all', 'assigned') then
    perform public.um_fail(400, 'Unknown folder.');
  end if;

  select coalesce(array_agg(m.account_id), '{}') into v_accounts
  from public.email_account_members m
  join public.email_accounts a on a.id = m.account_id
  where m.user_id = p_actor
    and (a.kind = 'shared' or public.staff_is_active(a.owner_id))
    and (v_account is null or a.id = v_account);
  if v_account is not null and cardinality(v_accounts) = 0 then
    perform public.um_fail(404, 'Mailbox not found.');
  end if;

  if v_search is not null then
    v_search := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with page as (
    select t.*
    from public.email_threads t
    where t.account_id = any (v_accounts)
      and t.gmail_deleted_at is null
      and not ('TRASH' = any (t.label_ids) or 'SPAM' = any (t.label_ids))
      and case v_folder
        when 'inbox' then 'INBOX' = any (t.label_ids)
        when 'sent' then 'SENT' = any (t.label_ids)
        when 'drafts' then 'DRAFT' = any (t.label_ids)
        when 'starred' then t.starred
        when 'archived' then not ('INBOX' = any (t.label_ids)) and not ('DRAFT' = any (t.label_ids))
        when 'assigned' then t.assigned_to = p_actor
        else true end
      and (not v_unread or t.unread)
      and (v_search is null or t.search_text like v_search)
      and (v_before_at is null or (t.last_message_at, t.id) < (v_before_at, coalesce(v_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by t.last_message_at desc, t.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(public.em_thread_json(page) || jsonb_build_object(
           'account_email', a.email_address, 'account_name', a.display_name)
         order by page.last_message_at desc, page.id desc), '[]'::jsonb),
         count(*)
  into v_rows, v_count
  from page
  join public.email_accounts a on a.id = page.account_id;

  return jsonb_build_object(
    'threads', case when v_count > v_limit then v_rows - v_limit else v_rows end,
    'has_more', v_count > v_limit
  );
end
$$;

-- Cached threads of one mailbox by Gmail id, in the order given (results of
-- a search run in Gmail itself). Needs viewer access to that mailbox.
create or replace function public.em_get_threads(p_actor uuid, p_account uuid, p_gmail_thread_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
begin
  v_access := public.em_access(p_actor, p_account, 'viewer');
  if cardinality(p_gmail_thread_ids) > 100 then
    perform public.um_fail(400, 'Too many conversations.');
  end if;
  return coalesce((
    select jsonb_agg(public.em_thread_json(t) || jsonb_build_object(
             'account_email', v_access ->> 'email_address', 'account_name', v_access ->> 'display_name')
           order by array_position(p_gmail_thread_ids, t.gmail_thread_id))
    from public.email_threads t
    where t.account_id = p_account and t.gmail_thread_id = any (p_gmail_thread_ids) and t.gmail_deleted_at is null
  ), '[]'::jsonb);
end
$$;

-- Everything Dikho knows about one thread, for the actor at a minimum role:
-- the thread, the mailbox (with the encrypted token, for the Worker only),
-- notes, links, and the members it can be assigned to.
create or replace function public.em_open_thread(p_actor uuid, p_thread uuid, p_min_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_thread public.email_threads;
  v_access jsonb;
begin
  select * into v_thread from public.email_threads where id = p_thread and gmail_deleted_at is null;
  if v_thread.id is null then
    perform public.um_actor(p_actor, 'email_inbox.view');
    perform public.um_fail(404, 'Conversation not found.');
  end if;
  v_access := public.em_access(p_actor, v_thread.account_id, p_min_role);
  return jsonb_build_object(
    'thread', public.em_thread_json(v_thread),
    'account', v_access,
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'author_id', n.author_id, 'author_name', s.full_name,
               'body', n.body, 'created_at', n.created_at) order by n.created_at)
      from public.email_thread_notes n join public.staff_members s on s.user_id = n.author_id
      where n.thread_id = p_thread
    ), '[]'::jsonb),
    'assignable', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'full_name', s.full_name) order by s.full_name)
      from public.email_account_members m join public.staff_members s on s.user_id = m.user_id
      where m.account_id = v_thread.account_id and public.em_role_rank(m.role) >= 2
        and public.em_mailbox_role(m.user_id, v_thread.account_id) is not null
    ), '[]'::jsonb)
  );
end
$$;

-- Dikho workflow on a thread: status (responder), assignee (manager for
-- anyone; a responder may take a thread or hand back their own).
create or replace function public.em_update_thread(p_actor uuid, p_thread uuid, p_patch jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_thread public.email_threads;
  v_role text;
  v_assignee uuid;
begin
  select * into v_thread from public.email_threads where id = p_thread and gmail_deleted_at is null for update;
  if v_thread.id is null then
    perform public.um_actor(p_actor, 'email_inbox.view');
    perform public.um_fail(404, 'Conversation not found.');
  end if;
  v_role := (public.em_access(p_actor, v_thread.account_id, 'responder')) ->> 'role';

  if p_patch ? 'workflow_status' then
    if coalesce(p_patch ->> 'workflow_status', '') not in ('open', 'pending', 'closed') then
      perform public.um_fail(400, 'Unknown status.');
    end if;
    v_thread.workflow_status := p_patch ->> 'workflow_status';
  end if;

  if p_patch ? 'assigned_to' then
    v_assignee := case when p_patch ->> 'assigned_to' ~ '^[0-9a-f-]{36}$' then (p_patch ->> 'assigned_to')::uuid end;
    if p_patch ->> 'assigned_to' is not null and v_assignee is null then
      perform public.um_fail(400, 'Invalid assignee.');
    end if;
    -- Below manager: only threads nobody holds or you hold, and only to
    -- yourself or nobody. Written so a NULL can never make it pass.
    if public.em_role_rank(v_role) < public.em_role_rank('manager')
       and not ((v_assignee is null or v_assignee = p_actor)
                and (v_thread.assigned_to is null or v_thread.assigned_to = p_actor)) then
      perform public.um_fail(403, 'Only a mailbox manager can assign conversations to someone else.');
    end if;
    if v_assignee is not null
       and public.em_role_rank(public.em_mailbox_role(v_assignee, v_thread.account_id)) < public.em_role_rank('responder') then
      perform public.um_fail(400, 'That person cannot answer this mailbox''s mail.');
    end if;
    v_thread.assigned_to := v_assignee;
  end if;

  update public.email_threads
  set workflow_status = v_thread.workflow_status, assigned_to = v_thread.assigned_to, workflow_updated_at = now()
  where id = p_thread
  returning * into v_thread;
  return public.em_thread_json(v_thread);
end
$$;

create or replace function public.em_add_note(p_actor uuid, p_thread uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_thread public.email_threads;
  v_note public.email_thread_notes;
begin
  select * into v_thread from public.email_threads where id = p_thread and gmail_deleted_at is null;
  if v_thread.id is null then
    perform public.um_actor(p_actor, 'email_inbox.view');
    perform public.um_fail(404, 'Conversation not found.');
  end if;
  perform public.em_access(p_actor, v_thread.account_id, 'responder');
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    perform public.um_fail(400, 'A note is between 1 and 4000 characters.');
  end if;
  insert into public.email_thread_notes (thread_id, author_id, body)
  values (p_thread, p_actor, btrim(p_body))
  returning * into v_note;
  return jsonb_build_object('id', v_note.id, 'author_id', p_actor,
    'author_name', (select full_name from public.staff_members where user_id = p_actor),
    'body', v_note.body, 'created_at', v_note.created_at);
end
$$;

-- CRM records for a thread: what is linked, and what matches a participant's
-- address. Each kind only if the actor may view that kind of record.
create or replace function public.em_thread_crm(p_actor uuid, p_thread uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_thread public.email_threads;
  v_clients boolean;
  v_vendors boolean;
  v_leads boolean;
begin
  select * into v_thread from public.email_threads where id = p_thread and gmail_deleted_at is null;
  if v_thread.id is null then
    perform public.um_actor(p_actor, 'email_inbox.view');
    perform public.um_fail(404, 'Conversation not found.');
  end if;
  perform public.em_access(p_actor, v_thread.account_id, 'viewer');
  v_clients := public.em_holds(p_actor, 'clients.view');
  v_vendors := public.em_holds(p_actor, 'vendors.view');
  v_leads := public.em_holds(p_actor, 'leads.view');

  return jsonb_build_object(
    'can_view', jsonb_build_object('client', v_clients, 'vendor', v_vendors, 'lead', v_leads),
    'records', coalesce((
      select jsonb_agg(r order by r ->> 'linked' desc, r ->> 'name')
      from (
        select jsonb_build_object('type', 'client', 'id', c.id::text, 'name', coalesce(c.company_name, c.contact_person),
                 'contact', c.contact_person, 'email', c.email, 'place', concat_ws(', ', c.city, c.state),
                 'linked', exists (select 1 from public.email_thread_links l where l.thread_id = p_thread and l.entity_type = 'client' and l.entity_id = c.id::text)) as r
        from public.clients c
        where v_clients and (
          lower(btrim(c.email)) = any (v_thread.participant_emails)
          or exists (select 1 from public.email_thread_links l where l.thread_id = p_thread and l.entity_type = 'client' and l.entity_id = c.id::text))
        union all
        select jsonb_build_object('type', 'vendor', 'id', v.id::text, 'name', coalesce(v.company_name, v.contact_person),
                 'contact', v.contact_person, 'email', v.email, 'place', null,
                 'linked', exists (select 1 from public.email_thread_links l where l.thread_id = p_thread and l.entity_type = 'vendor' and l.entity_id = v.id::text))
        from public.vendors v
        where v_vendors and (
          lower(btrim(v.email)) = any (v_thread.participant_emails)
          or exists (select 1 from public.email_thread_links l where l.thread_id = p_thread and l.entity_type = 'vendor' and l.entity_id = v.id::text))
        union all
        select jsonb_build_object('type', 'lead', 'id', g.id::text, 'name', coalesce(g.company_name, g.name),
                 'contact', g.name, 'email', g.email, 'place', g.city,
                 'linked', exists (select 1 from public.email_thread_links l where l.thread_id = p_thread and l.entity_type = 'lead' and l.entity_id = g.id::text))
        from public.cg_leads g
        where v_leads and (
          lower(btrim(g.email)) = any (v_thread.participant_emails)
          or exists (select 1 from public.email_thread_links l where l.thread_id = p_thread and l.entity_type = 'lead' and l.entity_id = g.id::text))
        limit 20
      ) x
    ), '[]'::jsonb)
  );
end
$$;

-- Recipient suggestions for the composer: people from the actor's own
-- mailboxes, and clients, vendors and leads the actor may view. At most 8.
create or replace function public.em_suggest_recipients(p_actor uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(left(coalesce(p_query, ''), 80)));
  v_like text;
begin
  perform public.um_actor(p_actor, 'email_inbox.view');
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return coalesce((
    select jsonb_agg(x order by x ->> 'rank', x ->> 'email')
    from (
      select distinct on (lower(s.email)) jsonb_build_object('email', lower(s.email), 'name', s.name, 'source', s.source, 'rank', s.rank) as x
      from (
        select p ->> 'email' as email, p ->> 'name' as name, 'recent' as source, '1' as rank
        from public.email_threads t
        join public.email_account_members m on m.account_id = t.account_id and m.user_id = p_actor
        cross join lateral jsonb_array_elements(t.participants) p
        where t.gmail_deleted_at is null and t.last_message_at > now() - interval '180 days'
          and (lower(p ->> 'email') like v_like or lower(coalesce(p ->> 'name', '')) like v_like)
        union all
        select c.email, coalesce(c.contact_person, c.company_name), 'client', '2'
        from public.clients c
        where public.em_holds(p_actor, 'clients.view') and c.email is not null
          and (lower(c.email) like v_like or lower(coalesce(c.company_name, '')) like v_like or lower(coalesce(c.contact_person, '')) like v_like)
        union all
        select v.email, coalesce(v.contact_person, v.company_name), 'vendor', '3'
        from public.vendors v
        where public.em_holds(p_actor, 'vendors.view') and v.email is not null
          and (lower(v.email) like v_like or lower(coalesce(v.company_name, '')) like v_like or lower(coalesce(v.contact_person, '')) like v_like)
        union all
        select g.email, g.name, 'lead', '4'
        from public.cg_leads g
        where public.em_holds(p_actor, 'leads.view') and g.email is not null
          and (lower(g.email) like v_like or lower(coalesce(g.name, '')) like v_like or lower(coalesce(g.company_name, '')) like v_like)
      ) s
      where s.email ~ '^[^[:space:]@]{1,64}@[^[:space:]@]{1,189}\.[^[:space:]@]{2,63}$'
      order by lower(s.email), s.rank
      limit 200
    ) y
    limit 8
  ), '[]'::jsonb);
end
$$;

create or replace function public.em_link(p_actor uuid, p_thread uuid, p_type text, p_entity text, p_linked boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_thread public.email_threads;
  v_exists boolean;
begin
  select * into v_thread from public.email_threads where id = p_thread and gmail_deleted_at is null;
  if v_thread.id is null then
    perform public.um_actor(p_actor, 'email_inbox.view');
    perform public.um_fail(404, 'Conversation not found.');
  end if;
  perform public.em_access(p_actor, v_thread.account_id, 'responder');
  if p_type not in ('client', 'vendor', 'lead') or p_entity is null or p_entity !~ '^[0-9a-f-]{1,36}$' then
    perform public.um_fail(400, 'Unknown record.');
  end if;
  if not public.em_holds(p_actor, case p_type when 'client' then 'clients.view' when 'vendor' then 'vendors.view' else 'leads.view' end) then
    perform public.um_fail(403, 'You do not have permission to see that kind of record.');
  end if;

  if p_linked then
    v_exists := case p_type
      when 'client' then p_entity ~ '^[0-9]{1,18}$' and exists (select 1 from public.clients where id = p_entity::bigint)
      when 'vendor' then p_entity ~ '^[0-9]{1,18}$' and exists (select 1 from public.vendors where id = p_entity::bigint)
      else p_entity ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.cg_leads where id = p_entity::uuid) end;
    if not v_exists then
      perform public.um_fail(404, 'That record no longer exists.');
    end if;
    insert into public.email_thread_links (thread_id, entity_type, entity_id, linked_by)
    values (p_thread, p_type, p_entity, p_actor)
    on conflict do nothing;
  else
    delete from public.email_thread_links where thread_id = p_thread and entity_type = p_type and entity_id = p_entity;
  end if;
  return public.em_thread_crm(p_actor, p_thread);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Sends from the composer. The browser generates the id once per message,
--    so a retried or doubled request finds the first attempt instead of
--    sending again.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.em_begin_send(p_actor uuid, p_account uuid, p_send_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
  v_existing public.email_mailbox_sends;
begin
  v_access := public.em_access(p_actor, p_account, 'responder');
  if (v_access ->> 'status') <> 'connected' then
    perform public.um_fail(409, 'This mailbox needs to be reconnected before it can send.');
  end if;
  delete from public.email_mailbox_sends where created_at < now() - interval '30 days';

  insert into public.email_mailbox_sends (id, account_id, user_id)
  values (p_send_id, p_account, p_actor)
  on conflict (id) do nothing;
  if not found then
    select * into v_existing from public.email_mailbox_sends where id = p_send_id;
    if v_existing.account_id <> p_account or v_existing.user_id <> p_actor then
      perform public.um_fail(409, 'Send this message again from the composer.');
    end if;
    return jsonb_build_object('duplicate', true, 'status', v_existing.status,
      'gmail_message_id', v_existing.gmail_message_id, 'gmail_thread_id', v_existing.gmail_thread_id);
  end if;
  return jsonb_build_object('duplicate', false, 'account', v_access);
end
$$;

create or replace function public.em_finish_send(p_send_id uuid, p_status text, p_message_id text, p_thread_id text, p_error text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'uncertain') then
    raise exception 'Unknown send status %', p_status using errcode = 'PT400';
  end if;
  update public.email_mailbox_sends
  set status = p_status,
      gmail_message_id = case when p_message_id ~ '^[0-9a-f]{1,32}$' then p_message_id end,
      gmail_thread_id = case when p_thread_id ~ '^[0-9a-f]{1,32}$' then p_thread_id end,
      error = left(p_error, 300),
      updated_at = now()
  where id = p_send_id and status = 'sending';
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Grants: the Worker (service role) only.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and left(p.proname, 3) = 'em_'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end
$$;

notify pgrst, 'reload schema';
