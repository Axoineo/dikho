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
--   - email_provider_messages: a metadata-only index of Hostinger messages
--     (headers and flags, never bodies) from which conversations are
--     derived and projected onto email_threads (section 6).
--   - Campaigns may be sent through a connected mailbox instead of Amazon
--     SES: per-mailbox opt-in and daily limit, sender re-checked at every
--     dispatch, approvals cover the sender (section 7).
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
-- ORDER: after 20261021130000_email_hub_campaigns.sql. Compatible with the
-- API Worker already deployed: it ignores the new fields, and the functions
-- whose parameters grew (em_create_shared, em_claim_campaign_batch,
-- em_finish_campaign_batch) default the new ones to the old behaviour.
-- Campaigns without a sender mailbox hash exactly as before. If applied with the Supabase MCP
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
-- 6. Hostinger message index (metadata only)
--    Hostinger has folders and IMAP UIDs, not Gmail threads. Dikho keeps one
--    row per message in the synced folders (inbox, sent, archive): headers
--    and flags, never a body. Threads are derived from Message-ID and
--    In-Reply-To and projected onto email_threads with Gmail-style system
--    labels (INBOX, SENT, UNREAD, STARRED), so listing, search, unread
--    counts, notes, links and assignment work unchanged.
--    Limits, by design: a reply whose parent is older than the synced window
--    starts its own conversation; two existing conversations are never
--    merged after the fact; subjects alone never join conversations.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.email_provider_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts (id) on delete cascade,
  folder text not null check (char_length(folder) between 1 and 200),
  folder_role text not null check (folder_role in ('inbox', 'sent', 'archive')),
  uid bigint not null check (uid between 1 and 4294967295),
  thread_key text not null check (thread_key ~ '^[0-9a-f]{32}$'),
  rfc_message_id text check (char_length(rfc_message_id) <= 998),
  in_reply_to text check (char_length(in_reply_to) <= 998),
  sent_at timestamptz not null,
  subject text check (char_length(subject) <= 998),
  sender jsonb check (sender is null or jsonb_typeof(sender) = 'object'),
  recipients jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients) = 'array'),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  unseen boolean not null default false,
  flagged boolean not null default false,
  has_attachments boolean not null default false,
  synced_at timestamptz not null default now(),
  unique (account_id, folder, uid)
);
create index if not exists email_provider_messages_thread_idx
  on public.email_provider_messages (account_id, thread_key, sent_at desc);
create index if not exists email_provider_messages_message_id_idx
  on public.email_provider_messages (account_id, rfc_message_id) where rfc_message_id is not null;
create index if not exists email_provider_messages_reply_idx
  on public.email_provider_messages (account_id, in_reply_to) where in_reply_to is not null;

