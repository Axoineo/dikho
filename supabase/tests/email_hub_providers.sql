-- Email Hub providers, the Hostinger message index and campaigns through a
-- connected mailbox (20261027120000_email_hub_providers.sql), checked
-- against the real functions with synthetic people and messages. Run by
-- scripts/db/verify-local.sh; everything is rolled back at the end.
--
--   admin     staff: email_mailboxes.manage + email_inbox.view   b3333333-...
--   sam       staff: email_inbox.view (signs in as sam@...)      b4444444-...
--   ria       staff: email_inbox.view, email_campaigns.create    b5555555-...
--   noah      staff: nothing                                     b6666666-...
--   owner     Owner: every business permission                   b7777777-...
--   maker     staff: email_campaigns.create, clients.view, email_inbox.view  b1111111-...
--   approver  staff: email_campaigns.approve, clients.view       b2222222-...
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('b1111111-1111-4111-8111-111111111111', 'maker@example.invalid'),
  ('b2222222-2222-4222-8222-222222222222', 'approver@example.invalid'),
  ('b3333333-3333-4333-8333-333333333333', 'admin@example.invalid'),
  ('b4444444-4444-4444-8444-444444444444', 'sam@example.invalid'),
  ('b5555555-5555-4555-8555-555555555555', 'ria@example.invalid'),
  ('b6666666-6666-4666-8666-666666666666', 'noah@example.invalid'),
  ('b7777777-7777-4777-8777-777777777777', 'owner@example.invalid');
insert into public.staff_members (user_id, full_name, system_role) values
  ('b1111111-1111-4111-8111-111111111111', 'Maya Maker', 'staff'),
  ('b2222222-2222-4222-8222-222222222222', 'Arun Approver', 'staff'),
  ('b3333333-3333-4333-8333-333333333333', 'Ada Admin', 'staff'),
  ('b4444444-4444-4444-8444-444444444444', 'Sam Sales', 'staff'),
  ('b5555555-5555-4555-8555-555555555555', 'Ria Support', 'staff'),
  ('b6666666-6666-4666-8666-666666666666', 'Noah Nobody', 'staff'),
  ('b7777777-7777-4777-8777-777777777777', 'Olive Owner', 'owner');
insert into public.staff_permission_overrides (user_id, permission_key, effect, scope) values
  ('b3333333-3333-4333-8333-333333333333', 'email_mailboxes.manage', 'grant', 'all'),
  ('b3333333-3333-4333-8333-333333333333', 'email_inbox.view', 'grant', 'all'),
  ('b4444444-4444-4444-8444-444444444444', 'email_inbox.view', 'grant', 'all'),
  ('b5555555-5555-4555-8555-555555555555', 'email_inbox.view', 'grant', 'all'),
  ('b5555555-5555-4555-8555-555555555555', 'email_campaigns.create', 'grant', 'all'),
  ('b5555555-5555-4555-8555-555555555555', 'clients.view', 'grant', 'all'),
  ('b1111111-1111-4111-8111-111111111111', 'email_campaigns.create', 'grant', 'all'),
  ('b1111111-1111-4111-8111-111111111111', 'clients.view', 'grant', 'all'),
  ('b1111111-1111-4111-8111-111111111111', 'email_inbox.view', 'grant', 'all'),
  ('b2222222-2222-4222-8222-222222222222', 'email_campaigns.approve', 'grant', 'all'),
  ('b2222222-2222-4222-8222-222222222222', 'clients.view', 'grant', 'all');

-- ── The provider is explicit and limited to known providers ───────────────
select test.expect_error($$insert into public.email_accounts (kind, provider, email_address, created_by)
  values ('shared', 'outlook', 'x@example.invalid', 'b3333333-3333-4333-8333-333333333333')$$, '23514', 'unknown provider refused');
select test.expect_error($$insert into public.email_accounts (kind, provider, email_address, provider_account_id, created_by)
  values ('shared', 'hostinger', 'y@example.invalid', 'bad id/../', 'b3333333-3333-4333-8333-333333333333')$$, '23514', 'resource id format checked');

