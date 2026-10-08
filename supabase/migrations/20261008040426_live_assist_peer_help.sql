-- ============================================================================
-- LIVE ASSIST, PART 2: colleagues at the same level can help each other, a
-- help request can go to one chosen person, and nobody is in two Live Assist
-- sessions at once.
--
-- Decided by the owner on 2026-10-07 (docs/decisions/0008-live-assist.md):
--   - Anyone holding live_assist.use may help people at their own level or
--     below, never themselves. Admins can now help Admins and developers
--     developers; Owners could already help anyone. (Until now the helper had
--     to rank strictly above: User Management's "manage" rule.)
--   - "Ask for help" may name one person, who must be allowed to help; only
--     they are told. Without a name, everyone allowed is told, as before.
--   - One session per person at a time, as helper or as the one helped.
--     Otherwise a shared tab could show the viewer of a second session and
--     pass a third person's screen to someone they never accepted.
--   - Chat and pinned notes travel on the session's own browser-to-browser
--     data channel. Nothing about them is stored here.
--
-- ORDER: needs 20261007114458_live_assist.sql. Apply before the API that
-- sends `p_helper`; the older API keeps working (p_helper defaults to null).
-- If applied with the Supabase MCP `apply_migration` tool, rename this file
-- to the version it records (supabase/AGENTS.md).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────────
alter table public.help_requests
  add column if not exists helper_id uuid references public.staff_members (user_id) on delete restrict;
comment on column public.help_requests.helper_id is
  'The one person asked for help, or null for everyone allowed to help.';

alter table public.live_assist_sessions drop constraint if exists live_assist_sessions_end_reason_check;
alter table public.live_assist_sessions add constraint live_assist_sessions_end_reason_check check (end_reason in (
  'declined', 'expired', 'cancelled', 'superseded', 'helper_ended', 'employee_ended',
  'connection_lost', 'time_limit', 'access_changed', 'busy'));

update public.permissions
set description = 'With their OK, view the Dikho tab of a colleague at your level or below and point at things. No remote control.'
where key = 'live_assist.use';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Who may help whom, and who is busy
-- ─────────────────────────────────────────────────────────────────────────

-- The rank rule alone: anyone at the helper's level or below, never
-- themselves. Callers add "active" and "holds live_assist.use".
create or replace function public.la_can_help(p_helper public.staff_members, p_employee public.staff_members)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_helper.user_id <> p_employee.user_id
     and public.staff_rank(p_helper.system_role, p_helper.developer_level)
         >= public.staff_rank(p_employee.system_role, p_employee.developer_level)
$$;

-- The whole rule: an active helper holding live_assist.use who passes the
-- rank rule.
create or replace function public.la_may_help(p_helper uuid, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.staff_is_active(h.user_id)
       and public.la_can_help(h, e)
       and exists (select 1 from public.effective_permissions_for(h.user_id) p where p.permission_key = 'live_assist.use')
    from public.staff_members h
    cross join public.staff_members e
    where h.user_id = p_helper and e.user_id = p_employee
  ), false)
$$;

-- In a live session already, in either role (optionally leaving one out).
create or replace function public.la_busy(p_user uuid, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.live_assist_sessions s
    where s.status = 'active'
      and p_user in (s.helper_id, s.employee_id)
      and s.id is distinct from p_except
  )
$$;

-- Everyone who may help this person: active staff holding live_assist.use at
-- their level or above. Most recently active first, at most 25, so one help
-- request is one bounded broadcast.
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
      and public.la_can_help(h, t)
      and exists (select 1 from public.effective_permissions_for(h.user_id) e where e.permission_key = 'live_assist.use')
    order by h.last_seen_at desc nulls last
    limit 25
  ) x
$$;

