-- Email Hub consent, approval and dispatch rules
-- (20261021130000_email_hub_campaigns.sql). Synthetic people and addresses;
-- everything is rolled back at the end.
--
--   maker     staff: email_campaigns.create, clients.view
--   approver  staff: email_campaigns.approve, clients.view
--   owner     Owner: every business permission
--   nobody    staff: nothing
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'maker@example.invalid'),
  ('a2222222-2222-4222-8222-222222222222', 'approver@example.invalid'),
  ('a3333333-3333-4333-8333-333333333333', 'owner@example.invalid'),
  ('a4444444-4444-4444-8444-444444444444', 'nobody@example.invalid');
insert into public.staff_members (user_id, full_name, system_role) values
  ('a1111111-1111-4111-8111-111111111111', 'Maya Maker', 'staff'),
  ('a2222222-2222-4222-8222-222222222222', 'Arun Approver', 'staff'),
  ('a3333333-3333-4333-8333-333333333333', 'Olga Owner', 'owner'),
  ('a4444444-4444-4444-8444-444444444444', 'Nina Nobody', 'staff');
insert into public.staff_permission_overrides (user_id, permission_key, effect, scope) values
  ('a1111111-1111-4111-8111-111111111111', 'email_campaigns.create', 'grant', 'all'),
  ('a1111111-1111-4111-8111-111111111111', 'clients.view', 'grant', 'all'),
  ('a2222222-2222-4222-8222-222222222222', 'email_campaigns.approve', 'grant', 'all'),
  ('a2222222-2222-4222-8222-222222222222', 'clients.view', 'grant', 'all');

insert into public.clients (company_name, contact_person, email, city, country, status) values
  ('Subscribed Co', 'Sia', 'sia@subscribed.example', 'Mumbai', 'India', 1),
  ('No Consent Co', 'Nik', 'nik@noconsent.example', 'Mumbai', 'India', 1),
  ('Unsubscribed Co', 'Uma', 'uma@unsub.example', 'Mumbai', 'India', 1),
  ('Bounced Co', 'Bo', 'bo@bounced.example', 'Mumbai', 'India', 1),
  ('Pune Co', 'Pia', 'pia@pune.example', 'Pune', 'India', 1),
  ('Duplicate Address Co', 'Sia Again', 'SIA@subscribed.example', 'Mumbai', 'India', 1);
insert into public.vendors (company_name, email, status) values ('Vendor Co', 'vendor@vendor.example', 1);

-- ── Consent is recorded by people allowed to, with a source ───────────────
select test.expect_error($$select public.em_set_preference('a4444444-4444-4444-8444-444444444444', 'sia@subscribed.example', '{"marketing":"subscribed","source":"form"}', '{}')$$,
  'PT403', 'consent needs email_consent.manage');
select test.expect_error($$select public.em_set_preference('a3333333-3333-4333-8333-333333333333', 'sia@subscribed.example', '{"marketing":"subscribed"}', '{}')$$,
  'PT400', 'subscribing needs a recorded source');
select public.em_set_preference('a3333333-3333-4333-8333-333333333333', 'Sia@Subscribed.example', '{"marketing":"subscribed","source":"form","note":"Signed up at expo"}', '{}');
select public.em_set_preference('a3333333-3333-4333-8333-333333333333', 'pia@pune.example', '{"marketing":"subscribed","source":"written"}', '{}');
select public.em_set_preference('a3333333-3333-4333-8333-333333333333', 'uma@unsub.example', '{"marketing":"unsubscribed","source":"request"}', '{}');
select public.em_set_preference('a3333333-3333-4333-8333-333333333333', 'bo@bounced.example', '{"marketing":"subscribed","source":"verbal"}', '{}');
select public.em_record_delivery_event('{"notification_id":"n-bounce-0","provider_message_id":"m0","event_type":"bounce","permanent":true,"recipients":["bo@bounced.example"]}');
select test.check(not public.em_marketable('bo@bounced.example'), 'a permanent bounce suppresses even a subscriber');
select test.check(public.em_marketable('SIA@subscribed.example'), 'subscribed address is marketable');

