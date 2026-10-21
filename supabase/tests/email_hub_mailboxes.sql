-- Email Hub mailbox rules (20261021120000_email_hub_mailboxes.sql), checked
-- against the real functions with synthetic people. Run by
-- scripts/db/verify-local.sh; everything is rolled back at the end.
--
-- People:
--   owner   Owner (holds every business permission)        11111111-...
--   dev     developer (holds every permission)             22222222-...
--   admin   Admin role + Administrator template            33333333-...
--   sam     staff, granted email_inbox.view                44444444-...
--   ria     staff, granted email_inbox.view                55555555-...
--   noah    staff, no Email permission                     66666666-...
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'dev@example.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'admin@example.invalid'),
  ('44444444-4444-4444-8444-444444444444', 'sam@example.invalid'),
  ('55555555-5555-4555-8555-555555555555', 'ria@example.invalid'),
  ('66666666-6666-4666-8666-666666666666', 'noah@example.invalid');

insert into public.staff_members (user_id, full_name, system_role, developer_level, template_id) values
  ('11111111-1111-4111-8111-111111111111', 'Olive Owner', 'owner', null, null),
  ('22222222-2222-4222-8222-222222222222', 'Dev Developer', 'staff', 'developer', null),
  ('33333333-3333-4333-8333-333333333333', 'Ada Admin', 'admin', null,
     (select id from public.permission_templates where key = 'administrator')),
  ('44444444-4444-4444-8444-444444444444', 'Sam Sales', 'staff', null, null),
  ('55555555-5555-4555-8555-555555555555', 'Ria Support', 'staff', null, null),
  ('66666666-6666-4666-8666-666666666666', 'Noah Nobody', 'staff', null, null);

insert into public.staff_permission_overrides (user_id, permission_key, effect, scope) values
  ('44444444-4444-4444-8444-444444444444', 'email_inbox.view', 'grant', 'all'),
  ('55555555-5555-4555-8555-555555555555', 'email_inbox.view', 'grant', 'all'),
  ('55555555-5555-4555-8555-555555555555', 'clients.view', 'grant', 'all');

insert into auth.sessions (id, user_id) values
  ('aaaaaaaa-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444');

-- ── Personal mailbox: connect once, replay refused ────────────────────────
do $$
declare
  v jsonb;
begin
  perform public.em_begin_connect('44444444-4444-4444-8444-444444444444', null, repeat('a', 64), repeat('v', 43), '{}');
  v := public.em_take_state(repeat('a', 64));
  perform test.check(v ->> 'user_id' = '44444444-4444-4444-8444-444444444444', 'state returns its starter');
  perform test.check(public.em_take_state(repeat('a', 64)) is null, 'a state cannot be used twice');
  perform test.check(public.em_take_state(repeat('b', 64)) is null, 'an unknown state is refused');

  insert into public.email_oauth_states (state_hash, user_id, code_verifier, expires_at)
  values (repeat('c', 64), '44444444-4444-4444-8444-444444444444', repeat('v', 43), now() - interval '1 second');
  perform test.check(public.em_take_state(repeat('c', 64)) is null, 'an expired state is refused');

  v := public.em_store_connection('44444444-4444-4444-8444-444444444444', null, 'Sam@Example.invalid', 'google-sub-sam',
    'Sam Sales', 'k0000000000000000.iv.ciphertext', array['https://www.googleapis.com/auth/gmail.modify'], '{}');
  perform test.check(v ->> 'kind' = 'personal' and v ->> 'email_address' = 'sam@example.invalid', 'personal mailbox stored, address lower-cased');
  perform test.check(v ->> 'status' = 'connected', 'personal mailbox connected');
end
$$;

-- Noah has no Email permission: cannot even start.
select test.expect_error($$select public.em_begin_connect('66666666-6666-4666-8666-666666666666', null, repeat('d', 64), repeat('v', 43), '{}')$$,
  'PT403', 'no email_inbox.view, no connect');

-- Someone else cannot claim Sam's address as their own personal mailbox.
select test.expect_error($$select public.em_store_connection('55555555-5555-4555-8555-555555555555', null, 'sam@example.invalid', 'x',
  'x', 'k0000000000000000.iv.ciphertext', '{}', '{}')$$, 'PT409', 'address already connected by someone else');

-- ── Only members read; Owners and developers are not members ──────────────
do $$
declare
  v_acc uuid := (select id from public.email_accounts where email_address = 'sam@example.invalid');
  v jsonb;