-- For "Ask for help": the people who may help the caller, online first, and
-- whether each is in a session right now. At most 50.
create or replace function public.la_my_helpers(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.staff_members := public.um_actor(p_actor, null);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', x.user_id, 'full_name', x.full_name, 'online', x.online, 'busy', x.busy)
      order by x.online desc, x.full_name)
    from (
      select h.user_id, h.full_name,
             coalesce(h.last_seen_at > now() - interval '2 minutes', false)
               and exists (select 1 from auth.sessions s
                           where s.user_id = h.user_id and (s.not_after is null or s.not_after > now())) as online,
             public.la_busy(h.user_id) as busy
      from public.staff_members h
      where h.user_id <> p_actor
        and public.staff_is_active(h.user_id)
        and public.la_can_help(h, v_actor)
        and exists (select 1 from public.effective_permissions_for(h.user_id) e where e.permission_key = 'live_assist.use')
      order by h.last_seen_at desc nulls last
      limit 50
    ) x
  ), '[]'::jsonb);
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
  v_asked uuid;
begin
  select * into v_target from public.staff_members where user_id = p_employee;
  if not found then
    perform public.um_fail(404, 'That user does not exist.');
  end if;
  if p_employee = p_actor then
    perform public.um_fail(403, 'You cannot start Live Assist with yourself.');
  end if;
  if not public.la_can_help(v_actor, v_target) then
    perform public.um_fail(403, 'You can help people at your own level or below.');
  end if;
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

  -- One session per person, in either role: a tab being shared must never
  -- show the viewer of another session.
  if public.la_busy(p_actor) then
    perform public.um_fail(409, 'Finish your current Live Assist session first.');
  end if;
  select case when s.employee_id = p_employee
              then format('%s is already being helped by %s.', v_target.full_name, h.full_name)
              else format('%s is helping someone right now. Try again when they finish.', v_target.full_name) end
  into v_other
  from public.live_assist_sessions s
  join public.staff_members h on h.user_id = s.helper_id
  where s.status = 'active' and p_employee in (s.helper_id, s.employee_id)
  limit 1;
  if found then
    perform public.um_fail(409, v_other);
  end if;
  select format('%s already has a Live Assist request waiting from %s.', v_target.full_name, h.full_name)
  into v_other
  from public.live_assist_sessions s
  join public.staff_members h on h.user_id = s.helper_id
  where s.status = 'requested' and s.employee_id = p_employee and s.helper_id <> p_actor
  limit 1;
  if found then
    perform public.um_fail(409, v_other);
  end if;

  -- A newer request replaces this helper's unanswered one.
  perform public.la_close(s.id, 'superseded', p_actor, p_ctx)
  from public.live_assist_sessions s
  where s.helper_id = p_actor and s.status = 'requested';

  -- Taking a help request: only an open one from this person, and only by
  -- the one they asked when they asked someone in particular.
  if p_request is not null then
    update public.help_requests
    set status = 'claimed', claimed_by = p_actor, closed_at = now()
    where id = p_request and requester_id = p_employee and status = 'open'
      and (helper_id is null or helper_id = p_actor)
    returning id, helper_id into v_request, v_asked;
  end if;

  insert into public.live_assist_sessions (helper_id, employee_id, help_request_id)
  values (p_actor, p_employee, v_request)
  returning id into v_id;

  perform public.um_audit(p_actor, p_employee, 'live_assist.requested', null, null, p_ctx,
    jsonb_strip_nulls(jsonb_build_object('session_id', v_id, 'help_request_id', v_request)));

  -- When an open request to everyone is taken, the others are told.
  return public.la_session_json(v_id) || jsonb_build_object(
    'claimed_request', v_request is not null,
    'helpers', case when v_request is null or v_asked is not null then '[]'::jsonb
                    else to_jsonb(public.la_helpers_for(p_employee)) end
  );
end
$$;

-- The employee answers. Accepting re-checks that the helper may still help
-- them (a role change in the last minute must not slip through) and that
-- neither of them went into another session meanwhile.
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

  if not public.la_may_help(s.helper_id, p_actor) then
    perform public.la_close(s.id, 'access_changed', null, p_ctx);
    return public.la_session_json(s.id);
  end if;
  if public.la_busy(p_actor, s.id) or public.la_busy(s.helper_id, s.id) then
    perform public.la_close(s.id, 'busy', null, p_ctx);
    return public.la_session_json(s.id);
  end if;

  update public.live_assist_sessions set status = 'active', started_at = now() where id = s.id;
  perform public.um_audit(p_actor, p_actor, 'live_assist.accepted', null, null, p_ctx,
    jsonb_build_object('session_id', s.id, 'helper_id', s.helper_id));
  return public.la_session_json(s.id);