-- ── Connecting Hostinger mailboxes ────────────────────────────────────────
do $$
declare
  v jsonb;
  v_shared uuid;
  v_google uuid;
  v_list jsonb := '[{"resourceId":"MBX_contact_1","address":"Contact@Example.invalid"},{"resourceId":"MBX_sam_2","address":"sam@example.invalid"}]';
begin
  v := public.em_create_shared('b3333333-3333-4333-8333-333333333333', 'contact@example.invalid', 'Contact', '{}', 'hostinger');
  v_shared := (v ->> 'id')::uuid;
  perform test.check(v ->> 'provider' = 'hostinger' and v ->> 'status' = 'pending', 'shared Hostinger mailbox created pending');
  v := public.em_create_shared('b3333333-3333-4333-8333-333333333333', 'team@example.invalid', 'Team', '{}');
  v_google := (v ->> 'id')::uuid;
  perform test.check(v ->> 'provider' = 'google', 'without a provider, shared mailboxes are Google as before');
  perform test.expect_error($f$select public.em_create_shared('b3333333-3333-4333-8333-333333333333', 'z@example.invalid', null, '{}', 'outlook')$f$, 'PT400', 'unknown provider refused on create');

  perform test.expect_error(format($f$select public.em_connect_hostinger(%L, %L, %L, null, '{}')$f$,
    'b4444444-4444-4444-8444-444444444444', v_shared, v_list), 'PT403', 'only its configurers connect a shared mailbox');
  perform test.expect_error(format($f$select public.em_connect_hostinger(%L, %L, %L, null, '{}')$f$,
    'b3333333-3333-4333-8333-333333333333', v_shared, '[{"resourceId":"MBX_other","address":"other@example.invalid"}]'), 'PT409', 'a mailbox the token does not cover is refused');
  perform test.expect_error(format($f$select public.em_connect_hostinger(%L, %L, %L, null, '{}')$f$,
    'b3333333-3333-4333-8333-333333333333', v_google, v_list), 'PT409', 'a Google mailbox is not connected through Hostinger');

  v := public.em_connect_hostinger('b3333333-3333-4333-8333-333333333333', v_shared, v_list, null, '{}');
  perform test.check(v ->> 'status' = 'connected' and not (v ? 'provider_account_id'), 'connected; resource id not in the mailbox JSON');
  perform test.check((select provider_account_id from public.email_accounts where id = v_shared) = 'MBX_contact_1', 'resource id taken from the token''s list');
  perform test.check(exists (select 1 from public.audit_log where event_type = 'email_mailbox.connected'
    and metadata ->> 'account_id' = v_shared::text and new_value ->> 'provider' = 'hostinger'), 'connection audited');

  -- Google sign-in cannot be attached to a Hostinger mailbox.
  perform test.expect_error(format($f$select public.em_begin_connect(%L, %L, %L, %L, '{}')$f$,
    'b3333333-3333-4333-8333-333333333333', v_shared, repeat('c', 64), repeat('v', 43)), 'PT409', 'no Google consent for a Hostinger mailbox');
  perform test.expect_error(format($f$select public.em_store_connection(%L, %L, 'contact@example.invalid', 'g-sub', null, 'k1.x.yyyyyyyyyyyyyyyy', '{}', '{}')$f$,
    'b3333333-3333-4333-8333-333333333333', v_shared), 'PT409', 'no Google token stored on a Hostinger mailbox');

  -- Setting a mailbox up does not open it, for the admin or for an Owner.
  perform test.expect_error(format($f$select public.em_access(%L, %L, 'viewer')$f$, 'b3333333-3333-4333-8333-333333333333', v_shared), 'PT404', 'the admin who connected it cannot read it');
  perform test.expect_error(format($f$select public.em_access(%L, %L, 'viewer')$f$, 'b7777777-7777-4777-8777-777777777777', v_shared), 'PT404', 'an Owner without membership cannot read it');
end
$$;

-- ── Personal Hostinger mailbox: only your own sign-in address ─────────────
do $$
declare
  v jsonb;
  v_list jsonb := '[{"resourceId":"MBX_sam_2","address":"sam@example.invalid"}]';