begin
  v := public.em_access('44444444-4444-4444-8444-444444444444', v_acc, 'admin');
  perform test.check(v ->> 'role' = 'admin', 'owner of a personal mailbox is its admin');
  perform test.check(v ->> 'token_enc' is not null, 'Worker gets the encrypted token');
  perform test.expect_error(format($f$select public.em_access(%L, %L, 'viewer')$f$, '11111111-1111-4111-8111-111111111111', v_acc),
    'PT404', 'an Owner without membership cannot read');
  perform test.expect_error(format($f$select public.em_access(%L, %L, 'viewer')$f$, '22222222-2222-4222-8222-222222222222', v_acc),
    'PT404', 'a developer without membership cannot read');
  perform test.expect_error(format($f$select public.em_access(%L, %L, 'viewer')$f$, '33333333-3333-4333-8333-333333333333', v_acc),
    'PT404', 'an Admin with email_mailboxes.manage cannot read a personal mailbox');
  perform test.expect_error(format($f$select public.em_access(%L, %L, 'viewer')$f$, '66666666-6666-4666-8666-666666666666', v_acc),
    'PT403', 'no email_inbox.view');
end
$$;

-- ── Delegation of a personal mailbox: only by its owner ───────────────────
do $$
declare
  v_acc uuid := (select id from public.email_accounts where email_address = 'sam@example.invalid');
begin
  perform public.em_set_member('44444444-4444-4444-8444-444444444444', v_acc, '55555555-5555-4555-8555-555555555555', 'viewer', '{}');
  perform test.check(public.em_mailbox_role('55555555-5555-4555-8555-555555555555', v_acc) = 'viewer', 'owner delegated viewer');
  perform test.expect_error(format($f$select public.em_access(%L, %L, 'responder')$f$, '55555555-5555-4555-8555-555555555555', v_acc),
    'PT403', 'viewer cannot act as responder');

  perform test.expect_error(format($f$select public.em_set_member(%L, %L, %L, 'manager', '{}')$f$,
    '55555555-5555-4555-8555-555555555555', v_acc, '55555555-5555-4555-8555-555555555555'), 'PT403', 'no self-promotion');
  perform test.expect_error(format($f$select public.em_set_member(%L, %L, %L, 'viewer', '{}')$f$,
    '55555555-5555-4555-8555-555555555555', v_acc, '66666666-6666-4666-8666-666666666666'), 'PT403', 'a viewer cannot add people');
  perform test.expect_error(format($f$select public.em_set_member(%L, %L, %L, 'viewer', '{}')$f$,
    '11111111-1111-4111-8111-111111111111', v_acc, '11111111-1111-4111-8111-111111111111'), 'PT403', 'an Owner cannot add themselves');
  perform test.expect_error(format($f$select public.em_set_member(%L, %L, %L, 'viewer', '{}')$f$,
    '33333333-3333-4333-8333-333333333333', v_acc, '22222222-2222-4222-8222-222222222222'), 'PT404',
    'email_mailboxes.manage does not reach (or reveal) personal mailboxes');
  perform test.expect_error(format($f$select public.em_set_member(%L, %L, %L, 'viewer', '{}')$f$,
    '11111111-1111-4111-8111-111111111111', v_acc, '22222222-2222-4222-8222-222222222222'), 'PT404',
    'an Owner who is not a member does not even see the mailbox');
  perform test.expect_error(format($f$select public.em_set_member(%L, %L, %L, 'admin', '{}')$f$,
    '44444444-4444-4444-8444-444444444444', v_acc, '55555555-5555-4555-8555-555555555555'), 'PT400',
    'a personal mailbox has one admin');
  perform test.expect_error(format($f$select public.em_set_member(%L, %L, %L, null, '{}')$f$,
    '44444444-4444-4444-8444-444444444444', v_acc, '44444444-4444-4444-8444-444444444444'), 'PT400',
    'the owner cannot leave their own mailbox');

  perform test.check((select count(*) from public.audit_log where event_type = 'email_mailbox.member_added') = 1,
    'membership change audited');
end
$$;

-- ── Shared mailbox: created and managed without reading ───────────────────
do $$
declare
  v jsonb;
  v_acc uuid;