-- ── Audience preview: only real fields, only kinds the maker may view ────
do $$
declare
  v jsonb;
begin
  v := public.em_audience_preview('a1111111-1111-4111-8111-111111111111', '{"sources":["client","vendor"],"city":["mumbai"]}');
  perform test.check((v ->> 'matched')::int = 4, 'four distinct Mumbai client addresses (duplicates merged), no vendors without vendors.view');
  perform test.check((v ->> 'eligible')::int = 1 and (v ->> 'no_consent')::int = 1 and (v ->> 'unsubscribed')::int = 1 and (v ->> 'suppressed')::int = 1,
    'preview splits eligible, no consent, unsubscribed, suppressed');
  perform test.check(not (v -> 'can_use' ->> 'vendor')::boolean, 'reports vendors as not available');
  perform test.expect_error($f$select public.em_audience_preview('a4444444-4444-4444-8444-444444444444', '{"sources":["client"]}')$f$, 'PT403', 'preview needs create');
end
$$;

-- ── Draft → submit → approval by someone else, on the exact snapshot ────
do $$
declare
  v jsonb;
  v_id uuid;
  v_hash text;
begin
  v := public.em_save_campaign('a1111111-1111-4111-8111-111111111111', null, jsonb_build_object(
    'name', 'Diwali outdoor offer', 'from_name', 'Dikho', 'from_email', 'news@dikho.example', 'subject', 'Hoardings for Diwali',
    'html', '<p>Hello {{first_name}}</p>', 'audience', jsonb_build_object('sources', jsonb_build_array('client'), 'city', jsonb_build_array('Mumbai'))), '{}');
  v_id := (v ->> 'id')::uuid;
  perform test.check(v ->> 'status' = 'draft', 'new campaign is a draft');
  perform test.expect_error(format($f$select public.em_save_campaign(%L, %L, '{"reply_to":"not an address"}', '{}')$f$,
    'a1111111-1111-4111-8111-111111111111', v_id), 'PT400', 'reply-to validated');

  v := public.em_submit_campaign('a1111111-1111-4111-8111-111111111111', v_id, 5000, '{}');
  v_hash := v ->> 'snapshot_hash';
  perform test.check(v ->> 'status' = 'pending_approval' and (v ->> 'recipient_count')::int = 1, 'only the consenting address is frozen in');
  perform test.check(v_hash ~ '^[0-9a-f]{64}$', 'snapshot hash');

  perform test.expect_error(format($f$select public.em_decide_campaign(%L, %L, true, %L, null, '{}')$f$,
    'a1111111-1111-4111-8111-111111111111', v_id, v_hash), 'PT403', 'a maker without approve cannot approve');
  insert into public.staff_permission_overrides (user_id, permission_key, effect, scope)
  values ('a1111111-1111-4111-8111-111111111111', 'email_campaigns.approve', 'grant', 'all');
  perform test.expect_error(format($f$select public.em_decide_campaign(%L, %L, true, %L, null, '{}')$f$,
    'a1111111-1111-4111-8111-111111111111', v_id, v_hash), 'PT403', 'nobody approves their own campaign');
  perform test.expect_error(format($f$select public.em_decide_campaign(%L, %L, true, %L, null, '{}')$f$,
    'a2222222-2222-4222-8222-222222222222', v_id, repeat('0', 64)), 'PT409', 'approval must name the reviewed snapshot');

  v := public.em_decide_campaign('a2222222-2222-4222-8222-222222222222', v_id, true, v_hash, 'Looks good', '{}');
  perform test.check(v ->> 'status' = 'approved' and v ->> 'approved_hash' = v_hash, 'approved on that snapshot');

  -- Any edit withdraws the approval and the frozen list.
  v := public.em_save_campaign('a1111111-1111-4111-8111-111111111111', v_id, '{"subject":"Hoardings for Diwali!"}', '{}');
  perform test.check(v ->> 'status' = 'draft' and v ->> 'approved_hash' is null and (v ->> 'recipient_count')::int = 0, 'editing returns to draft');
  perform test.check(not exists (select 1 from public.email_campaign_recipients where campaign_id = v_id), 'frozen list dropped');
  perform test.check(exists (select 1 from public.audit_log where event_type = 'email_campaign.edited' and metadata ->> 'campaign_id' = v_id::text),
    'withdrawal audited');

  v := public.em_submit_campaign('a1111111-1111-4111-8111-111111111111', v_id, 5000, '{}');
  perform public.em_decide_campaign('a2222222-2222-4222-8222-222222222222', v_id, true, v ->> 'snapshot_hash', null, '{}');