begin
  perform test.expect_error(format($f$select public.em_connect_hostinger(%L, null, %L, null, '{}')$f$,
    'b5555555-5555-4555-8555-555555555555', v_list), 'PT409', 'Ria cannot connect anything the token lists but her own address');
  perform test.expect_error(format($f$select public.em_connect_hostinger(%L, null, %L, null, '{}')$f$,
    'b6666666-6666-4666-8666-666666666666', '[{"resourceId":"MBX_noah","address":"noah@example.invalid"}]'), 'PT403', 'without email_inbox.view, nothing');
  v := public.em_connect_hostinger('b4444444-4444-4444-8444-444444444444', null, v_list, null, '{}');
  perform test.check(v ->> 'kind' = 'personal' and v ->> 'owner_id' = 'b4444444-4444-4444-8444-444444444444' and v ->> 'provider' = 'hostinger', 'Sam''s personal Hostinger mailbox');
  perform test.check((public.em_access('b4444444-4444-4444-8444-444444444444', (v ->> 'id')::uuid, 'admin') ->> 'provider_account_id') = 'MBX_sam_2',
    'the Worker gets the resource id through em_access');
  perform test.expect_error(format($f$select public.em_connect_hostinger(%L, null, %L, null, '{}')$f$,
    'b3333333-3333-4333-8333-333333333333', '[{"resourceId":"MBX_sam_2","address":"admin@example.invalid"}]'), 'PT409', 'one Hostinger mailbox, one entry');
end
$$;

-- ── Message index and derived conversations ───────────────────────────────
do $$
declare
  v_box uuid := (select id from public.email_accounts where email_address = 'contact@example.invalid');
  v jsonb;
  v_key text;
  v_thread uuid;
  m jsonb := '{"sender":{"name":"Client","email":"client@example.invalid"},"recipients":[{"email":"contact@example.invalid","kind":"to"}]}';