begin
  perform test.expect_error($f$select public.em_create_shared('44444444-4444-4444-8444-444444444444', 'sales@example.invalid', 'Sales', '{}')$f$,
    'PT403', 'shared mailboxes need email_mailboxes.manage');
  v := public.em_create_shared('33333333-3333-4333-8333-333333333333', ' Sales@Example.invalid ', 'Sales', '{}');
  v_acc := (v ->> 'id')::uuid;
  perform test.check(v ->> 'status' = 'pending', 'new shared mailbox waits for connection');
  perform test.check(public.em_mailbox_role('33333333-3333-4333-8333-333333333333', v_acc) is null, 'creating does not make you a member');
  perform test.expect_error($f$select public.em_create_shared('33333333-3333-4333-8333-333333333333', 'sales@example.invalid', 'Again', '{}')$f$,
    'PT409', 'duplicate address');

  perform public.em_begin_connect('33333333-3333-4333-8333-333333333333', v_acc, repeat('e', 64), repeat('v', 43), '{}');
  perform test.expect_error(format($f$select public.em_begin_connect(%L, %L, %L, %L, '{}')$f$,
    '44444444-4444-4444-8444-444444444444', v_acc, repeat('f', 64), repeat('v', 43)), 'PT403', 'only its admins connect a shared mailbox');
  perform test.expect_error(format($f$select public.em_store_connection(%L, %L, 'someone.else@example.invalid', 's', 'x', 'k0000000000000000.iv.ct', '{}', '{}')$f$,
    '33333333-3333-4333-8333-333333333333', v_acc), 'PT409', 'signed in as the wrong Google account');
  v := public.em_store_connection('33333333-3333-4333-8333-333333333333', v_acc, 'sales@example.invalid', 'google-sub-sales', 'Sales',
    'k0000000000000000.iv.ciphertext', '{}', '{}');
  perform test.check(v ->> 'status' = 'connected', 'shared mailbox connected');

  perform public.em_set_member('33333333-3333-4333-8333-333333333333', v_acc, '44444444-4444-4444-8444-444444444444', 'responder', '{}');
  perform public.em_set_member('33333333-3333-4333-8333-333333333333', v_acc, '55555555-5555-4555-8555-555555555555', 'admin', '{}');
  -- Ria, an admin of the mailbox, may add others.
  perform public.em_set_member('55555555-5555-4555-8555-555555555555', v_acc, '66666666-6666-4666-8666-666666666666', 'viewer', '{}');
  perform test.expect_error(format($f$select public.em_access(%L, %L, 'viewer')$f$, '66666666-6666-4666-8666-666666666666', v_acc),
    'PT403', 'membership alone is not enough without email_inbox.view');

  v := public.em_list_accounts('22222222-2222-4222-8222-222222222222');
  perform test.check(jsonb_array_length(v -> 'mailboxes') = 0, 'a developer sees no mailboxes to read');
  perform test.check(jsonb_array_length(v -> 'shared_setup') = 1, 'a developer sees shared mailbox configuration');
  v := public.em_list_accounts('44444444-4444-4444-8444-444444444444');
  perform test.check(jsonb_array_length(v -> 'mailboxes') = 2, 'sam sees his own and the shared mailbox');
  perform test.check(jsonb_array_length(v -> 'shared_setup') = 0, 'sam cannot see shared setup');
end
$$;

-- ── Threads, workflow, notes and CRM ──────────────────────────────────────
do $$
declare
  v_shared uuid := (select id from public.email_accounts where email_address = 'sales@example.invalid');
  v_personal uuid := (select id from public.email_accounts where email_address = 'sam@example.invalid');
  v_thread uuid;
  v jsonb;