alter table public.email_provider_messages enable row level security;
revoke all on public.email_provider_messages from anon, authenticated;
drop policy if exists "staff members only" on public.email_provider_messages;
create policy "staff members only" on public.email_provider_messages as restrictive for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Rebuilds the thread rows of the given keys from the message index. A key
-- left without messages is hidden (its notes and links are kept).
create or replace function public.em_hostinger_refresh_threads(p_account uuid, p_keys text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with msgs as (
    select * from public.email_provider_messages
    where account_id = p_account and thread_key = any (p_keys)
  ), people as (
    select x.thread_key, lower(x.e ->> 'email') as email, max(left(x.e ->> 'name', 120)) as name, min(x.at) as first_at
    from (
      select m.thread_key, m.sender as e, m.sent_at as at from msgs m where m.sender is not null
      union all
      select m.thread_key, r, m.sent_at from msgs m cross join lateral jsonb_array_elements(m.recipients) r
    ) x
    where x.e ->> 'email' ~ '^[^[:space:]@]{1,64}@[^[:space:]@]{1,189}$'
    group by x.thread_key, lower(x.e ->> 'email')
  ), ranked as (
    select p.*, row_number() over (partition by p.thread_key order by p.first_at, p.email) as n from people p
  ), ppl as (
    select r.thread_key,
      jsonb_agg(jsonb_build_object('name', r.name, 'email', r.email) order by r.n) as participants,
      array_agg(r.email order by r.n) as emails,
      string_agg(coalesce(r.name, '') || ' ' || r.email, ' ') as words
    from ranked r where r.n <= 50 group by r.thread_key
  ), agg as (
    select m.thread_key,
      (array_agg(m.subject order by m.sent_at, m.uid))[1] as subject,
      max(m.sent_at) as last_at,
      count(*)::integer as n,
      bool_or(m.unseen and m.folder_role <> 'sent') as unread,
      bool_or(m.flagged) as starred,
      bool_or(m.has_attachments) as attach,
      array_remove(array[
        case when bool_or(m.folder_role = 'inbox') then 'INBOX' end,
        case when bool_or(m.folder_role = 'sent') then 'SENT' end,
        case when bool_or(m.unseen and m.folder_role <> 'sent') then 'UNREAD' end,
        case when bool_or(m.flagged) then 'STARRED' end
      ], null) as labels
    from msgs m group by m.thread_key
  )
  insert into public.email_threads as t (
    account_id, gmail_thread_id, subject, participants, participant_emails, search_text,
    last_message_at, message_count, unread, starred, label_ids, has_attachments, gmail_deleted_at, synced_at)
  select p_account, a.thread_key, left(a.subject, 998), coalesce(p.participants, '[]'::jsonb), coalesce(p.emails, '{}'),
    left(lower(coalesce(a.subject, '') || ' ' || coalesce(p.words, '')), 2000),
    a.last_at, a.n, a.unread, a.starred, a.labels, a.attach, null, now()
  from agg a left join ppl p on p.thread_key = a.thread_key
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

  update public.email_threads t
  set gmail_deleted_at = now()
  where t.account_id = p_account and t.gmail_thread_id = any (p_keys) and t.gmail_deleted_at is null
    and not exists (select 1 from public.email_provider_messages m
                    where m.account_id = p_account and m.thread_key = t.gmail_thread_id);
  return v_count;
end
$$;

-- One sync pass for a Hostinger mailbox. p_folders, from the Worker:
--   [{ folder, role: inbox|sent|archive, min_uid, messages: [{
--       uid, sent_at, subject, message_id, in_reply_to, unseen, flagged,
--       sender: {name,email}, recipients: [{name,email,kind}],
--       attachments: [{id,filename,content_type,size,inline}] }] }]
-- Each folder entry is Hostinger's newest messages by UID. Messages Dikho
-- holds in that folder at or above min_uid that are no longer listed were
-- moved or deleted, and are dropped; min_uid null with no messages means the
-- folder is empty. New messages join the conversation of the message they
-- answer (or of a copy of themselves in another folder, or of a reply that
-- arrived first), oldest first, otherwise they start one.
create or replace function public.em_hostinger_sync(p_account uuid, p_folders jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.email_accounts;
  f jsonb;
  m record;
  v_keys text[] := '{}';
  v_gone text[];
  v_key text;
  v_existing public.email_provider_messages;
  v_added integer := 0;
begin
  select * into v_account from public.email_accounts where id = p_account;
  if v_account.id is null or v_account.provider <> 'hostinger' then
    raise exception 'Not a Hostinger mailbox' using errcode = 'PT400';
  end if;
  if jsonb_typeof(p_folders) <> 'array' or jsonb_array_length(p_folders) > 5
     or (select coalesce(sum(jsonb_array_length(coalesce(x -> 'messages', '[]'::jsonb))), 0) from jsonb_array_elements(p_folders) x) > 1000 then
    raise exception 'Expected at most 5 folders and 1000 messages' using errcode = 'PT400';
  end if;

  -- 1. What left each listed range.
  for f in select x from jsonb_array_elements(p_folders) x loop
    if char_length(coalesce(f ->> 'folder', '')) not between 1 and 200
       or f ->> 'role' not in ('inbox', 'sent', 'archive')
       or jsonb_typeof(coalesce(f -> 'messages', '[]'::jsonb)) <> 'array' then
      raise exception 'Invalid folder' using errcode = 'PT400';
    end if;
    with gone as (
      delete from public.email_provider_messages pm
      where pm.account_id = p_account and pm.folder = f ->> 'folder'
        and ((f ->> 'min_uid') is null or pm.uid >= (f ->> 'min_uid')::bigint)
        and not exists (select 1 from jsonb_array_elements(coalesce(f -> 'messages', '[]'::jsonb)) x
                        where (x ->> 'uid')::bigint = pm.uid)
      returning pm.thread_key
    )
    select coalesce(array_agg(distinct thread_key), '{}') into v_gone from gone;
    v_keys := v_keys || v_gone;
  end loop;

  -- 2. New and changed messages, oldest first across folders.
  for m in
    select f2 ->> 'folder' as folder, f2 ->> 'role' as role,
           (x ->> 'uid')::bigint as uid, (x ->> 'sent_at')::timestamptz as sent_at,
           nullif(left(x ->> 'message_id', 998), '') as message_id,
           nullif(left(x ->> 'in_reply_to', 998), '') as in_reply_to,
           left(x ->> 'subject', 998) as subject,
           coalesce((x ->> 'unseen')::boolean, false) as unseen,
           coalesce((x ->> 'flagged')::boolean, false) as flagged,
           case when jsonb_typeof(x -> 'sender') = 'object'
                then jsonb_build_object('name', left(x -> 'sender' ->> 'name', 120), 'email', lower(left(x -> 'sender' ->> 'email', 254))) end as sender,
           coalesce((select jsonb_agg(jsonb_build_object('name', left(r ->> 'name', 120), 'email', lower(left(r ->> 'email', 254)),
                                       'kind', case when r ->> 'kind' in ('to', 'cc', 'bcc') then r ->> 'kind' else 'to' end))
                     from (select r from jsonb_array_elements(case when jsonb_typeof(x -> 'recipients') = 'array' then x -> 'recipients' else '[]'::jsonb end) r limit 100) rr), '[]'::jsonb) as recipients,
           coalesce((select jsonb_agg(jsonb_build_object('id', left(a ->> 'id', 200), 'filename', left(a ->> 'filename', 200),
                                       'content_type', left(a ->> 'content_type', 100),
                                       'size', case when (a ->> 'size') ~ '^[0-9]{1,12}$' then (a ->> 'size')::bigint end,
                                       'inline', coalesce((a ->> 'inline')::boolean, false)))
                     from (select a from jsonb_array_elements(case when jsonb_typeof(x -> 'attachments') = 'array' then x -> 'attachments' else '[]'::jsonb end) a limit 20) aa
                     where a ->> 'id' is not null), '[]'::jsonb) as attachments
    from jsonb_array_elements(p_folders) f2
    cross join lateral jsonb_array_elements(coalesce(f2 -> 'messages', '[]'::jsonb)) x
    where (x ->> 'uid') ~ '^[0-9]{1,10}$' and (x ->> 'uid')::bigint between 1 and 4294967295
      and (x ->> 'sent_at') is not null
    order by 4, 3
  loop
    select * into v_existing from public.email_provider_messages
    where account_id = p_account and folder = m.folder and uid = m.uid;
    -- Same UID, same message: only flags change. A different Message-ID
    -- under a known UID means the folder was renumbered: start afresh.
    if v_existing.id is not null and v_existing.rfc_message_id is not distinct from m.message_id then
      update public.email_provider_messages
      set unseen = m.unseen, flagged = m.flagged, synced_at = now()
      where id = v_existing.id and (unseen, flagged) is distinct from (m.unseen, m.flagged);
      if found then v_keys := v_keys || v_existing.thread_key; end if;
      continue;
    elsif v_existing.id is not null then
      delete from public.email_provider_messages where id = v_existing.id;
      v_keys := v_keys || v_existing.thread_key;
    end if;

    v_key := null;
    if m.message_id is not null then
      select pm.thread_key into v_key from public.email_provider_messages pm
      where pm.account_id = p_account and pm.rfc_message_id = m.message_id limit 1;
    end if;
    if v_key is null and m.in_reply_to is not null then
      select pm.thread_key into v_key from public.email_provider_messages pm
      where pm.account_id = p_account and pm.rfc_message_id = m.in_reply_to limit 1;
    end if;
    if v_key is null and m.message_id is not null then
      select pm.thread_key into v_key from public.email_provider_messages pm
      where pm.account_id = p_account and pm.in_reply_to = m.message_id limit 1;
    end if;
    if v_key is null then
      v_key := left(encode(extensions.digest(convert_to(
        coalesce(m.message_id, m.folder || ':' || m.uid::text || ':' || m.sent_at::text), 'UTF8'), 'sha256'), 'hex'), 32);
    end if;

    insert into public.email_provider_messages (
      account_id, folder, folder_role, uid, thread_key, rfc_message_id, in_reply_to, sent_at, subject,
      sender, recipients, attachments, unseen, flagged, has_attachments)
    values (
      p_account, m.folder, m.role, m.uid, v_key, m.message_id, m.in_reply_to, m.sent_at, m.subject,
      m.sender, m.recipients, m.attachments, m.unseen, m.flagged,
      exists (select 1 from jsonb_array_elements(m.attachments) a where not (a ->> 'inline')::boolean));
    v_keys := v_keys || v_key;
    v_added := v_added + 1;
  end loop;

  select coalesce(array_agg(distinct k), '{}') into v_keys from unnest(v_keys) k;
  return jsonb_build_object('added', v_added, 'threads', public.em_hostinger_refresh_threads(p_account, v_keys));
end
$$;

-- Read/unread and flagged, as Hostinger confirmed them after a change made
-- from Dikho, so the list is right before the next sync.
create or replace function public.em_hostinger_set_flags(p_account uuid, p_message_ids uuid[], p_unseen boolean, p_flagged boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_keys text[];
begin
  if cardinality(p_message_ids) > 100 then
    raise exception 'Expected at most 100 messages' using errcode = 'PT400';
  end if;
  with changed as (
    update public.email_provider_messages
    set unseen = coalesce(p_unseen, unseen), flagged = coalesce(p_flagged, flagged), synced_at = now()
    where account_id = p_account and id = any (p_message_ids)
    returning thread_key
  )
  select coalesce(array_agg(distinct thread_key), '{}') into v_keys from changed;
  perform public.em_hostinger_refresh_threads(p_account, v_keys);
end
$$;

-- As in part 1, plus, for a Hostinger mailbox, the indexed messages of the
-- thread (newest 50; folder and UID are for the Worker only).
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
    ), '[]'::jsonb),
    'provider_messages', case when v_access ->> 'provider' = 'hostinger' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pm.id, 'folder', pm.folder, 'folder_role', pm.folder_role, 'uid', pm.uid,
               'message_id', pm.rfc_message_id, 'sent_at', pm.sent_at, 'subject', pm.subject,
               'from', pm.sender, 'recipients', pm.recipients, 'attachments', pm.attachments,
               'unseen', pm.unseen, 'flagged', pm.flagged) order by pm.sent_at, pm.uid)
      from (select * from public.email_provider_messages
            where account_id = v_thread.account_id and thread_key = v_thread.gmail_thread_id
            order by sent_at desc, uid desc limit 50) pm
    ), '[]'::jsonb) end
  );
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Campaigns sent through a connected mailbox
--    Amazon SES is no longer required. A campaign may name a connected
--    mailbox as its sender. That mailbox must have been allowed for
--    campaigns by its administrators, with its own daily limit; the person
--    who submits must be able to send from it (responder or above); and
--    every dispatch re-checks all of that, the organization-wide limit and
--    the mailbox's limit. Nothing rotates between mailboxes: one campaign,
--    one sender. A campaign without a sender mailbox keeps the SES path,
--    which stays off until EMAIL_SES_SEND_ENABLED.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.email_accounts
  add column if not exists campaign_sender boolean not null default false,
  add column if not exists campaign_daily_cap integer check (campaign_daily_cap between 1 and 2000),
  add column if not exists campaign_cooldown_until timestamptz;