begin
  -- a (inbox) <- b (sent, answers a) <- c (inbox, answers b); d: same subject, unrelated.
  v := public.em_hostinger_sync(v_box, jsonb_build_array(
    jsonb_build_object('folder', 'INBOX', 'role', 'inbox', 'min_uid', 1, 'messages', jsonb_build_array(
      m || '{"uid":10,"sent_at":"2026-10-20T09:00:00Z","subject":"Quote","message_id":"<a@x>","unseen":false}',
      m || '{"uid":11,"sent_at":"2026-10-22T09:00:00Z","subject":"Re: Quote","message_id":"<c@x>","in_reply_to":"<b@x>","unseen":true}',
      m || '{"uid":12,"sent_at":"2026-10-23T09:00:00Z","subject":"Re: Quote","message_id":"<d@x>","unseen":false,"attachments":[{"id":"att1","filename":"po.pdf","inline":false}]}')),
    jsonb_build_object('folder', 'INBOX.Sent', 'role', 'sent', 'min_uid', 1, 'messages', jsonb_build_array(
      '{"uid":5,"sent_at":"2026-10-21T09:00:00Z","subject":"Re: Quote","message_id":"<b@x>","in_reply_to":"<a@x>","sender":{"email":"contact@example.invalid"},"recipients":[{"email":"client@example.invalid","kind":"to"},{"email":"boss@example.invalid","kind":"bcc"}]}'::jsonb))));
  perform test.check((v ->> 'added')::int = 4, 'four messages indexed');
  v_key := (select thread_key from public.email_provider_messages where account_id = v_box and rfc_message_id = '<a@x>');
  perform test.check((select count(distinct thread_key) from public.email_provider_messages where account_id = v_box and rfc_message_id in ('<a@x>', '<b@x>', '<c@x>')) = 1,
    'a reply chain across inbox and sent is one conversation');
  perform test.check((select thread_key from public.email_provider_messages where account_id = v_box and rfc_message_id = '<d@x>') <> v_key,
    'the same subject alone never joins a conversation');
  select id into v_thread from public.email_threads where account_id = v_box and gmail_thread_id = v_key;
  perform test.check((select message_count = 3 and unread and subject = 'Quote' and label_ids @> array['INBOX', 'SENT', 'UNREAD']
                      and 'boss@example.invalid' = any (participant_emails)
                      from public.email_threads where id = v_thread), 'thread summary derived from its messages');
  perform test.check((select has_attachments from public.email_threads where account_id = v_box
                      and gmail_thread_id = (select thread_key from public.email_provider_messages where rfc_message_id = '<d@x>')), 'attachment flag');

  -- A reply that arrives before the message it answers: the answered one joins it.
  perform public.em_hostinger_sync(v_box, jsonb_build_array(jsonb_build_object('folder', 'INBOX', 'role', 'inbox', 'min_uid', 13, 'messages',
    jsonb_build_array(m || '{"uid":13,"sent_at":"2026-10-25T09:00:00Z","subject":"Re: Rates","message_id":"<f@x>","in_reply_to":"<e@x>"}'))));
  perform public.em_hostinger_sync(v_box, jsonb_build_array(jsonb_build_object('folder', 'INBOX.Sent', 'role', 'sent', 'min_uid', 6, 'messages',
    jsonb_build_array('{"uid":6,"sent_at":"2026-10-24T09:00:00Z","subject":"Rates","message_id":"<e@x>","sender":{"email":"contact@example.invalid"}}'::jsonb))));
  perform test.check((select count(distinct thread_key) from public.email_provider_messages where account_id = v_box and rfc_message_id in ('<e@x>', '<f@x>')) = 1,
    'a late parent joins the reply''s conversation');

  -- Flags change in place; a message gone from the listed range is dropped.
  perform public.em_hostinger_sync(v_box, jsonb_build_array(jsonb_build_object('folder', 'INBOX', 'role', 'inbox', 'min_uid', 11, 'messages', jsonb_build_array(
    m || '{"uid":12,"sent_at":"2026-10-23T09:00:00Z","subject":"Re: Quote","message_id":"<d@x>","unseen":false,"flagged":true}',
    m || '{"uid":13,"sent_at":"2026-10-25T09:00:00Z","subject":"Re: Rates","message_id":"<f@x>","in_reply_to":"<e@x>"}'))));
  perform test.check(not exists (select 1 from public.email_provider_messages where account_id = v_box and folder = 'INBOX' and uid = 11), 'uid 11 left the inbox');
  perform test.check(exists (select 1 from public.email_provider_messages where account_id = v_box and folder = 'INBOX' and uid = 10), 'uid 10 is below the listed range and kept');
  perform test.check((select message_count = 2 and not unread from public.email_threads where id = v_thread), 'the thread follows');
  perform test.check((select starred from public.email_threads where account_id = v_box
                      and gmail_thread_id = (select thread_key from public.email_provider_messages where rfc_message_id = '<d@x>')), 'flagged is starred');

  -- A renumbered folder: same UID, different message.
  perform public.em_hostinger_sync(v_box, jsonb_build_array(jsonb_build_object('folder', 'INBOX', 'role', 'inbox', 'min_uid', 12, 'messages', jsonb_build_array(
    m || '{"uid":12,"sent_at":"2026-10-26T09:00:00Z","subject":"New","message_id":"<g@x>"}',
    m || '{"uid":13,"sent_at":"2026-10-25T09:00:00Z","subject":"Re: Rates","message_id":"<f@x>","in_reply_to":"<e@x>"}'))));
  perform test.check((select rfc_message_id from public.email_provider_messages where account_id = v_box and folder = 'INBOX' and uid = 12) = '<g@x>', 'renumbered UID replaced');
  perform test.check((select gmail_deleted_at is not null from public.email_threads where account_id = v_box
                      and gmail_thread_id = left(encode(extensions.digest(convert_to('<d@x>', 'UTF8'), 'sha256'), 'hex'), 32)), 'a conversation left without messages is hidden');

  -- An empty folder empties the index for it.
  perform public.em_hostinger_sync(v_box, '[{"folder":"INBOX.Sent","role":"sent","min_uid":null,"messages":[]}]');
  perform test.check(not exists (select 1 from public.email_provider_messages where account_id = v_box and folder = 'INBOX.Sent'), 'empty folder');

  -- Bounds and provider.
  perform test.expect_error(format($f$select public.em_hostinger_sync(%L, '[{},{},{},{},{},{}]')$f$, v_box), 'PT400', 'at most five folders');
  perform test.expect_error(format($f$select public.em_hostinger_sync(%L, '[{"folder":"INBOX","role":"trash","messages":[]}]')$f$, v_box), 'PT400', 'only inbox, sent and archive');
  perform test.expect_error(format($f$select public.em_hostinger_sync(%L, '[]')$f$,
    (select id from public.email_accounts where email_address = 'team@example.invalid')), 'PT400', 'not for Google mailboxes');