begin
  perform test.check(public.em_upsert_threads(v_shared, jsonb_build_array(
    jsonb_build_object('id', '18c0a1', 'subject', 'Hoarding quote', 'last_message_at', '2026-10-20T10:00:00Z',
      'participants', jsonb_build_array(jsonb_build_object('name', 'Buyer', 'email', 'Buyer@Client.example')),
      'message_count', 2, 'unread', true, 'label_ids', array['INBOX', 'UNREAD']),
    jsonb_build_object('id', '18c0a2', 'subject', 'Old thread', 'last_message_at', '2026-10-01T10:00:00Z',
      'participants', '[]'::jsonb, 'label_ids', array['SENT']),
    jsonb_build_object('id', 'NOT-HEX', 'subject', 'ignored', 'last_message_at', '2026-10-01T10:00:00Z')
  )) = 2, 'upsert takes valid ids only');
  perform public.em_upsert_threads(v_personal, jsonb_build_array(
    jsonb_build_object('id', '18c0b1', 'subject', 'Personal note to self', 'last_message_at', '2026-10-19T10:00:00Z',
      'label_ids', array['INBOX'])));

  v := public.em_list_threads('44444444-4444-4444-8444-444444444444', '{}');
  perform test.check(jsonb_array_length(v -> 'threads') = 2, 'inbox across both of sam''s mailboxes');
  v := public.em_list_threads('44444444-4444-4444-8444-444444444444', jsonb_build_object('folder', 'sent'));
  perform test.check(jsonb_array_length(v -> 'threads') = 1, 'sent folder');
  v := public.em_list_threads('44444444-4444-4444-8444-444444444444', jsonb_build_object('search', 'HOARD'));
  perform test.check(jsonb_array_length(v -> 'threads') = 1, 'search is case-insensitive');
  v := public.em_list_threads('44444444-4444-4444-8444-444444444444', jsonb_build_object('search', '%'));
  perform test.check(jsonb_array_length(v -> 'threads') = 0, 'search wildcards are literal');
  v := public.em_list_threads('44444444-4444-4444-8444-444444444444', jsonb_build_object('limit', 1));
  perform test.check(jsonb_array_length(v -> 'threads') = 1 and (v ->> 'has_more')::boolean, 'pages');
  v := public.em_list_threads('44444444-4444-4444-8444-444444444444', jsonb_build_object('limit', 1,
    'before_at', v -> 'threads' -> 0 ->> 'last_message_at', 'before_id', v -> 'threads' -> 0 ->> 'id'));
  perform test.check(jsonb_array_length(v -> 'threads') = 1 and not (v ->> 'has_more')::boolean, 'second page');

  v := public.em_list_threads('11111111-1111-4111-8111-111111111111', '{}');
  perform test.check(jsonb_array_length(v -> 'threads') = 0, 'an Owner lists nothing without membership');
  perform test.expect_error(format($f$select public.em_list_threads(%L, %L)$f$, '11111111-1111-4111-8111-111111111111',
    jsonb_build_object('account', v_shared)), 'PT404', 'an Owner cannot name a mailbox to list');
  perform test.expect_error(format($f$select public.em_list_threads(%L, '{}')$f$, '66666666-6666-4666-8666-666666666666'),
    'PT403', 'no email_inbox.view, no list');

  v_thread := (select id from public.email_threads where gmail_thread_id = '18c0a1');
  perform test.expect_error(format($f$select public.em_open_thread(%L, %L, 'viewer')$f$, '22222222-2222-4222-8222-222222222222', v_thread),
    'PT404', 'a developer cannot open a thread');
  v := public.em_open_thread('44444444-4444-4444-8444-444444444444', v_thread, 'viewer');
  perform test.check(v -> 'thread' ->> 'subject' = 'Hoarding quote', 'member opens thread');
  perform test.check(jsonb_array_length(v -> 'assignable') = 2, 'responders and above can be assigned');

  -- Sam (responder) may take the thread, not hand it to Ria.
  perform test.expect_error(format($f$select public.em_update_thread(%L, %L, %L, '{}')$f$, '44444444-4444-4444-8444-444444444444', v_thread,
    jsonb_build_object('assigned_to', '55555555-5555-4555-8555-555555555555')), 'PT403', 'a responder cannot assign others');
  v := public.em_update_thread('44444444-4444-4444-8444-444444444444', v_thread, jsonb_build_object('assigned_to', '44444444-4444-4444-8444-444444444444', 'workflow_status', 'pending'), '{}');
  perform test.check(v ->> 'assigned_to' = '44444444-4444-4444-8444-444444444444' and v ->> 'workflow_status' = 'pending', 'self-assign');
  perform test.expect_error(format($f$select public.em_update_thread(%L, %L, %L, '{}')$f$, '55555555-5555-4555-8555-555555555555', v_thread,
    jsonb_build_object('assigned_to', '66666666-6666-4666-8666-666666666666')), 'PT400', 'a viewer cannot be assigned');
  perform test.expect_error(format($f$select public.em_update_thread(%L, %L, %L, '{}')$f$, '55555555-5555-4555-8555-555555555555', v_thread,
    jsonb_build_object('workflow_status', null)), 'PT400', 'status cannot be emptied');

  -- Ria (mailbox admin) takes it over; Sam can neither take it back nor drop it.
  perform public.em_update_thread('55555555-5555-4555-8555-555555555555', v_thread, jsonb_build_object('assigned_to', '55555555-5555-4555-8555-555555555555'), '{}');
  perform test.expect_error(format($f$select public.em_update_thread(%L, %L, %L, '{}')$f$, '44444444-4444-4444-8444-444444444444', v_thread,
    jsonb_build_object('assigned_to', null)), 'PT403', 'a responder cannot unassign someone else');
  perform test.expect_error(format($f$select public.em_update_thread(%L, %L, %L, '{}')$f$, '44444444-4444-4444-8444-444444444444', v_thread,
    jsonb_build_object('assigned_to', '44444444-4444-4444-8444-444444444444')), 'PT403', 'a responder cannot take a held thread');
  perform public.em_update_thread('55555555-5555-4555-8555-555555555555', v_thread, jsonb_build_object('assigned_to', '44444444-4444-4444-8444-444444444444'), '{}');
  perform test.expect_error(format($f$select public.em_begin_connect(%L, %L, %L, %L, '{}')$f$,
    '44444444-4444-4444-8444-444444444444', v_shared, repeat('9', 64), repeat('v', 43)), 'PT403', 'a responder cannot reconnect a shared mailbox');
  perform test.expect_error(format($f$select public.em_set_member(%L, %L, null, 'viewer', '{}')$f$,
    '55555555-5555-4555-8555-555555555555', v_shared), 'PT400', 'a member must be named');
  perform test.check(label_ids = array['INBOX', 'UNREAD'], 'workflow never touched Gmail labels')
    from public.email_threads where id = v_thread;

  v := public.em_add_note('44444444-4444-4444-8444-444444444444', v_thread, '  Called them, sending rates  ');
  perform test.check(v ->> 'body' = 'Called them, sending rates', 'note trimmed and stored');
  perform test.expect_error(format($f$select public.em_add_note(%L, %L, '')$f$, '44444444-4444-4444-8444-444444444444', v_thread),
    'PT400', 'empty note');

  insert into public.clients (company_name, email) values ('Client Co', 'buyer@client.example');
  v := public.em_thread_crm('44444444-4444-4444-8444-444444444444', v_thread);
  perform test.check(jsonb_array_length(v -> 'records') = 0, 'no clients.view: no client records');
  v := public.em_thread_crm('55555555-5555-4555-8555-555555555555', v_thread);
  perform test.check(jsonb_array_length(v -> 'records') = 1 and v -> 'records' -> 0 ->> 'type' = 'client', 'suggested by participant address');
  perform test.expect_error(format($f$select public.em_link(%L, %L, 'client', %L, true)$f$, '44444444-4444-4444-8444-444444444444', v_thread,
    (v -> 'records' -> 0 ->> 'id')), 'PT403', 'linking needs the record''s view permission');
  v := public.em_link('55555555-5555-4555-8555-555555555555', v_thread, 'client', v -> 'records' -> 0 ->> 'id', true);
  perform test.check((v -> 'records' -> 0 ->> 'linked')::boolean, 'linked');
  perform test.expect_error(format($f$select public.em_link(%L, %L, 'client', '999999', true)$f$, '55555555-5555-4555-8555-555555555555', v_thread),
    'PT404', 'cannot link a missing record');

  -- Suggestions: participants of your own mailboxes; clients only with clients.view.
  v := public.em_suggest_recipients('44444444-4444-4444-8444-444444444444', 'buyer');
  perform test.check(jsonb_array_length(v) = 1 and v -> 0 ->> 'source' = 'recent', 'sam sees the participant, not the client record');
  v := public.em_suggest_recipients('55555555-5555-4555-8555-555555555555', 'client co');
  perform test.check(jsonb_array_length(v) = 1 and v -> 0 ->> 'source' = 'client', 'ria (clients.view) finds the client');
  v := public.em_suggest_recipients('11111111-1111-4111-8111-111111111111', 'buyer');
  perform test.check(not exists (select 1 from jsonb_array_elements(v) e where e ->> 'source' = 'recent'),
    'an Owner does not see participants of mailboxes they are not in');
  perform test.check(jsonb_array_length(public.em_suggest_recipients('44444444-4444-4444-8444-444444444444', 'b')) = 0, 'two characters minimum');

  -- Removing Sam clears his assignment.
  perform public.em_set_member('55555555-5555-4555-8555-555555555555', v_shared, '44444444-4444-4444-8444-444444444444', null, '{}');
  perform test.check((select assigned_to from public.email_threads where id = v_thread) is null, 'removed member loses assignments');
  perform test.expect_error(format($f$select public.em_open_thread(%L, %L, 'viewer')$f$, '44444444-4444-4444-8444-444444444444', v_thread),
    'PT404', 'removed member cannot open the thread');