alter table public.email_accounts drop constraint if exists email_accounts_campaign_cap_check;
alter table public.email_accounts
  add constraint email_accounts_campaign_cap_check check (not campaign_sender or campaign_daily_cap is not null);

alter table public.email_campaigns
  add column if not exists sender_account_id uuid references public.email_accounts (id) on delete set null;
create index if not exists email_campaigns_sender_idx on public.email_campaigns (sender_account_id) where sender_account_id is not null;

create table if not exists public.email_mailbox_budget (
  account_id uuid not null references public.email_accounts (id) on delete cascade,
  day date not null,
  sent integer not null default 0 check (sent >= 0),
  primary key (account_id, day)
);
alter table public.email_mailbox_budget enable row level security;
revoke all on public.email_mailbox_budget from anon, authenticated;
drop policy if exists "staff members only" on public.email_mailbox_budget;
create policy "staff members only" on public.email_mailbox_budget as restrictive for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Mailbox JSON also says whether it may send campaigns, and its limit.
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
    'campaign_sender', p_account.campaign_sender,
    'campaign_daily_cap', p_account.campaign_daily_cap,
    'created_at', p_account.created_at
  )
$$;

-- Allow or stop a mailbox sending campaigns, with its daily limit. Its
-- configurers only (personal: the owner; shared: its admins or holders of
-- email_mailboxes.manage). Audited.
create or replace function public.em_set_campaign_sender(p_actor uuid, p_account uuid, p_enabled boolean, p_daily_cap integer, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.email_accounts;
begin
  perform public.um_actor(p_actor, null);
  select * into v_account from public.email_accounts where id = p_account for update;
  if v_account.id is null
     or not (public.em_can_configure(p_actor, v_account) or public.em_mailbox_role(p_actor, p_account) is not null) then
    perform public.um_fail(404, 'Mailbox not found.');
  end if;
  if not public.em_can_configure(p_actor, v_account) then
    perform public.um_fail(403, 'Only the mailbox''s owner or its administrators can allow it to send campaigns.');
  end if;
  if coalesce(p_enabled, false) and (p_daily_cap is null or p_daily_cap not between 1 and 2000) then
    perform public.um_fail(400, 'Set a daily campaign limit between 1 and 2000 for this mailbox.');
  end if;
  update public.email_accounts
  set campaign_sender = coalesce(p_enabled, false),
      campaign_daily_cap = case when coalesce(p_enabled, false) then p_daily_cap else campaign_daily_cap end,
      updated_at = now()
  where id = p_account
  returning * into v_account;
  perform public.um_audit(p_actor, v_account.owner_id, 'email_mailbox.campaign_sender', null,
    jsonb_build_object('enabled', v_account.campaign_sender, 'daily_cap', v_account.campaign_daily_cap), p_ctx,
    jsonb_build_object('account_id', p_account));
  return public.em_account_json(v_account);
end
$$;

-- The mailboxes this person may choose as a campaign sender, with today's use.
create or replace function public.em_campaign_senders(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.um_actor(p_actor, null);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'email_address', a.email_address, 'display_name', a.display_name, 'provider', a.provider,
             'daily_cap', a.campaign_daily_cap,
             'sent_today', coalesce((select b.sent from public.email_mailbox_budget b
                                     where b.account_id = a.id and b.day = (now() at time zone 'utc')::date), 0),
             'cooldown_until', case when a.campaign_cooldown_until > now() then a.campaign_cooldown_until end)
           order by a.email_address)
    from public.email_accounts a
    where a.campaign_sender and a.status = 'connected'
      and public.em_role_rank(public.em_mailbox_role(p_actor, a.id)) >= 2
  ), '[]'::jsonb);
