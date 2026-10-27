-- ============================================================================
-- EMAIL HUB, part 3: mailbox providers. Decision record:
-- docs/decisions/0010-email-hub-providers.md.
--
-- WHAT CHANGES
--   - email_accounts.provider may now be 'hostinger' as well as 'google'.
--     A mailbox's provider is chosen when it is created and never changes,
--     so one mailbox never mixes two providers' thread ids.
--   - email_accounts.provider_account_id: the Hostinger mailbox resource id.
--     The Worker learns it from Hostinger's GET /api/v1/me with its own API
--     token (a Worker secret), never from the browser. No Hostinger credential
--     is stored in this database.
--   - em_account_json reports the provider; em_access and em_claim_sync also
--     return the resource id, for the Worker only.
--   - em_create_shared takes the provider (default 'google', so the Worker
--     already deployed keeps working unchanged).
--   - Google connection functions refuse a Hostinger mailbox.
--   - em_connect_hostinger connects a Hostinger mailbox:
--       shared: by its administrators or holders of email_mailboxes.manage,
--         exactly as for Google shared mailboxes;
--       personal: only the person whose own sign-in address it is. Hostinger
--         has no per-person sign-in, so the sign-in address Supabase verified
--         is the proof of ownership; nobody can claim a colleague's mailbox.
--     The mailbox must be among those the Worker's token may manage.
--
-- WHO MAY DO WHAT: unchanged. Reading a mailbox still needs the
-- email_inbox.view permission AND a membership row, whatever the provider.
--
-- ORDER: after 20261021120000_email_hub_mailboxes.sql. Compatible with the
-- API Worker already deployed (it ignores the new fields and calls
-- em_create_shared without a provider). If applied with the Supabase MCP
-- `apply_migration` tool, rename this file to the version it records
-- (supabase/AGENTS.md).
--
-- ROLLBACK: forward only. To withdraw Hostinger support, disconnect or remove
-- every Hostinger mailbox in the dashboard first; the column and the widened
-- check can stay unused.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Columns
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  c record;
begin
  -- The provider check created inline in part 1 (its name is generated).
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.email_accounts'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%provider%'
      and pg_get_constraintdef(con.oid) not ilike '%provider_account_id%'
  loop
    execute format('alter table public.email_accounts drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.email_accounts
  add constraint email_accounts_provider_check check (provider in ('google', 'hostinger'));

alter table public.email_accounts
  add column if not exists provider_account_id text
    check (provider_account_id ~ '^[A-Za-z0-9_-]{1,64}$');
create unique index if not exists email_accounts_provider_account_key
  on public.email_accounts (provider, provider_account_id) where provider_account_id is not null;

comment on column public.email_accounts.provider is
  'Mail provider of this mailbox (google | hostinger). Set at creation; never inferred from the address.';
comment on column public.email_accounts.provider_account_id is
  'Hostinger mailbox resource id, from the Worker''s own GET /api/v1/me. Null for Google.';
comment on column public.email_threads.gmail_thread_id is
  'Provider thread key within the mailbox: Gmail''s thread id for Google mailboxes; for Hostinger mailboxes a key Dikho derives from the messages'' Message-ID headers.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. What the Worker and the dashboard see of a mailbox
-- ─────────────────────────────────────────────────────────────────────────
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
    'provider', p_account.provider,
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

-- As in part 1, plus the provider resource id (for the Worker only; the
-- routes strip it with the token before anything reaches the browser).
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
    'provider_account_id', v_account.provider_account_id,
    'token_enc', (select c.refresh_token_enc from public.email_oauth_credentials c where c.account_id = v_account.id)
  );
end
$$;

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
    'provider', v_account.provider,
    'provider_account_id', v_account.provider_account_id,
    'email_address', v_account.email_address,
    'history_id', v_account.history_id::text,
    'needs_full_sync', v_account.needs_full_sync,
    'watch_expires_at', v_account.watch_expires_at,
    'token_enc', (select c.refresh_token_enc from public.email_oauth_credentials c where c.account_id = v_account.id)
  );