end
$$;

-- ── Sends, sync, push and disconnect ──────────────────────────────────────
do $$
declare
  v_personal uuid := (select id from public.email_accounts where email_address = 'sam@example.invalid');
  v jsonb;
begin
  v := public.em_begin_send('44444444-4444-4444-8444-444444444444', v_personal, 'bbbbbbbb-0000-4000-8000-000000000001');
  perform test.check(not (v ->> 'duplicate')::boolean, 'first send attempt');
  v := public.em_begin_send('44444444-4444-4444-8444-444444444444', v_personal, 'bbbbbbbb-0000-4000-8000-000000000001');
  perform test.check((v ->> 'duplicate')::boolean and v ->> 'status' = 'sending', 'same id is a duplicate, not a second send');
  perform public.em_finish_send('bbbbbbbb-0000-4000-8000-000000000001', 'sent', '18c0ff', '18c0b1', null);
  perform test.expect_error(format($f$select public.em_begin_send(%L, %L, %L)$f$, '55555555-5555-4555-8555-555555555555', v_personal,
    'bbbbbbbb-0000-4000-8000-000000000002'), 'PT403', 'a viewer cannot send');

  v := public.em_claim_sync(v_personal, 60);
  perform test.check(v ->> 'token_enc' is not null and (v ->> 'needs_full_sync')::boolean, 'claim returns work');
  perform test.check(public.em_claim_sync(v_personal, 60) is null, 'a held lease blocks a second run');
  perform public.em_finish_sync(v_personal, '12345', true, null, now() + interval '7 days');
  perform test.check(public.em_push_target('SAM@example.invalid', '12345') is null, 'a push with known history is ignored');
  perform test.check(public.em_push_target('sam@example.invalid', '12346') = v_personal, 'a push with new history is accepted');
  perform public.em_finish_sync(v_personal, '100', false, null, null);
  perform test.check((select history_id from public.email_accounts where id = v_personal) = 12345, 'history never moves backwards');

  -- The owner is suspended: their personal mailbox closes for delegates too.
  update public.staff_members set status = 'suspended' where user_id = '44444444-4444-4444-8444-444444444444';
  perform test.check(public.em_mailbox_role('55555555-5555-4555-8555-555555555555', v_personal) is null, 'delegate loses a suspended owner''s mailbox');
  perform test.check(public.em_claim_sync(v_personal, 60) is null, 'a suspended owner''s mailbox is not synced');
  update public.staff_members set status = 'active' where user_id = '44444444-4444-4444-8444-444444444444';

  perform test.expect_error(format($f$select public.em_disconnect(%L, %L, false, '{}')$f$, '55555555-5555-4555-8555-555555555555', v_personal),
    'PT403', 'a delegate cannot disconnect');
  v := public.em_disconnect('44444444-4444-4444-8444-444444444444', v_personal, false, '{}');
  perform test.check(v ->> 'token_enc' is not null, 'disconnect hands back the token to revoke');
  perform test.check(not exists (select 1 from public.email_oauth_credentials where account_id = v_personal), 'token deleted');
  perform test.expect_error(format($f$select public.em_begin_send(%L, %L, %L)$f$, '44444444-4444-4444-8444-444444444444', v_personal,
    'bbbbbbbb-0000-4000-8000-000000000003'), 'PT409', 'a disconnected mailbox cannot send');
  perform test.check((select count(*) from public.audit_log where event_type = 'email_mailbox.disconnected') = 1, 'disconnect audited');
end
$$;

-- ── Browser roles have no way in ──────────────────────────────────────────
select test.act_as('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-0000-4000-8000-000000000004');
select test.expect_error('select count(*) from public.email_threads', '42501', 'signed-in staff cannot read threads directly');
select test.expect_error('select count(*) from public.email_oauth_credentials', '42501', 'signed-in staff cannot read tokens');
select test.expect_error('select count(*) from public.email_account_members', '42501', 'signed-in staff cannot read members');
select test.expect_error($$select public.em_list_accounts('44444444-4444-4444-8444-444444444444')$$, '42501', 'signed-in staff cannot call em_*');
select test.expect_error($$insert into public.email_account_members (account_id, user_id, role)
  select id, '44444444-4444-4444-8444-444444444444', 'admin' from public.email_accounts limit 1$$, '42501', 'no self-grant through the table');
reset role;
select test.act_as_anon();
select test.expect_error('select count(*) from public.email_accounts', '42501', 'anon cannot read mailboxes');
select test.expect_error($$select public.em_take_state(repeat('a', 64))$$, '42501', 'anon cannot call em_*');
reset role;

rollback;