end
$$;

-- Null when the mailbox may send this campaign now; otherwise why not.
create or replace function public.em_sender_problem(p_account uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when a.id is null then 'The sending mailbox no longer exists.'
    when a.status <> 'connected' then 'The sending mailbox is not connected.'
    when not a.campaign_sender or a.campaign_daily_cap is null then 'The sending mailbox is not allowed to send campaigns.'
    when public.em_role_rank(public.em_mailbox_role(p_user, a.id)) < 2 then 'The person who submitted it can no longer send from the sending mailbox.'
  end
  from (select 1) one
  left join public.email_accounts a on a.id = p_account
$$;

-- The approval covers the sender mailbox too. Campaigns without one hash
-- exactly as before, so no existing approval is disturbed.
create or replace function public.em_campaign_hash(p_campaign uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to((jsonb_build_object(
    'from_name', c.from_name, 'from_email', c.from_email, 'reply_to', c.reply_to,
    'subject', c.subject, 'preheader', c.preheader, 'html', c.html, 'text_body', c.text_body,
    'audience', c.audience, 'send_at', c.send_at,
    'recipients', (select coalesce(string_agg(r.email, ',' order by r.email), '')
                   from public.email_campaign_recipients r where r.campaign_id = c.id)
  ) || case when c.sender_account_id is null then '{}'::jsonb
            else jsonb_build_object('sender_account_id', c.sender_account_id) end)::text, 'UTF8'), 'sha256'), 'hex')
  from public.email_campaigns c where c.id = p_campaign