end
$$;

-- What a dashboard needs when it loads: an unanswered request for me, a
-- session I am in, my own open help request, and (for helpers) open help
-- requests from people I may help: ones to everyone, and ones to me.
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
      select jsonb_build_object('id', r.id, 'created_at', r.created_at, 'expires_at', r.created_at + interval '15 minutes',
                                'helper_id', r.helper_id, 'helper_name', h.full_name)
      from public.help_requests r
      left join public.staff_members h on h.user_id = r.helper_id
      where r.requester_id = p_actor and r.status = 'open'
      order by r.created_at desc limit 1),
    'help_requests', case when not v_can_help then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'requester_id', r.requester_id, 'requester_name', m.full_name,
        'message', r.message, 'section', r.section, 'created_at', r.created_at,
        'for_you', r.helper_id is not null) order by r.created_at)
      from public.help_requests r
      join public.staff_members m on m.user_id = r.requester_id
      where r.status = 'open' and r.requester_id <> p_actor
        and (r.helper_id is null or r.helper_id = p_actor)
        and public.la_can_help(v_actor, m)), '[]'::jsonb) end
  );
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Ask for help, optionally of one person
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.la_request_help(uuid, text, text, jsonb);
create or replace function public.la_request_help(
  p_actor uuid, p_message text, p_section text, p_ctx jsonb, p_helper uuid default null)
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
  v_helper_name text;
begin
  perform public.la_expire();

  select * into v_existing from public.help_requests
  where requester_id = p_actor and status = 'open' order by created_at desc limit 1;
  if found then
    return jsonb_build_object('request_id', v_existing.id, 'already_open', true,
      'expires_at', v_existing.created_at + interval '15 minutes', 'helpers', '[]'::jsonb,
      'helper_id', v_existing.helper_id,
      'helper_name', (select m.full_name from public.staff_members m where m.user_id = v_existing.helper_id));
  end if;

  if p_helper is not null then
    if not public.la_may_help(p_helper, p_actor) then
      perform public.um_fail(403, 'That person cannot take Live Assist requests for you. Choose someone else, or anyone.');
    end if;
    select m.full_name into v_helper_name from public.staff_members m where m.user_id = p_helper;
  end if;

  if (select count(*) from public.help_requests
      where requester_id = p_actor and created_at > now() - interval '1 day') >= 10 then
    perform public.um_fail(429, 'You have asked for help many times today. Contact your administrator directly.');
  end if;

  insert into public.help_requests (requester_id, message, section, helper_id)
  values (p_actor, v_message, v_section, p_helper)
  returning id into v_id;

  -- The message itself stays out of the audit log: it is the person's own
  -- words, kept on the request only.
  perform public.um_audit(p_actor, p_actor, 'live_assist.help_requested', null, null, p_ctx,
    jsonb_strip_nulls(jsonb_build_object('help_request_id', v_id, 'section', v_section, 'helper_id', p_helper)));

  return jsonb_build_object(
    'request_id', v_id, 'already_open', false,
    'expires_at', now() + interval '15 minutes',
    'requester_name', v_actor.full_name, 'message', v_message, 'section', v_section,
    'helper_id', p_helper, 'helper_name', v_helper_name,
    'helpers', case when p_helper is null then to_jsonb(public.la_helpers_for(p_actor))
                    else jsonb_build_array(p_helper) end);
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
  return jsonb_build_object('cancelled', true, 'helpers',
    case when r.helper_id is null then to_jsonb(public.la_helpers_for(p_actor))
         else jsonb_build_array(r.helper_id) end);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Grants: the Worker (service role) only. Browsers keep reaching just
--    la_can_use_topic, through the Realtime policies.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('la_can_help', 'la_may_help', 'la_busy', 'la_helpers_for', 'la_my_helpers',
        'la_start', 'la_respond', 'la_state', 'la_request_help', 'la_cancel_help')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end
$$;

notify pgrst, 'reload schema';
