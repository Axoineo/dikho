-- ============================================================================
-- LIVE ASSIST: an administrator helps a colleague by watching their Dikho tab,
-- with the colleague's OK, and pointing at things. Plus "Ask for help".
--
-- Decided by the owner on 2026-10-07 (docs/tasks/2026-10-06-user-management.md):
--   - The employee accepts every request. Their browser then shares the Dikho
--     tab (browsers always ask before a screen share; nothing here bypasses it).
--   - The helper watches, points, highlights and can suggest a page. There is
--     no remote control. The employee sees a banner and can stop at any time.
--   - Who may help whom follows User Management's ranks: the helper needs
--     live_assist.use and must outrank the employee (Owners: anyone but
--     themselves). The same rule picks who is told about a help request.
--   - Nothing is recorded. The video goes browser to browser (WebRTC); this
--     database only holds who helped whom, when and for how long.
--
-- Signalling (the few messages that set up the browser-to-browser connection)
-- travels on a private Realtime channel `assist:<session id>` that only the
-- two participants of a requested or active session may join or send on.
--
-- Rules live here, re-checked on every call, like the um_* functions: the
-- Worker passes the actor it verified and nothing else is trusted.
--
-- ORDER: needs 20261006150000_user_management.sql (staff_members, um_*).
-- Harmless before the API and dashboard that use it are deployed.
-- If applied with the Supabase MCP `apply_migration` tool, rename this file
-- to the version it records (supabase/AGENTS.md).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.help_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.staff_members (user_id) on delete restrict,
  message text check (char_length(message) <= 300),
  section text check (section ~ '^[a-z][a-z0-9-]{0,39}$'),
  status text not null default 'open' check (status in ('open', 'claimed', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  claimed_by uuid,
  closed_at timestamptz
);
create index if not exists help_requests_requester_idx on public.help_requests (requester_id, created_at desc);
create index if not exists help_requests_open_idx on public.help_requests (created_at desc) where status = 'open';

create table if not exists public.live_assist_sessions (
  id uuid primary key default gen_random_uuid(),
  helper_id uuid not null references public.staff_members (user_id) on delete restrict,
  employee_id uuid not null references public.staff_members (user_id) on delete restrict,
  help_request_id uuid references public.help_requests (id) on delete set null,
  status text not null default 'requested' check (status in ('requested', 'active', 'ended')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason in (
    'declined', 'expired', 'cancelled', 'superseded', 'helper_ended', 'employee_ended',
    'connection_lost', 'time_limit', 'access_changed')),
  ended_by uuid,
  check (helper_id <> employee_id),
  check ((status = 'ended') = (ended_at is not null))
);
create index if not exists live_assist_sessions_employee_idx on public.live_assist_sessions (employee_id, requested_at desc);
create index if not exists live_assist_sessions_helper_idx on public.live_assist_sessions (helper_id, requested_at desc);
create index if not exists live_assist_sessions_open_idx on public.live_assist_sessions (status) where status <> 'ended';

do $$
declare
  t text;
begin
  foreach t in array array['help_requests', 'live_assist_sessions']
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

update public.permissions
set description = 'With their OK, view a lower-ranked colleague''s Dikho tab and point at things. No remote control.'
where key = 'live_assist.use';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Time limits, applied lazily by every call so readers see the truth:
--    a request waits 60 seconds for an answer, a session lasts at most two
--    hours, a help request stays open 15 minutes.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.la_expire()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    update public.live_assist_sessions
    set status = 'ended', ended_at = now(),
        end_reason = case when status = 'requested' then 'expired' else 'time_limit' end
    where (status = 'requested' and requested_at < now() - interval '60 seconds')
       or (status = 'active' and started_at < now() - interval '2 hours')
    returning id, helper_id, employee_id, end_reason, started_at
  loop
    perform public.um_audit(null, r.employee_id, 'live_assist.ended', null,
      jsonb_build_object('reason', r.end_reason), '{}'::jsonb,
      jsonb_build_object('session_id', r.id, 'helper_id', r.helper_id,
        'duration_seconds', case when r.started_at is null then 0 else extract(epoch from now() - r.started_at)::integer end));
  end loop;

  update public.help_requests
  set status = 'expired', closed_at = now()
  where status = 'open' and created_at < now() - interval '15 minutes';
end
$$;

create or replace function public.la_session_json(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'status', s.status,
    'helper_id', s.helper_id,
    'helper_name', h.full_name,
    'employee_id', s.employee_id,
    'employee_name', e.full_name,
    'help_request_id', s.help_request_id,
    'requested_at', s.requested_at,
    'started_at', s.started_at,
    'ended_at', s.ended_at,
    'end_reason', s.end_reason,
    'expires_at', case when s.status = 'requested' then s.requested_at + interval '60 seconds'
                       when s.status = 'active' then s.started_at + interval '2 hours' end
  )
  from public.live_assist_sessions s
  join public.staff_members h on h.user_id = s.helper_id
  join public.staff_members e on e.user_id = s.employee_id
  where s.id = p_session
$$;

-- Everyone who may help this person: active staff holding live_assist.use who
-- outrank them (Owners: anyone but themselves). Most recently active first,
-- at most 25, so one help request is one bounded broadcast.
create or replace function public.la_helpers_for(p_employee uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.user_id), '{}')
  from (
    select h.user_id
    from public.staff_members h
    cross join public.staff_members t
    where t.user_id = p_employee
      and h.user_id <> p_employee
      and public.staff_is_active(h.user_id)
      and public.um_can_manage(h, t)
      and exists (select 1 from public.effective_permissions_for(h.user_id) e where e.permission_key = 'live_assist.use')
    order by h.last_seen_at desc nulls last
    limit 25
  ) x