end
$$;

-- The last person to edit a campaign cannot approve it either, even when a
-- colleague submits it (here an Owner, who holds create and approve).
do $$
declare
  v jsonb;
  v_id uuid;
begin
  v := public.em_save_campaign('a1111111-1111-4111-8111-111111111111', null, jsonb_build_object(
    'name', 'Edited by someone else', 'from_name', 'Dikho', 'from_email', 'news@dikho.example', 'subject', 'Rates',
    'html', '<p>Hello</p>', 'audience', jsonb_build_object('sources', jsonb_build_array('client'), 'city', jsonb_build_array('Mumbai'))), '{}');
  v_id := (v ->> 'id')::uuid;
  perform public.em_save_campaign('a3333333-3333-4333-8333-333333333333', v_id, '{"subject":"Rates, rewritten"}', '{}');
  v := public.em_submit_campaign('a1111111-1111-4111-8111-111111111111', v_id, 5000, '{}');
  perform test.expect_error(format($f$select public.em_decide_campaign(%L, %L, true, %L, null, '{}')$f$,
    'a3333333-3333-4333-8333-333333333333', v_id, v ->> 'snapshot_hash'), 'PT403', 'the last editor cannot approve');
  v := public.em_decide_campaign('a2222222-2222-4222-8222-222222222222', v_id, false, v ->> 'snapshot_hash', 'Not now', '{}');
  perform test.check(v ->> 'status' = 'rejected', 'an independent approver still decides');
end
$$;

-- ── Dispatch: claims, budget, consent re-check, tamper detection ─────────
do $$
declare
  v_id uuid := (select id from public.email_campaigns where name = 'Diwali outdoor offer');
  v jsonb;
  v2 jsonb;
  v_rid uuid;
begin
  v := public.em_claim_campaign_batch(25, 100);
  perform test.check(jsonb_array_length(v -> 'recipients') = 1 and v -> 'campaign' ->> 'subject' = 'Hoardings for Diwali!', 'claims the approved content');
  v_rid := (v -> 'recipients' -> 0 ->> 'id')::uuid;
  v2 := public.em_claim_campaign_batch(25, 100);
  perform test.check(v2 is null, 'a claimed recipient is never claimed twice');
  perform test.check((select sent from public.email_send_budget where day = (now() at time zone 'utc')::date) = 1, 'budget advanced with the claim');

  perform public.em_finish_campaign_batch(jsonb_build_array(jsonb_build_object('id', v_rid, 'status', 'sent', 'message_id', 'ses-msg-1')));
  perform test.check(public.em_claim_campaign_batch(25, 100) is null, 'nothing left');
  perform test.check((select status from public.email_campaigns where id = v_id) = 'sent', 'campaign completes');
  perform test.expect_error(format($f$select public.em_save_campaign(%L, %L, '{"subject":"x"}', '{}')$f$,
    'a1111111-1111-4111-8111-111111111111', v_id), 'PT409', 'a sent campaign cannot be edited');

  -- SES reports delivery, then a complaint; replays change nothing.
  perform test.check(public.em_record_delivery_event('{"notification_id":"n1","provider_message_id":"ses-msg-1","event_type":"delivery","recipients":["sia@subscribed.example"]}') = 'recorded', 'delivery recorded');
  perform test.check(public.em_record_delivery_event('{"notification_id":"n1","provider_message_id":"ses-msg-1","event_type":"delivery"}') = 'duplicate', 'SNS retry is a duplicate');
  perform test.check((select status from public.email_campaign_recipients where id = v_rid) = 'delivered', 'recipient delivered');
  perform public.em_record_delivery_event('{"notification_id":"n2","provider_message_id":"ses-msg-1","event_type":"complaint","recipients":["sia@subscribed.example"]}');
  perform test.check((select status from public.email_campaign_recipients where id = v_rid) = 'complained', 'complaint after delivery');
  perform test.check(not public.em_marketable('sia@subscribed.example'), 'a complaint unsubscribes');
  perform public.em_record_delivery_event('{"notification_id":"n3","provider_message_id":"ses-msg-1","event_type":"delivery"}');
  perform test.check((select status from public.email_campaign_recipients where id = v_rid) = 'complained', 'status never steps back');