end
$$;

-- Mailboxes worth syncing now (as in part 1), Google only: Dikho does not
-- sync Hostinger mailboxes yet, and a never-synced Hostinger mailbox would
-- otherwise always come first and starve the Google ones.
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
      and a.provider = 'google'
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Shared mailboxes are created for one provider
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.em_create_shared(uuid, text, text, jsonb);
create or replace function public.em_create_shared(
  p_actor uuid, p_email text, p_display_name text, p_ctx jsonb, p_provider text default 'google'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_provider text := coalesce(p_provider, 'google');
  v_account public.email_accounts;
begin
  perform public.um_actor(p_actor, 'email_mailboxes.manage');
  if v_provider not in ('google', 'hostinger') then
    perform public.um_fail(400, 'Choose Google Workspace or Hostinger.');
  end if;
  if v_email !~ '^[^[:space:]@]{1,64}@[^[:space:]@]{1,189}\.[^[:space:]@]{2,63}$' or char_length(v_email) > 254 then
    perform public.um_fail(400, 'Enter a valid email address.');
  end if;
  if exists (select 1 from public.email_accounts where email_address = v_email) then
    perform public.um_fail(409, 'This address is already set up in Dikho.');
  end if;
  -- A colleague's own address is their personal mailbox, connected by them;
  -- registering it as "shared" would let a manager route its access elsewhere.
  if exists (select 1 from auth.users u join public.staff_members s on s.user_id = u.id where lower(u.email) = v_email) then
    perform public.um_fail(400, 'This is a staff member''s own sign-in address. They connect it themselves as their personal mailbox.');
  end if;
  insert into public.email_accounts (kind, provider, email_address, display_name, created_by)
  values ('shared', v_provider, v_email, nullif(btrim(left(p_display_name, 120)), ''), p_actor)
  returning * into v_account;
  perform public.um_audit(p_actor, null, 'email_mailbox.created', null,
    jsonb_build_object('email_address', v_email, 'kind', 'shared', 'provider', v_provider), p_ctx,
    jsonb_build_object('account_id', v_account.id));
  return public.em_account_json(v_account);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Google connection refuses Hostinger mailboxes (bodies as in part 1,
--    plus the provider checks).
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
    if v_account.provider <> 'google' then
      perform public.um_fail(409, 'This mailbox is hosted at Hostinger. Connect it with Hostinger, not Google.');
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
      -- Another staff member's sign-in address is theirs to connect.
      if exists (select 1 from auth.users u join public.staff_members s on s.user_id = u.id
                 where lower(u.email) = v_email and u.id <> p_actor) then
        perform public.um_fail(403, 'This is another staff member''s mailbox. Only they can connect it.');
      end if;
      insert into public.email_accounts (kind, provider, email_address, display_name, owner_id, created_by)
      values ('personal', 'google', v_email, nullif(btrim(left(p_display_name, 120)), ''), p_actor, p_actor)
      returning * into v_account;
      v_new := true;
    elsif v_account.kind <> 'personal' or v_account.owner_id <> p_actor then
      perform public.um_fail(409, 'This mailbox is already connected to Dikho by someone else, or is set up as a shared mailbox.');
    elsif v_account.provider <> 'google' then
      perform public.um_fail(409, 'This mailbox is connected through Hostinger. Remove it first to connect it with Google instead.');
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
    if v_account.provider <> 'google' then
      perform public.um_fail(409, 'This mailbox is hosted at Hostinger. Connect it with Hostinger, not Google.');
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

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Connecting a Hostinger mailbox
--    p_mailboxes: what the Worker's token may manage, straight from
--    Hostinger's GET /api/v1/me: [{ "resourceId": "...", "address": "..." }].
--    p_account null: the actor's personal mailbox (their own sign-in
--    address). Otherwise: that shared Hostinger mailbox.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.em_connect_hostinger(
  p_actor uuid, p_account uuid, p_mailboxes jsonb, p_display_name text, p_ctx jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_resource text;
  v_account public.email_accounts;
  v_new boolean := false;
begin
  if jsonb_typeof(p_mailboxes) <> 'array' or jsonb_array_length(p_mailboxes) > 500 then
    raise exception 'Expected at most 500 mailboxes' using errcode = 'PT400';
  end if;

  if p_account is null then
    perform public.um_actor(p_actor, 'email_inbox.view');
    select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_actor;
    if v_email is null or v_email = '' then
      perform public.um_fail(400, 'Your Dikho account has no email address to match a Hostinger mailbox.');
    end if;
    select * into v_account from public.email_accounts where email_address = v_email for update;
    if v_account.id is not null and (v_account.kind <> 'personal' or v_account.owner_id <> p_actor) then
      perform public.um_fail(409, 'This mailbox is already connected to Dikho by someone else, or is set up as a shared mailbox.');
    end if;
    if v_account.id is not null and v_account.provider <> 'hostinger' then
      perform public.um_fail(409, 'Your mailbox is connected through Google. Remove it first to connect it through Hostinger instead.');
    end if;
  else
    perform public.um_actor(p_actor, null);
    select * into v_account from public.email_accounts where id = p_account for update;
    if v_account.id is null or v_account.kind <> 'shared' then
      perform public.um_fail(404, 'Mailbox not found.');
    end if;
    if not public.em_can_configure(p_actor, v_account) then
      perform public.um_fail(403, 'Only this mailbox''s administrators can connect it.');
    end if;
    if v_account.provider <> 'hostinger' then
      perform public.um_fail(409, 'This mailbox is a Google Workspace mailbox. Connect it with Google.');
    end if;
    v_email := v_account.email_address;
  end if;

  select x ->> 'resourceId' into v_resource
  from jsonb_array_elements(p_mailboxes) x
  where lower(btrim(x ->> 'address')) = v_email
    and (x ->> 'resourceId') ~ '^[A-Za-z0-9_-]{1,64}$'
  limit 1;
  if v_resource is null then
    perform public.um_fail(409, 'Dikho''s Hostinger API token does not cover this mailbox. An administrator needs to create a token that includes it.');
  end if;
  if exists (select 1 from public.email_accounts
             where provider = 'hostinger' and provider_account_id = v_resource
               and id is distinct from v_account.id) then
    perform public.um_fail(409, 'This Hostinger mailbox is already connected to Dikho under another entry.');
  end if;

  if v_account.id is null then
    insert into public.email_accounts (kind, provider, email_address, display_name, owner_id, created_by)
    values ('personal', 'hostinger', v_email, nullif(btrim(left(p_display_name, 120)), ''), p_actor, p_actor)
    returning * into v_account;
    v_new := true;
    insert into public.email_account_members (account_id, user_id, role, granted_by)
    values (v_account.id, p_actor, 'admin', p_actor)
    on conflict (account_id, user_id) do update set role = 'admin';
  end if;

  update public.email_accounts
  set status = 'connected',
      needs_full_sync = needs_full_sync or v_new or provider_account_id is distinct from v_resource,
      provider_account_id = v_resource,
      display_name = coalesce(display_name, nullif(btrim(left(p_display_name, 120)), '')),
      last_sync_error = null,
      sync_lease_until = null,
      updated_at = now()
  where id = v_account.id
  returning * into v_account;

  perform public.um_audit(p_actor, v_account.owner_id, 'email_mailbox.connected', null,
    jsonb_build_object('email_address', v_account.email_address, 'kind', v_account.kind, 'provider', 'hostinger'), p_ctx,
    jsonb_build_object('account_id', v_account.id));
  return public.em_account_json(v_account);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Grants: the Worker (service role) only, as for every em_* function.
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