$$;

-- Ends a session and audits it. Internal; callers check who may.
create or replace function public.la_close(p_session uuid, p_reason text, p_by uuid, p_ctx jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.live_assist_sessions;
begin
  update public.live_assist_sessions
  set status = 'ended', ended_at = now(), end_reason = p_reason, ended_by = p_by
  where id = p_session and status <> 'ended'
  returning * into s;
  if not found then
    return;
  end if;
  perform public.um_audit(p_by, s.employee_id,
    case when p_reason = 'declined' then 'live_assist.declined' else 'live_assist.ended' end,
    null, jsonb_build_object('reason', p_reason), p_ctx,
    jsonb_build_object('session_id', s.id, 'helper_id', s.helper_id,
      'duration_seconds', case when s.started_at is null then 0 else extract(epoch from now() - s.started_at)::integer end));
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Sessions
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.la_start(p_actor uuid, p_employee uuid, p_request uuid, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, 'live_assist.use');
  v_target public.staff_members;
  v_other text;
  v_id uuid;
  v_request uuid;
begin
  v_target := public.um_target(v_actor, p_employee);
  if not public.staff_is_active(p_employee) then
    perform public.um_fail(409, format('%s cannot be helped right now: their account is not active.', v_target.full_name));
  end if;
  if not exists (
    select 1 from auth.sessions s
    where s.user_id = p_employee and (s.not_after is null or s.not_after > now())
  ) then
    perform public.um_fail(409, format('%s is not signed in to Dikho right now.', v_target.full_name));
  end if;

  perform public.la_expire();

  if (select count(*) from public.live_assist_sessions
      where helper_id = p_actor and requested_at > now() - interval '1 hour') >= 30 then
    perform public.um_fail(429, 'That is a lot of Live Assist requests in one hour. Try again later.');
  end if;
  if exists (select 1 from public.live_assist_sessions where helper_id = p_actor and status = 'active') then
    perform public.um_fail(409, 'Finish your current Live Assist session first.');
  end if;
  select h.full_name into v_other
  from public.live_assist_sessions s join public.staff_members h on h.user_id = s.helper_id
  where s.employee_id = p_employee and s.status = 'active';
  if found then
    perform public.um_fail(409, format('%s is already being helped by %s.', v_target.full_name, v_other));
  end if;

  -- A newer request replaces this helper's unanswered one.
  perform public.la_close(s.id, 'superseded', p_actor, p_ctx)
  from public.live_assist_sessions s
  where s.helper_id = p_actor and s.status = 'requested';

  if p_request is not null then
    update public.help_requests
    set status = 'claimed', claimed_by = p_actor, closed_at = now()
    where id = p_request and requester_id = p_employee and status = 'open'
    returning id into v_request;
  end if;

  insert into public.live_assist_sessions (helper_id, employee_id, help_request_id)
  values (p_actor, p_employee, v_request)
  returning id into v_id;

  perform public.um_audit(p_actor, p_employee, 'live_assist.requested', null, null, p_ctx,
    jsonb_strip_nulls(jsonb_build_object('session_id', v_id, 'help_request_id', v_request)));

  return public.la_session_json(v_id) || jsonb_build_object(
    'claimed_request', v_request is not null,
    'helpers', case when v_request is null then '[]'::jsonb else to_jsonb(public.la_helpers_for(p_employee)) end
  );
end
$$;

-- The employee answers. Accepting re-checks that the helper may still help
-- them (a role change in the last minute must not slip through).
create or replace function public.la_respond(p_actor uuid, p_session uuid, p_accept boolean, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, null);
  s public.live_assist_sessions;
  v_helper public.staff_members;
begin
  perform public.la_expire();
  select * into s from public.live_assist_sessions where id = p_session for update;
  if not found or s.employee_id <> p_actor then
    perform public.um_fail(404, 'That Live Assist request does not exist.');
  end if;
  -- Not an exception: raising would roll back the expiry la_expire() just
  -- recorded. The Worker turns `stale` into a 409 for the person.
  if s.status <> 'requested' then
    return public.la_session_json(s.id) || jsonb_build_object('stale', true);
  end if;

  if not p_accept then
    perform public.la_close(s.id, 'declined', p_actor, p_ctx);
    return public.la_session_json(s.id);
  end if;

  select * into v_helper from public.staff_members where user_id = s.helper_id;
  if not public.staff_is_active(s.helper_id)
     or not public.um_can_manage(v_helper, v_actor)
     or not exists (select 1 from public.effective_permissions_for(s.helper_id) e where e.permission_key = 'live_assist.use') then
    perform public.la_close(s.id, 'access_changed', null, p_ctx);
    return public.la_session_json(s.id);
  end if;

  update public.live_assist_sessions set status = 'active', started_at = now() where id = s.id;
  perform public.um_audit(p_actor, p_actor, 'live_assist.accepted', null, null, p_ctx,
    jsonb_build_object('session_id', s.id, 'helper_id', s.helper_id));
  return public.la_session_json(s.id);
end
$$;

-- Either participant ends it, at any time; ending twice is not an error.
create or replace function public.la_end(p_actor uuid, p_session uuid, p_reason text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.live_assist_sessions;
  v_reason text;
begin
  select * into s from public.live_assist_sessions where id = p_session for update;
  if not found or p_actor not in (s.helper_id, s.employee_id) then
    perform public.um_fail(404, 'That Live Assist session does not exist.');
  end if;
  v_reason := case
    when p_reason = 'connection_lost' then 'connection_lost'
    when s.status = 'requested' and p_actor = s.helper_id then 'cancelled'
    when s.status = 'requested' then 'declined'
    when p_actor = s.helper_id then 'helper_ended'
    else 'employee_ended' end;
  perform public.la_close(s.id, v_reason, p_actor, p_ctx);
  return public.la_session_json(s.id);
end
$$;

create or replace function public.la_get(p_actor uuid, p_session uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.live_assist_sessions;
begin
  perform public.la_expire();
  select * into s from public.live_assist_sessions where id = p_session;
  if not found or p_actor not in (s.helper_id, s.employee_id) then
    perform public.um_fail(404, 'That Live Assist session does not exist.');
  end if;
  return public.la_session_json(s.id);
end
$$;

-- What a dashboard needs when it loads: an unanswered request for me, a
-- session I am in, my own open help request, and (for helpers) open help
-- requests from people I may help.
create or replace function public.la_state(p_actor uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, null);
  v_can_help boolean := exists (
    select 1 from public.effective_permissions_for(p_actor) e where e.permission_key = 'live_assist.use');
begin
  perform public.la_expire();
  return jsonb_build_object(
    'incoming', (
      select public.la_session_json(s.id) from public.live_assist_sessions s
      where s.employee_id = p_actor and s.status = 'requested'
      order by s.requested_at desc limit 1),
    'sessions', coalesce((
      select jsonb_agg(public.la_session_json(s.id)) from public.live_assist_sessions s
      where p_actor in (s.helper_id, s.employee_id) and s.status = 'active'), '[]'::jsonb),
    'my_help_request', (
      select jsonb_build_object('id', r.id, 'created_at', r.created_at, 'expires_at', r.created_at + interval '15 minutes')
      from public.help_requests r where r.requester_id = p_actor and r.status = 'open'
      order by r.created_at desc limit 1),
    'help_requests', case when not v_can_help then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'requester_id', r.requester_id, 'requester_name', m.full_name,
        'message', r.message, 'section', r.section, 'created_at', r.created_at) order by r.created_at)
      from public.help_requests r
      join public.staff_members m on m.user_id = r.requester_id
      where r.status = 'open' and r.requester_id <> p_actor and public.um_can_manage(v_actor, m)), '[]'::jsonb) end
  );
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Ask for help
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.la_request_help(p_actor uuid, p_message text, p_section text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, null);
  v_existing public.help_requests;
  v_id uuid;
  v_message text := nullif(btrim(left(coalesce(p_message, ''), 300)), '');
  v_section text := case when p_section ~ '^[a-z][a-z0-9-]{0,39}$' then p_section end;