end
$$;

do $$
declare
  v jsonb;
  v_id uuid;
begin
  -- Second campaign: two eligible people, a cap of one, a withdrawal and a tamper.
  perform public.em_set_preference('a3333333-3333-4333-8333-333333333333', 'sia@subscribed.example', '{"marketing":"subscribed","source":"written"}', '{}');
  v := public.em_save_campaign('a1111111-1111-4111-8111-111111111111', null, jsonb_build_object(
    'name', 'Second', 'from_name', 'Dikho', 'from_email', 'news@dikho.example', 'subject', 'Hello', 'html', '<p>x</p>',
    'audience', jsonb_build_object('sources', jsonb_build_array('client'))), '{}');
  v_id := (v ->> 'id')::uuid;
  v := public.em_submit_campaign('a1111111-1111-4111-8111-111111111111', v_id, 5000, '{}');
  perform test.check((v ->> 'recipient_count')::int = 2, 'two eligible');
  perform public.em_decide_campaign('a2222222-2222-4222-8222-222222222222', v_id, true, v ->> 'snapshot_hash', null, '{}');

  -- Pia withdraws after approval: skipped at claim time, never sent.
  perform public.em_set_preference('a3333333-3333-4333-8333-333333333333', 'pia@pune.example', '{"marketing":"unsubscribed","source":"request"}', '{}');
  v := public.em_claim_campaign_batch(25, 2);
  perform test.check(jsonb_array_length(v -> 'recipients') = 1 and v -> 'recipients' -> 0 ->> 'email' = 'sia@subscribed.example', 'withdrawn consent skipped');
  perform test.check((select skip_reason from public.email_campaign_recipients where campaign_id = v_id and email = 'pia@pune.example') = 'no_consent', 'skip reason kept');
  perform test.check(public.em_claim_campaign_batch(25, 2) is null, 'daily cap reached (one sent today already)');

  -- A claim that never reports back becomes uncertain, not pending.
  update public.email_campaign_recipients set claimed_at = now() - interval '11 minutes' where campaign_id = v_id and status = 'sending';
  perform public.em_claim_campaign_batch(25, 100);
  perform test.check((select status from public.email_campaign_recipients where campaign_id = v_id and email = 'sia@subscribed.example') = 'uncertain',
    'stale claim is uncertain, never resent');

  -- Content changed behind the approval's back: dispatch stops.
  v := public.em_save_campaign('a1111111-1111-4111-8111-111111111111', null, jsonb_build_object(
    'name', 'Third', 'from_name', 'Dikho', 'from_email', 'news@dikho.example', 'subject', 'Hi', 'html', '<p>y</p>',
    'audience', jsonb_build_object('sources', jsonb_build_array('client'), 'city', jsonb_build_array('Pune', 'Mumbai'))), '{}');
  v_id := (v ->> 'id')::uuid;
  perform public.em_set_preference('a3333333-3333-4333-8333-333333333333', 'pia@pune.example', '{"marketing":"subscribed","source":"written"}', '{}');
  v := public.em_submit_campaign('a1111111-1111-4111-8111-111111111111', v_id, 5000, '{}');
  perform public.em_decide_campaign('a2222222-2222-4222-8222-222222222222', v_id, true, v ->> 'snapshot_hash', null, '{}');
  update public.email_campaigns set html = '<p>swapped</p>' where id = v_id;
  perform test.check(public.em_claim_campaign_batch(25, 0) is null, 'tampered content is not sent');
  perform test.check((select status from public.email_campaigns where id = v_id) = 'paused', 'tampered campaign paused');

  -- Rejection by an approver; the maker cannot reject their own.
  v := public.em_save_campaign('a1111111-1111-4111-8111-111111111111', null, jsonb_build_object(
    'name', 'Fourth', 'from_email', 'news@dikho.example', 'subject', 'S', 'html', '<p>z</p>',
    'audience', jsonb_build_object('sources', jsonb_build_array('client'))), '{}');
  v := public.em_submit_campaign('a1111111-1111-4111-8111-111111111111', (v ->> 'id')::uuid, 5000, '{}');
  v := public.em_decide_campaign('a2222222-2222-4222-8222-222222222222', (v ->> 'id')::uuid, false, v ->> 'snapshot_hash', 'Wrong offer', '{}');
  perform test.check(v ->> 'status' = 'rejected' and v ->> 'decision_note' = 'Wrong offer', 'rejected with a note');
  perform test.expect_error(format($f$select public.em_submit_campaign(%L, %L, 1, '{}')$f$,
    'a1111111-1111-4111-8111-111111111111', (v ->> 'id')::uuid), 'PT400', 'over the per-campaign limit');

  -- Unsubscribe link (signature checked by the Worker).
  perform public.em_unsubscribe_recipient((select id from public.email_campaign_recipients where email = 'sia@subscribed.example' limit 1));
  perform test.check((select marketing_source from public.email_preferences where email = 'sia@subscribed.example') = 'unsubscribe_link', 'unsubscribed by link');