$$;

create or replace function public.em_campaign_json(p_campaign public.email_campaigns, p_full boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_campaign.id, 'name', p_campaign.name, 'status', p_campaign.status,
    'from_name', p_campaign.from_name, 'from_email', p_campaign.from_email, 'reply_to', p_campaign.reply_to,
    'sender_account_id', p_campaign.sender_account_id,
    'sender_provider', (select a.provider from public.email_accounts a where a.id = p_campaign.sender_account_id),
    'subject', p_campaign.subject, 'preheader', p_campaign.preheader, 'template_id', p_campaign.template_id,
    'audience', p_campaign.audience, 'send_at', p_campaign.send_at, 'recipient_count', p_campaign.recipient_count,
    'snapshot_hash', p_campaign.snapshot_hash, 'approved_hash', p_campaign.approved_hash,
    'created_by', p_campaign.created_by,
    'created_by_name', (select m.full_name from public.staff_members m where m.user_id = p_campaign.created_by),
    'created_at', p_campaign.created_at, 'updated_at', p_campaign.updated_at, 'updated_by', p_campaign.updated_by,
    'submitted_by_name', (select m.full_name from public.staff_members m where m.user_id = p_campaign.submitted_by),
    'submitted_by', p_campaign.submitted_by, 'submitted_at', p_campaign.submitted_at,
    'approved_by_name', (select m.full_name from public.staff_members m where m.user_id = p_campaign.approved_by),
    'approved_at', p_campaign.approved_at, 'decision_note', p_campaign.decision_note,
    'started_at', p_campaign.started_at, 'finished_at', p_campaign.finished_at,
    'stats', (select jsonb_object_agg(r.status, r.n) from (
       select status, count(*) n from public.email_campaign_recipients where campaign_id = p_campaign.id group by status) r)
  ) || case when p_full then jsonb_build_object('html', p_campaign.html, 'text_body', p_campaign.text_body) else '{}'::jsonb end
$$;