begin
  perform public.la_expire();

  select * into v_existing from public.help_requests
  where requester_id = p_actor and status = 'open' order by created_at desc limit 1;
  if found then
    return jsonb_build_object('request_id', v_existing.id, 'already_open', true,
      'expires_at', v_existing.created_at + interval '15 minutes', 'helpers', '[]'::jsonb);
  end if;

  if (select count(*) from public.help_requests
      where requester_id = p_actor and created_at > now() - interval '1 day') >= 10 then
    perform public.um_fail(429, 'You have asked for help many times today. Contact your administrator directly.');
  end if;

  insert into public.help_requests (requester_id, message, section)
  values (p_actor, v_message, v_section)
  returning id into v_id;

  -- The message itself stays out of the audit log: it is the person's own
  -- words, kept on the request only.
  perform public.um_audit(p_actor, p_actor, 'live_assist.help_requested', null, null, p_ctx,
    jsonb_strip_nulls(jsonb_build_object('help_request_id', v_id, 'section', v_section)));

  return jsonb_build_object(
    'request_id', v_id, 'already_open', false,
    'expires_at', now() + interval '15 minutes',
    'requester_name', v_actor.full_name, 'message', v_message, 'section', v_section,
    'helpers', to_jsonb(public.la_helpers_for(p_actor)));