end
$$;

-- ── Templates keep every version ─────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  perform test.expect_error($f$select public.em_save_template('a4444444-4444-4444-8444-444444444444', null, '{"name":"T","kind":"marketing"}', '{}')$f$, 'PT403', 'templates need permission');
  v := public.em_save_template('a3333333-3333-4333-8333-333333333333', null, '{"name":"Monthly update","kind":"marketing","subject":"News","html":"<p>v1</p>"}', '{}');
  v := public.em_save_template('a3333333-3333-4333-8333-333333333333', (v ->> 'id')::uuid, '{"html":"<p>v2</p>"}', '{}');
  perform test.check((v ->> 'version')::int = 2 and jsonb_array_length(v -> 'versions') = 2, 'two versions kept');
  v := public.em_get_template('a3333333-3333-4333-8333-333333333333', (v ->> 'id')::uuid, 1);
  perform test.check(v ->> 'html' = '<p>v1</p>', 'old version readable');
  perform test.expect_error($f$select public.em_save_template('a3333333-3333-4333-8333-333333333333', null, '{"name":"monthly UPDATE","kind":"marketing"}', '{}')$f$,
    'PT409', 'names are unique, ignoring case');
end
$$;

-- ── Browser roles have no way in ─────────────────────────────────────────
insert into auth.sessions (id, user_id) values ('bbbbbbbb-0000-4000-8000-0000000000a1', 'a1111111-1111-4111-8111-111111111111');
select test.act_as('a1111111-1111-4111-8111-111111111111', 'bbbbbbbb-0000-4000-8000-0000000000a1');
select test.expect_error('select count(*) from public.email_campaigns', '42501', 'no direct campaign reads');
select test.expect_error('select count(*) from public.email_preferences', '42501', 'no direct preference reads');
select test.expect_error($$update public.email_campaigns set status = 'approved'$$, '42501', 'no direct approval');
select test.expect_error($$select public.em_claim_campaign_batch(10, 10)$$, '42501', 'no dispatch from a browser');
reset role;

rollback;