-- As in part 2, plus p_fields.sender_account_id: a mailbox the actor may
-- choose (em_campaign_senders), or null for the SES path. With a mailbox,
-- the From address is always that mailbox's own address.
create or replace function public.em_save_campaign(p_actor uuid, p_campaign uuid, p_fields jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign public.email_campaigns;
  v_was text;
  v_sender public.email_accounts;
  v_set_sender boolean := p_fields ? 'sender_account_id';
begin
  perform public.um_actor(p_actor, 'email_campaigns.create');
  if p_fields ? 'reply_to' and nullif(btrim(p_fields ->> 'reply_to'), '') is not null
     and not public.em_valid_email(lower(btrim(p_fields ->> 'reply_to'))) then
    perform public.um_fail(400, 'Reply-to must be a valid email address.');
  end if;
  if v_set_sender and p_fields ->> 'sender_account_id' is not null then
    if p_fields ->> 'sender_account_id' !~ '^[0-9a-f-]{36}$' then
      perform public.um_fail(400, 'Choose a sending mailbox.');
    end if;
    select * into v_sender from public.email_accounts where id = (p_fields ->> 'sender_account_id')::uuid;
    if v_sender.id is null or not v_sender.campaign_sender or v_sender.status <> 'connected'
       or public.em_role_rank(public.em_mailbox_role(p_actor, v_sender.id)) < 2 then
      perform public.um_fail(403, 'You cannot send campaigns from that mailbox. Choose one of the mailboxes offered.');
    end if;
  end if;

  if p_campaign is null then
    begin
      insert into public.email_campaigns (name, from_name, from_email, reply_to, subject, preheader, html, text_body, template_id, audience, send_at,
                                          sender_account_id, created_by, updated_by)
      values (btrim(coalesce(p_fields ->> 'name', '')), coalesce(p_fields ->> 'from_name', ''),
              coalesce(v_sender.email_address, lower(coalesce(p_fields ->> 'from_email', ''))),
              nullif(lower(btrim(p_fields ->> 'reply_to')), ''), coalesce(p_fields ->> 'subject', ''), coalesce(p_fields ->> 'preheader', ''),
              coalesce(p_fields ->> 'html', ''), coalesce(p_fields ->> 'text_body', ''),
              case when p_fields ->> 'template_id' ~ '^[0-9a-f-]{36}$' then (p_fields ->> 'template_id')::uuid end,
              coalesce(case when jsonb_typeof(p_fields -> 'audience') = 'object' then p_fields -> 'audience' end, '{}'::jsonb),
              (p_fields ->> 'send_at')::timestamptz, v_sender.id, p_actor, p_actor)
      returning * into v_campaign;
    exception when check_violation then
      perform public.um_fail(400, 'Give the campaign a name. Check field lengths.');
    end;
    perform public.um_audit(p_actor, null, 'email_campaign.created', null, jsonb_build_object('name', v_campaign.name), p_ctx,
      jsonb_build_object('campaign_id', v_campaign.id));
    return public.em_campaign_json(v_campaign, true);
  end if;

  v_campaign := public.em_campaign_access(p_actor, p_campaign, true);
  if v_campaign.status in ('sending', 'sent', 'cancelled') or v_campaign.started_at is not null then
    perform public.um_fail(409, 'This campaign has started or ended and can no longer be changed. Duplicate it instead.');
  end if;
  v_was := v_campaign.status;

  begin
    update public.email_campaigns
    set name = coalesce(nullif(btrim(p_fields ->> 'name'), ''), name),
        from_name = coalesce(p_fields ->> 'from_name', from_name),
        sender_account_id = case when v_set_sender then v_sender.id else sender_account_id end,
        from_email = case
          when v_set_sender and v_sender.id is not null then v_sender.email_address
          when v_set_sender then coalesce(lower(p_fields ->> 'from_email'), '')
          when sender_account_id is not null then from_email
          else coalesce(lower(p_fields ->> 'from_email'), from_email) end,
        reply_to = case when p_fields ? 'reply_to' then nullif(lower(btrim(p_fields ->> 'reply_to')), '') else reply_to end,
        subject = coalesce(p_fields ->> 'subject', subject),
        preheader = coalesce(p_fields ->> 'preheader', preheader),
        html = coalesce(p_fields ->> 'html', html),
        text_body = coalesce(p_fields ->> 'text_body', text_body),
        template_id = case when p_fields ? 'template_id' then case when p_fields ->> 'template_id' ~ '^[0-9a-f-]{36}$' then (p_fields ->> 'template_id')::uuid end else template_id end,
        audience = case when jsonb_typeof(p_fields -> 'audience') = 'object' then p_fields -> 'audience' else audience end,
        send_at = case when p_fields ? 'send_at' then (p_fields ->> 'send_at')::timestamptz else send_at end,
        status = 'draft', snapshot_hash = null, approved_hash = null, approved_by = null, approved_at = null,
        submitted_by = case when v_was = 'draft' then submitted_by else null end,
        submitted_at = case when v_was = 'draft' then submitted_at else null end,
        recipient_count = 0,
        updated_by = p_actor, updated_at = now()
    where id = p_campaign
    returning * into v_campaign;
  exception when check_violation then
    perform public.um_fail(400, 'Check the campaign: some fields are too long.');
  end;
  delete from public.email_campaign_recipients where campaign_id = p_campaign;

  if v_was <> 'draft' then
    perform public.um_audit(p_actor, null, 'email_campaign.edited', jsonb_build_object('status', v_was),
      jsonb_build_object('status', 'draft', 'note', case when v_was in ('approved', 'paused') then 'Approval withdrawn by the change.' end),
      p_ctx, jsonb_build_object('campaign_id', p_campaign));
  end if;
  return public.em_campaign_json(v_campaign, true);
end
$$;

-- As in part 2, plus: a sender mailbox must be usable by the submitter now.
create or replace function public.em_submit_campaign(p_actor uuid, p_campaign uuid, p_max integer, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign public.email_campaigns;
  v_count integer;
  v_problem text;
begin
  perform public.um_actor(p_actor, 'email_campaigns.create');
  v_campaign := public.em_campaign_access(p_actor, p_campaign, true);
  if v_campaign.status not in ('draft', 'rejected') then
    perform public.um_fail(409, 'Only a draft can be submitted for approval.');
  end if;
  if btrim(v_campaign.subject) = '' or btrim(v_campaign.html) = '' or v_campaign.from_email = '' then
    perform public.um_fail(400, 'A campaign needs a sender, a subject and content before it can be submitted.');
  end if;
  if v_campaign.sender_account_id is not null then
    v_problem := public.em_sender_problem(v_campaign.sender_account_id, p_actor);
    if v_problem is not null then
      perform public.um_fail(409, v_problem);
    end if;
  end if;
  if v_campaign.send_at is not null and v_campaign.send_at < now() then
    perform public.um_fail(400, 'The scheduled time has passed. Choose a new time or send as soon as it is approved.');
  end if;

  delete from public.email_campaign_recipients where campaign_id = p_campaign;
  insert into public.email_campaign_recipients (campaign_id, email, name, company, source_type, source_id)
  select p_campaign, r.email, r.name, r.company, r.source_type, r.source_id
  from public.em_audience_rows(p_actor, v_campaign.audience) r
  where public.em_marketable(r.email);
  get diagnostics v_count = row_count;
  if v_count = 0 then
    perform public.um_fail(400, 'Nobody in this audience has agreed to receive marketing email. Record consent first, or change the audience.');
  end if;
  if v_count > least(greatest(coalesce(p_max, 5000), 1), 50000) then
    perform public.um_fail(400, format('This audience has %s eligible addresses; the limit per campaign is %s.', v_count, p_max));
  end if;

  update public.email_campaigns
  set status = 'pending_approval', recipient_count = v_count, submitted_by = p_actor, submitted_at = now(),
      decision_note = null, updated_at = now()
  where id = p_campaign;
  update public.email_campaigns set snapshot_hash = public.em_campaign_hash(p_campaign) where id = p_campaign
  returning * into v_campaign;

  perform public.um_audit(p_actor, null, 'email_campaign.submitted', null,
    jsonb_build_object('recipients', v_count, 'hash', v_campaign.snapshot_hash), p_ctx, jsonb_build_object('campaign_id', p_campaign));
  return public.em_campaign_json(v_campaign, true);
end
$$;

-- As in part 2, plus: p_allow_ses (false while SES is off, so an SES-path
-- campaign is never claimed only to fail), and for a sender mailbox the
-- checks above, its cooldown and its own daily limit. The claim returns the
-- sender mailbox (with its encrypted Google token, for the Worker only).
drop function if exists public.em_claim_campaign_batch(integer, integer);
create or replace function public.em_claim_campaign_batch(p_limit integer, p_daily_cap integer, p_allow_ses boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign public.email_campaigns;
  v_sender public.email_accounts;
  v_problem text;
  v_room integer;
  v_mailbox_room integer;
  v_rows jsonb;
  v_count integer;
  v_today date := (now() at time zone 'utc')::date;
begin
  update public.email_campaign_recipients
  set status = 'uncertain', last_error = 'No result was recorded for this send.'
  where status = 'sending' and claimed_at < now() - interval '10 minutes';

  select c.* into v_campaign
  from public.email_campaigns c
  left join public.email_accounts a on a.id = c.sender_account_id
  where c.status in ('approved', 'sending') and (c.send_at is null or c.send_at <= now())
    and (c.sender_account_id is not null or coalesce(p_allow_ses, true))
    and (a.id is null or a.campaign_cooldown_until is null or a.campaign_cooldown_until <= now())
  order by coalesce(c.send_at, c.approved_at)
  limit 1
  for update of c skip locked;
  if v_campaign.id is null then
    return null;
  end if;
  if v_campaign.approved_hash is null or v_campaign.approved_hash is distinct from public.em_campaign_hash(v_campaign.id) then
    update public.email_campaigns set status = 'paused', decision_note = 'Paused automatically: content no longer matches the approval.', updated_at = now()
    where id = v_campaign.id;
    return null;
  end if;
  if v_campaign.sender_account_id is not null then
    v_problem := public.em_sender_problem(v_campaign.sender_account_id, v_campaign.submitted_by);
    if v_problem is not null then
      update public.email_campaigns set status = 'paused', decision_note = 'Paused automatically: ' || v_problem, updated_at = now()
      where id = v_campaign.id;
      perform public.um_audit(null, null, 'email_campaign.paused', null, jsonb_build_object('note', v_problem), '{}'::jsonb,
        jsonb_build_object('campaign_id', v_campaign.id));
      return null;
    end if;
    select * into v_sender from public.email_accounts where id = v_campaign.sender_account_id for update;
  end if;

  update public.email_campaign_recipients r
  set status = 'skipped',
      skip_reason = case when exists (select 1 from public.email_preferences p where p.email = r.email and p.suppressed)
                         then 'suppressed' else 'no_consent' end
  where r.campaign_id = v_campaign.id and r.status = 'pending' and not public.em_marketable(r.email);

  insert into public.email_send_budget (day, sent) values (v_today, 0) on conflict (day) do nothing;
  select case when coalesce(p_daily_cap, 0) <= 0 then p_limit else greatest(p_daily_cap - b.sent, 0) end into v_room
  from public.email_send_budget b where b.day = v_today for update;
  v_room := least(coalesce(v_room, 0), greatest(p_limit, 0), 50);
  if v_sender.id is not null then
    insert into public.email_mailbox_budget (account_id, day, sent) values (v_sender.id, v_today, 0) on conflict (account_id, day) do nothing;
    select greatest(v_sender.campaign_daily_cap - b.sent, 0) into v_mailbox_room
    from public.email_mailbox_budget b where b.account_id = v_sender.id and b.day = v_today for update;
    v_room := least(v_room, coalesce(v_mailbox_room, 0));
  end if;

  if v_room > 0 then
    with picked as (
      select r.id from public.email_campaign_recipients r
      where r.campaign_id = v_campaign.id and r.status = 'pending'
      order by r.email
      limit v_room
      for update skip locked
    ), claimed as (
      update public.email_campaign_recipients r
      set status = 'sending', claimed_at = now(), attempts = attempts + 1
      from picked where r.id = picked.id
      returning r.id, r.email, r.name, r.company
    )
    select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb), count(*) into v_rows, v_count from claimed;
    update public.email_send_budget set sent = sent + v_count where day = v_today;
    if v_sender.id is not null then
      update public.email_mailbox_budget set sent = sent + v_count where account_id = v_sender.id and day = v_today;
    end if;
  else
    v_rows := '[]'::jsonb;
    v_count := 0;
  end if;

  if v_count = 0 then
    if not exists (select 1 from public.email_campaign_recipients where campaign_id = v_campaign.id and status in ('pending', 'sending')) then
      update public.email_campaigns set status = 'sent', finished_at = now(), updated_at = now() where id = v_campaign.id;
      perform public.um_audit(null, null, 'email_campaign.sent', null,
        jsonb_build_object('recipients', v_campaign.recipient_count), '{}'::jsonb, jsonb_build_object('campaign_id', v_campaign.id));
    end if;
    return null;
  end if;

  update public.email_campaigns set status = 'sending', started_at = coalesce(started_at, now()), updated_at = now() where id = v_campaign.id;
  return jsonb_build_object(
    'campaign', jsonb_build_object('id', v_campaign.id, 'from_name', v_campaign.from_name, 'from_email', v_campaign.from_email,
      'reply_to', v_campaign.reply_to, 'subject', v_campaign.subject, 'preheader', v_campaign.preheader,
      'html', v_campaign.html, 'text_body', v_campaign.text_body),
    'sender', case when v_sender.id is null then null else jsonb_build_object(
      'id', v_sender.id, 'provider', v_sender.provider, 'provider_account_id', v_sender.provider_account_id,
      'email_address', v_sender.email_address, 'display_name', v_sender.display_name,
      'token_enc', (select c.refresh_token_enc from public.email_oauth_credentials c where c.account_id = v_sender.id)) end,
    'recipients', v_rows);
end
$$;

-- As in part 2, plus: a throttled send also returns its unit to the sender
-- mailbox's budget; p_cooldown_seconds rests that mailbox after the
-- provider limited it; p_pause_note pauses the campaign (the provider
-- refused the mailbox itself).
drop function if exists public.em_finish_campaign_batch(jsonb);
create or replace function public.em_finish_campaign_batch(p_results jsonb, p_cooldown_seconds integer default null, p_pause_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_returned integer;
  v_campaign public.email_campaigns;
begin
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 50 then
    raise exception 'Expected at most 50 results' using errcode = 'PT400';
  end if;
  select c.* into v_campaign
  from public.email_campaigns c
  join public.email_campaign_recipients r on r.campaign_id = c.id
  where r.id = (select (x ->> 'id')::uuid from jsonb_array_elements(p_results) x limit 1);

  update public.email_campaign_recipients r
  set status = case when x.status = 'pending' and r.attempts >= 5 then 'failed' else x.status end,
      provider_message_id = left(x.message_id, 200),
      sent_at = case when x.status = 'sent' then now() end,
      last_error = left(x.error, 300)
  from jsonb_to_recordset(p_results) as x (id uuid, status text, message_id text, error text)
  where r.id = x.id and r.status = 'sending' and x.status in ('sent', 'failed', 'uncertain', 'pending');
  select count(*) into v_returned from jsonb_to_recordset(p_results) as x (id uuid, status text) where x.status = 'pending';
  if v_returned > 0 then
    update public.email_send_budget set sent = greatest(sent - v_returned, 0) where day = (now() at time zone 'utc')::date;
    if v_campaign.sender_account_id is not null then
      update public.email_mailbox_budget set sent = greatest(sent - v_returned, 0)
      where account_id = v_campaign.sender_account_id and day = (now() at time zone 'utc')::date;
    end if;
  end if;
  if v_campaign.sender_account_id is not null and coalesce(p_cooldown_seconds, 0) > 0 then
    update public.email_accounts
    set campaign_cooldown_until = now() + make_interval(secs => least(p_cooldown_seconds, 86400))
    where id = v_campaign.sender_account_id;
  end if;
  if v_campaign.id is not null and p_pause_note is not null and v_campaign.status in ('approved', 'sending') then
    update public.email_campaigns set status = 'paused', decision_note = left('Paused automatically: ' || p_pause_note, 500), updated_at = now()
    where id = v_campaign.id;
    perform public.um_audit(null, null, 'email_campaign.paused', null, jsonb_build_object('note', left(p_pause_note, 300)), '{}'::jsonb,
      jsonb_build_object('campaign_id', v_campaign.id));
  end if;
end
$$;

-- As in part 2, plus the sender mailbox when the actor may still use it.
create or replace function public.em_duplicate_campaign(p_actor uuid, p_campaign uuid, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source public.email_campaigns;
  v_sender uuid;
begin
  perform public.um_actor(p_actor, 'email_campaigns.create');
  v_source := public.em_campaign_access(p_actor, p_campaign, false);
  select a.id into v_sender from public.email_accounts a
  where a.id = v_source.sender_account_id and a.campaign_sender and a.status = 'connected'
    and public.em_role_rank(public.em_mailbox_role(p_actor, a.id)) >= 2;
  return public.em_save_campaign(p_actor, null, jsonb_build_object(
    'name', left('Copy of ' || v_source.name, 120), 'from_name', v_source.from_name, 'from_email', v_source.from_email,
    'reply_to', v_source.reply_to, 'subject', v_source.subject, 'preheader', v_source.preheader, 'html', v_source.html,
    'text_body', v_source.text_body, 'template_id', v_source.template_id, 'audience', v_source.audience,
    'sender_account_id', v_sender), p_ctx);
end
$$;

-- One unit of a mailbox's campaign budget (test sends), or none.
create or replace function public.em_take_mailbox_budget(p_account uuid, p_n integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cap integer;
begin
  select campaign_daily_cap into v_cap from public.email_accounts where id = p_account and campaign_sender;
  if v_cap is null or coalesce(p_n, 0) <= 0 then
    return false;
  end if;
  insert into public.email_mailbox_budget (account_id, day, sent) values (p_account, (now() at time zone 'utc')::date, 0)
  on conflict (account_id, day) do nothing;
  update public.email_mailbox_budget set sent = sent + p_n
  where account_id = p_account and day = (now() at time zone 'utc')::date and sent + p_n <= v_cap;
  return found;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Grants: the Worker (service role) only, as for every em_* function.
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