end
$$;

-- ── Opening a Hostinger conversation; flags from Dikho ────────────────────
do $$
declare
  v_box uuid := (select id from public.email_accounts where email_address = 'contact@example.invalid');
  v_thread uuid;
  v jsonb;
  v_msg uuid;
begin
  -- Ria is added by the admin; the admin still cannot add themselves.
  perform public.em_set_member('b3333333-3333-4333-8333-333333333333', v_box, 'b5555555-5555-4555-8555-555555555555', 'responder', '{}');
  perform test.expect_error(format($f$select public.em_set_member(%L, %L, %L, 'viewer', '{}')$f$,
    'b3333333-3333-4333-8333-333333333333', v_box, 'b3333333-3333-4333-8333-333333333333'), 'PT403', 'no self-grant on a Hostinger mailbox either');

  select t.id into v_thread from public.email_threads t
  where t.account_id = v_box and t.gmail_thread_id = (select thread_key from public.email_provider_messages where rfc_message_id = '<a@x>');
  v := public.em_open_thread('b5555555-5555-4555-8555-555555555555', v_thread, 'viewer');
  perform test.check(jsonb_array_length(v -> 'provider_messages') = 1 and v -> 'provider_messages' -> 0 ->> 'folder' = 'INBOX', 'indexed messages for the Worker');
  perform test.expect_error(format($f$select public.em_open_thread(%L, %L, 'viewer')$f$, 'b4444444-4444-4444-8444-444444444444', v_thread), 'PT404', 'a non-member cannot open it');

  v_msg := (v -> 'provider_messages' -> 0 ->> 'id')::uuid;
  perform public.em_hostinger_set_flags(v_box, array[v_msg], true, true);
  perform test.check((select unread and starred from public.email_threads where id = v_thread), 'flags recorded and the thread refreshed');
end
$$;

-- ── Campaigns through a connected mailbox ────────────────────────────────
insert into public.clients (company_name, contact_person, email, city, country, status) values
  ('Alpha Co', 'Ami', 'ami@alpha.example', 'Delhi', 'India', 1),
  ('Beta Co', 'Ben', 'ben@beta.example', 'Delhi', 'India', 1);
select public.em_set_preference('b7777777-7777-4777-8777-777777777777', 'ami@alpha.example', '{"marketing":"subscribed","source":"form"}', '{}');
select public.em_set_preference('b7777777-7777-4777-8777-777777777777', 'ben@beta.example', '{"marketing":"subscribed","source":"form"}', '{}');

do $$
declare
  v_box uuid := (select id from public.email_accounts where email_address = 'contact@example.invalid');
  v jsonb;
  v_id uuid;
  v_ses uuid;
  v_hash text;