end
$$;

create or replace function public.la_cancel_help(p_actor uuid, p_request uuid, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.help_requests;
begin
  update public.help_requests
  set status = 'cancelled', closed_at = now()
  where id = p_request and requester_id = p_actor and status = 'open'
  returning * into r;
  if not found then
    return jsonb_build_object('cancelled', false, 'helpers', '[]'::jsonb);
  end if;
  perform public.um_audit(p_actor, p_actor, 'live_assist.help_cancelled', null, null, p_ctx,
    jsonb_build_object('help_request_id', r.id));
  return jsonb_build_object('cancelled', true, 'helpers', to_jsonb(public.la_helpers_for(p_actor)));
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Realtime: only the two participants of a waiting or live session may
--    listen on, or send to, `assist:<session id>`.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.la_can_use_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_topic is null or p_topic !~ '^assist:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := substr(p_topic, 8)::uuid;
  return public.is_staff() and exists (
    select 1 from public.live_assist_sessions s
    where s.id = v_id
      and s.status in ('requested', 'active')
      and auth.uid() in (s.helper_id, s.employee_id)
  );
end
$$;

drop policy if exists "live assist participants receive" on realtime.messages;
create policy "live assist participants receive"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast')
    and (select public.la_can_use_topic(realtime.topic()))
  );

drop policy if exists "live assist participants send" on realtime.messages;
create policy "live assist participants send"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast')
    and (select public.la_can_use_topic(realtime.topic()))
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Grants: the Worker (service role) calls la_*; browsers only reach the
--    topic check, through the Realtime policies above.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('la_expire', 'la_session_json', 'la_helpers_for', 'la_close', 'la_start',
        'la_respond', 'la_end', 'la_get', 'la_state', 'la_request_help', 'la_cancel_help', 'la_can_use_topic')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end
$$;
grant execute on function public.la_can_use_topic(text) to authenticated;

notify pgrst, 'reload schema';