begin
  -- Allowed for campaigns only by its configurers, and only with a limit.
  perform test.expect_error(format($f$select public.em_set_campaign_sender(%L, %L, true, 10, '{}')$f$,
    'b5555555-5555-4555-8555-555555555555', v_box), 'PT403', 'a responder cannot allow campaigns');
  perform test.expect_error(format($f$select public.em_set_campaign_sender(%L, %L, true, null, '{}')$f$,
    'b3333333-3333-4333-8333-333333333333', v_box), 'PT400', 'a limit is required');
  v := public.em_set_campaign_sender('b3333333-3333-4333-8333-333333333333', v_box, true, 1, '{}');
  perform test.check((v ->> 'campaign_sender')::boolean and (v ->> 'campaign_daily_cap')::int = 1, 'allowed with a limit of one a day');
  perform test.check(exists (select 1 from public.audit_log where event_type = 'email_mailbox.campaign_sender' and metadata ->> 'account_id' = v_box::text), 'audited');

  -- Only people who may send from it see it, or can choose it.
  perform test.check(jsonb_array_length(public.em_campaign_senders('b1111111-1111-4111-8111-111111111111')) = 0, 'not offered to a non-member');
  perform test.expect_error(format($f$select public.em_save_campaign(%L, null, %L, '{}')$f$, 'b1111111-1111-4111-8111-111111111111',
    jsonb_build_object('name', 'X', 'sender_account_id', v_box)), 'PT403', 'a non-member cannot choose the mailbox');
  perform public.em_set_member('b3333333-3333-4333-8333-333333333333', v_box, 'b1111111-1111-4111-8111-111111111111', 'responder', '{}');
  perform test.check(public.em_campaign_senders('b1111111-1111-4111-8111-111111111111') -> 0 ->> 'id' = v_box::text, 'offered to a responder');

  v := public.em_save_campaign('b1111111-1111-4111-8111-111111111111', null, jsonb_build_object(
    'name', 'Mailbox campaign', 'from_name', 'Dikho', 'from_email', 'spoofed@elsewhere.example', 'subject', 'Hello',
    'html', '<p>Hello {{first_name}}</p>', 'sender_account_id', v_box,
    'audience', jsonb_build_object('sources', jsonb_build_array('client'), 'city', jsonb_build_array('Delhi'))), '{}');
  v_id := (v ->> 'id')::uuid;
  perform test.check(v ->> 'from_email' = 'contact@example.invalid' and v ->> 'sender_provider' = 'hostinger', 'From is the mailbox''s own address, never typed');

  -- Campaigns without a sender hash exactly as before.
  v := public.em_save_campaign('b1111111-1111-4111-8111-111111111111', null, jsonb_build_object(
    'name', 'SES campaign', 'from_name', 'Dikho', 'from_email', 'news@dikho.example', 'subject', 'Hello', 'html', '<p>x</p>',
    'audience', jsonb_build_object('sources', jsonb_build_array('client'), 'city', jsonb_build_array('Delhi'))), '{}');
  v_ses := (v ->> 'id')::uuid;
  perform test.check(public.em_campaign_hash(v_ses) = (select encode(extensions.digest(convert_to(jsonb_build_object(
    'from_name', c.from_name, 'from_email', c.from_email, 'reply_to', c.reply_to, 'subject', c.subject, 'preheader', c.preheader,
    'html', c.html, 'text_body', c.text_body, 'audience', c.audience, 'send_at', c.send_at, 'recipients', '')::text, 'UTF8'), 'sha256'), 'hex')
    from public.email_campaigns c where c.id = v_ses), 'unchanged hash without a sender');

  v := public.em_submit_campaign('b1111111-1111-4111-8111-111111111111', v_id, 5000, '{}');
  v_hash := v ->> 'snapshot_hash';
  perform test.check((v ->> 'recipient_count')::int = 2, 'two consenting recipients frozen');
  perform public.em_decide_campaign('b2222222-2222-4222-8222-222222222222', v_id, true, v_hash, null, '{}');
  v := public.em_submit_campaign('b1111111-1111-4111-8111-111111111111', v_ses, 5000, '{}');
  perform public.em_decide_campaign('b2222222-2222-4222-8222-222222222222', v_ses, true, v ->> 'snapshot_hash', null, '{}');

  -- SES off: the SES campaign is not claimed. The mailbox's limit of one holds.
  v := public.em_claim_campaign_batch(25, 100, false);
  perform test.check(v -> 'campaign' ->> 'id' = v_id::text and jsonb_array_length(v -> 'recipients') = 1, 'one claimed, the mailbox limit');
  perform test.check(v -> 'sender' ->> 'provider' = 'hostinger' and v -> 'sender' ->> 'provider_account_id' = 'MBX_contact_1', 'the Worker gets the sender');
  perform test.check((select sent from public.email_mailbox_budget where account_id = v_box) = 1, 'mailbox budget spent');
  perform test.check(public.em_claim_campaign_batch(25, 100, false) is null, 'nothing more today, and the SES campaign waits');
  perform test.check((select status from public.email_campaigns where id = v_ses) = 'approved', 'SES campaign untouched');

  -- A throttled send returns its unit to both budgets and rests the mailbox.
  perform public.em_finish_campaign_batch(jsonb_build_array(jsonb_build_object('id', v -> 'recipients' -> 0 ->> 'id', 'status', 'pending')), 600, null);
  perform test.check((select sent from public.email_mailbox_budget where account_id = v_box) = 0, 'unit returned');
  perform test.check((select campaign_cooldown_until > now() from public.email_accounts where id = v_box), 'mailbox resting');
  perform test.check(public.em_claim_campaign_batch(25, 100, false) is null, 'a resting mailbox is not used');
  update public.email_accounts set campaign_cooldown_until = null where id = v_box;

  -- The submitter loses access to the mailbox: the next claim pauses the campaign.
  perform public.em_set_member('b3333333-3333-4333-8333-333333333333', v_box, 'b1111111-1111-4111-8111-111111111111', null, '{}');
  perform test.check(public.em_claim_campaign_batch(25, 100, false) is null, 'nothing claimed');
  perform test.check((select status = 'paused' and decision_note like '%can no longer send%' from public.email_campaigns where id = v_id), 'paused with the reason');

  -- Re-allowed and resumed; a provider refusal pauses it again.
  perform public.em_set_member('b3333333-3333-4333-8333-333333333333', v_box, 'b1111111-1111-4111-8111-111111111111', 'responder', '{}');
  perform public.em_control_campaign('b1111111-1111-4111-8111-111111111111', v_id, 'resume', '{}');
  v := public.em_claim_campaign_batch(25, 100, false);
  perform public.em_finish_campaign_batch(jsonb_build_array(jsonb_build_object('id', v -> 'recipients' -> 0 ->> 'id', 'status', 'pending')), null, 'Hostinger did not accept Dikho''s API token.');
  perform test.check((select status from public.email_campaigns where id = v_id) = 'paused', 'refusal pauses');

  -- Disallowing the mailbox for campaigns stops it too.
  perform public.em_set_campaign_sender('b3333333-3333-4333-8333-333333333333', v_box, false, null, '{}');
  perform public.em_control_campaign('b1111111-1111-4111-8111-111111111111', v_id, 'resume', '{}');
  v := public.em_claim_campaign_batch(25, 100, false);
  perform test.check(v is null, 'nothing claimed from a mailbox no longer allowed');
  perform test.check((select decision_note like '%not allowed to send campaigns%' from public.email_campaigns where id = v_id), 'no longer a campaign sender');
end
$$;

-- ── Browser roles: no tables, no functions ────────────────────────────────
select test.act_as('b4444444-4444-4444-8444-444444444444', null);
select test.expect_error($$select * from public.email_provider_messages$$, '42501', 'no direct read of the message index');
select test.expect_error($$select * from public.email_mailbox_budget$$, '42501', 'no direct read of mailbox budgets');
select test.expect_error($$select public.em_hostinger_sync('00000000-0000-4000-8000-000000000000', '[]')$$, '42501', 'no sync from a browser');
select test.expect_error($$select public.em_connect_hostinger('b4444444-4444-4444-8444-444444444444', null, '[]', null, '{}')$$, '42501', 'no connecting from a browser');
select test.expect_error($$select public.em_set_campaign_sender('b4444444-4444-4444-8444-444444444444', '00000000-0000-4000-8000-000000000000', true, 1, '{}')$$, '42501', 'no campaign setting from a browser');
reset role;
select test.act_as_anon();
select test.expect_error($$select * from public.email_provider_messages$$, '42501', 'anon: no message index');
select test.expect_error($$select public.em_campaign_senders('b4444444-4444-4444-8444-444444444444')$$, '42501', 'anon: no functions');
reset role;

rollback;
