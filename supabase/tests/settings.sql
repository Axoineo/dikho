-- Settings, phase 1 (20261028120000_settings.sql), checked against the real
-- functions with synthetic people. Run by scripts/db/verify-local.sh;
-- everything is rolled back at the end.
--
-- People:
--   owner   Owner (holds every business permission)        b1111111-...
--   admin   Admin role (given settings.manage by the role)  b3333333-...
--   sam     staff, no settings permission                   b4444444-...
--   ria     staff, granted settings.manage by override      b5555555-...
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('b1111111-1111-4111-8111-111111111111', 'owner@example.invalid'),
  ('b3333333-3333-4333-8333-333333333333', 'admin@example.invalid'),
  ('b4444444-4444-4444-8444-444444444444', 'sam@example.invalid'),
  ('b5555555-5555-4555-8555-555555555555', 'ria@example.invalid');

insert into public.staff_members (user_id, full_name, system_role) values
  ('b1111111-1111-4111-8111-111111111111', 'Olive Owner', 'owner'),
  ('b3333333-3333-4333-8333-333333333333', 'Ada Admin', 'admin'),
  ('b4444444-4444-4444-8444-444444444444', 'Sam Sales', 'staff'),
  ('b5555555-5555-4555-8555-555555555555', 'Ria Settings', 'staff');

insert into public.staff_permission_overrides (user_id, permission_key, effect, scope) values
  ('b5555555-5555-4555-8555-555555555555', 'settings.manage', 'grant', 'all');

insert into auth.sessions (id, user_id) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b1111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'b3333333-3333-4333-8333-333333333333'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'b4444444-4444-4444-8444-444444444444'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'b5555555-5555-4555-8555-555555555555');

insert into public.media (name) values ('Hoarding'), ('Digital');

-- ── Who holds settings.manage ─────────────────────────────────────────────
do $$
begin
  perform test.check(exists (select 1 from public.effective_permissions_for('b1111111-1111-4111-8111-111111111111') where permission_key = 'settings.manage'), 'an Owner holds settings.manage');
  perform test.check(exists (select 1 from public.effective_permissions_for('b3333333-3333-4333-8333-333333333333') where permission_key = 'settings.manage'), 'the admin role holds settings.manage');
  perform test.check(not exists (select 1 from public.effective_permissions_for('b4444444-4444-4444-8444-444444444444') where permission_key = 'settings.manage'), 'staff do not');
  perform test.check(exists (select 1 from public.effective_permissions_for('b5555555-5555-4555-8555-555555555555') where permission_key = 'settings.manage'), 'an override grants it');
end
$$;

-- ── Personal preferences (Sam, no settings permission) ────────────────────
select test.act_as('b4444444-4444-4444-8444-444444444444', 'bbbbbbbb-0000-4000-8000-000000000004');
do $$
declare
  v jsonb;
begin
  v := public.set_my_preferences('{"density":"compact","page_size":50,"start_page":"/sales-orders"}');
  perform test.check(v = '{"density":"compact","page_size":50,"start_page":"/sales-orders"}'::jsonb, 'preferences are saved and returned');
  perform test.check(public.my_access() -> 'preferences' ->> 'density' = 'compact', 'my_access returns them');
  perform test.check(public.my_access() ->> 'status' = 'active', 'my_access still answers as before');
  v := public.set_my_preferences('{"page_size":null}');
  perform test.check(not (v ? 'page_size') and v ->> 'density' = 'compact', 'null clears one key and keeps the rest');
  perform test.expect_error($f$select public.set_my_preferences('{"density":"tiny"}')$f$, 'PT400', 'unknown density refused');
  perform test.expect_error($f$select public.set_my_preferences('{"page_size":30}')$f$, 'PT400', 'unknown page size refused');
  perform test.expect_error($f$select public.set_my_preferences('{"start_page":"https://evil.example/"}')$f$, 'PT400', 'an outside address is not a start page');
  perform test.expect_error($f$select public.set_my_preferences('{"start_page":"/clients/../../x"}')$f$, 'PT400', 'path tricks are refused');
  perform test.expect_error($f$select public.set_my_preferences('{"theme_preference":"dark"}')$f$, 'PT400', 'unknown keys are refused');
  perform test.expect_error($f$select public.set_my_preferences('[1]')$f$, 'PT400', 'only an object');

  -- Everyone signed in can read the shared settings; nobody but a manager may change them.
  v := public.get_settings();
  perform test.check(v -> 'organization' ->> 'date_format' = 'd MMM yyyy', 'defaults are readable by staff');
  perform test.check(jsonb_array_length(v -> 'lists') >= 30, 'the built-in dropdown values are seeded');
  perform test.expect_error($f$select public.update_organization_settings('{"date_format":"yyyy-MM-dd"}')$f$, 'PT403', 'staff cannot change organization settings');
  perform test.expect_error($f$select public.get_organization_profile()$f$, 'PT403', 'staff cannot read the issuer profile through settings');
  perform test.expect_error($f$select public.update_organization_profile('{"legal_name":"Hack"}')$f$, 'PT403', 'staff cannot change the issuer profile');
  perform test.expect_error($f$select public.add_list_option('order_type', 'OOH')$f$, 'PT403', 'staff cannot add dropdown values');
  perform test.expect_error($f$select public.save_media(null, 'Radio')$f$, 'PT403', 'staff cannot add media');
end
$$;
select test.expect_error($$select * from public.organization_settings$$, '42501', 'no direct read of organization_settings');
select test.expect_error($$update public.option_lists set hidden = true$$, '42501', 'no direct write to option_lists');
select test.expect_error($$update public.staff_members set preferences = '{}'$$, '42501', 'preferences only through the function');
reset role;

do $$
begin
  perform test.check((select preferences from public.staff_members where user_id = 'b3333333-3333-4333-8333-333333333333') = '{}'::jsonb,
    'one person''s preferences never touch another''s');
end
$$;

-- ── Anonymous callers get nothing ─────────────────────────────────────────
select test.act_as_anon();
select test.expect_error($$select public.get_settings()$$, '42501', 'anon cannot read settings');
select test.expect_error($$select public.set_my_preferences('{}')$$, '42501', 'anon cannot save preferences');
reset role;

-- ── Admin: organization settings ──────────────────────────────────────────
select test.act_as('b3333333-3333-4333-8333-333333333333', 'bbbbbbbb-0000-4000-8000-000000000003');
do $$
declare
  v jsonb;
begin
  v := public.update_organization_settings('{"date_format":"dd/MM/yyyy","number_format":"en-US"}');
  perform test.check(v ->> 'date_format' = 'dd/MM/yyyy' and v ->> 'number_format' = 'en-US', 'formats are saved');
  perform test.check(public.get_settings() -> 'organization' ->> 'date_format' = 'dd/MM/yyyy', 'the new format is what everyone reads');
  v := public.update_organization_settings('{"number_format":"en-IN"}');
  perform test.check(v ->> 'number_format' = 'en-IN' and v ->> 'date_format' = 'dd/MM/yyyy', 'one change leaves the other setting alone');
  perform test.expect_error($f$select public.update_organization_settings('{"date_format":"MM/dd/yyyy"}')$f$, 'PT400', 'an unsupported date format is refused');
  perform test.expect_error($f$select public.update_organization_settings('{"number_format":"de-DE"}')$f$, 'PT400', 'an unsupported number format is refused');
  perform test.expect_error($f$select public.update_organization_settings('{"updated_by":"x"}')$f$, 'PT400', 'unknown fields are refused');
end
$$;
reset role;
do $$
begin
  perform test.check(exists (select 1 from public.audit_log where event_type = 'settings.organization'
    and actor_id = 'b3333333-3333-4333-8333-333333333333' and new_value ->> 'date_format' = 'dd/MM/yyyy'), 'organization changes are audited');
end
$$;

-- ── Admin: the issuer profile ─────────────────────────────────────────────
select test.act_as('b3333333-3333-4333-8333-333333333333', 'bbbbbbbb-0000-4000-8000-000000000003');
do $$
declare
  v jsonb;
begin
  perform test.check(public.get_organization_profile() is null, 'no profile yet');
  perform test.expect_error($f$select public.update_organization_profile('{"legal_name":"Dikho Global Media LLP"}')$f$, 'PT400', 'the first save needs an address');
  v := public.update_organization_profile('{"legal_name":"Dikho Global Media LLP","address_line1":"1 Example Road","city":"Ahmedabad","state":"Gujarat","state_code":"24","pincode":"380009","gstin":"24aaaca4141f1z5"}');
  perform test.check(v ->> 'gstin' = '24AAACA4141F1Z5' and v ->> 'state_code' = '24', 'the first save creates the profile; GSTIN upper-cased');
  perform test.check(v ->> 'profile_code' = 'default', 'a new profile gets a code');
  v := public.update_organization_profile('{"gstin":"27AAACA4141F1Z5"}');
  perform test.check(v ->> 'state_code' = '27', 'the state code follows the GSTIN');
  perform test.expect_error($f$select public.update_organization_profile('{"gstin":"27AAACA4141F1Z"}')$f$, 'PT400', 'a short GSTIN is refused');
  perform test.expect_error($f$select public.update_organization_profile('{"pan":"BBBBB1234B"}')$f$, 'PT400', 'a PAN that does not match the GSTIN is refused');
  perform test.expect_error($f$select public.update_organization_profile('{"bank_ifsc":"HDFC1234567"}')$f$, 'PT400', 'a bad IFSC is refused');
  perform test.expect_error($f$select public.update_organization_profile('{"pincode":"38000"}')$f$, 'PT400', 'an Indian PIN has six digits');
  perform test.expect_error($f$select public.update_organization_profile('{"legal_name":""}')$f$, 'PT400', 'the legal name cannot be cleared');
  perform test.expect_error($f$select public.update_organization_profile('{"invoice_prefix":"X"}')$f$, 'PT400', 'invoice numbering is not edited here');
  v := public.update_organization_profile('{"pan":"AAACA4141F","bank_name":"HDFC Bank","bank_account_number":"50100012345678","bank_ifsc":"hdfc0001234"}');
  perform test.check(v ->> 'bank_ifsc' = 'HDFC0001234' and v ->> 'bank_account_number' = '50100012345678', 'bank details are saved');
  perform test.check(public.get_organization_profile() ->> 'legal_name' = 'Dikho Global Media LLP', 'a manager reads the profile back');
end
$$;
reset role;
do $$
begin
  perform test.check(not exists (select 1 from public.audit_log where event_type = 'settings.company'
    and (new_value ->> 'bank_account_number') = '50100012345678'), 'the audit log never holds the account number');
  perform test.check(exists (select 1 from public.audit_log where event_type = 'settings.company'
    and (new_value ->> 'bank_account_number') = '••••5678'), 'it records the last four digits');
  perform test.check((select count(*) from public.organization_profiles) = 1, 'still one profile');
end
$$;

-- ── Ria (granted by override): dropdown values and media ──────────────────
select test.act_as('b5555555-5555-4555-8555-555555555555', 'bbbbbbbb-0000-4000-8000-000000000005');
do $$
declare
  v jsonb;
  v_first bigint;
  v_second bigint;
  v_media bigint;
  v_digital bigint;
  v_sub jsonb;
begin
  v := public.add_list_option('order_type', ' OOH ');
  perform test.check(v ->> 'value' = 'OOH', 'a value is trimmed and added');
  perform test.check((v ->> 'sort_order')::int > (select max((e ->> 'sort_order')::int) from jsonb_array_elements(public.get_settings() -> 'lists') e
    where e ->> 'list_key' = 'order_type' and e ->> 'value' <> 'OOH'), 'it goes last');
  perform test.expect_error($f$select public.add_list_option('order_type', 'ooh')$f$, 'PT409', 'a duplicate (any case) is refused');
  perform test.expect_error($f$select public.add_list_option('row_color', '#123456')$f$, 'PT400', 'a colour needs a name');
  perform test.expect_error($f$select public.add_list_option('row_color', 'blue', 'Blue')$f$, 'PT400', 'a colour must be a hex value');
  v := public.add_list_option('row_color', '#ABCDEF', 'Sky');
  perform test.check(v ->> 'value' = '#abcdef', 'a colour is stored in lower case');
  perform test.expect_error($f$select public.add_list_option('nope', 'X')$f$, 'PT400', 'an unknown list is refused');

  v := public.set_list_option_hidden((v ->> 'id')::bigint, true);
  perform test.check((v ->> 'hidden')::boolean, 'a value can be hidden');
  perform test.expect_error($f$select public.set_list_option_hidden(-1, true)$f$, 'PT404', 'an unknown value is reported');

  -- Read back the way the dashboard does: Ria has no direct table access.
  select (e ->> 'id')::bigint into v_first from jsonb_array_elements(public.get_settings() -> 'lists') e where e ->> 'list_key' = 'order_type' and e ->> 'value' = 'ATL';
  select (e ->> 'id')::bigint into v_second from jsonb_array_elements(public.get_settings() -> 'lists') e where e ->> 'list_key' = 'order_type' and e ->> 'value' = 'TTL';
  perform public.move_list_option(v_second, -1);
  perform test.check((select string_agg(e ->> 'value', ',' order by (e ->> 'sort_order')::int, (e ->> 'id')::bigint)
    from jsonb_array_elements(public.get_settings() -> 'lists') e where e ->> 'list_key' = 'order_type') = 'TTL,ATL,BTL,OOH', 'moving up swaps with the one above');
  perform public.move_list_option(v_second, -1);
  perform test.check((select string_agg(e ->> 'value', ',' order by (e ->> 'sort_order')::int, (e ->> 'id')::bigint)
    from jsonb_array_elements(public.get_settings() -> 'lists') e where e ->> 'list_key' = 'order_type') = 'TTL,ATL,BTL,OOH', 'moving past the top changes nothing');
  perform public.move_list_option(v_first, 1);
  perform test.check((select string_agg(e ->> 'value', ',' order by (e ->> 'sort_order')::int, (e ->> 'id')::bigint)
    from jsonb_array_elements(public.get_settings() -> 'lists') e where e ->> 'list_key' = 'order_type') = 'TTL,BTL,ATL,OOH', 'moving down swaps with the one below');
  perform test.expect_error(format($f$select public.move_list_option(%s, 2)$f$, v_first), 'PT400', 'one step at a time');

  v := public.save_media(null, 'Radio');
  v_media := (v ->> 'id')::bigint;
  perform test.expect_error($f$select public.save_media(null, 'radio')$f$, 'PT409', 'duplicate media names are refused');
  v := public.save_media(v_media, 'Radio and podcast');
  perform test.check(v ->> 'name' = 'Radio and podcast', 'media can be renamed');
  v := public.save_media(v_media, null, true);
  perform test.check((v ->> 'hidden')::boolean and v ->> 'name' = 'Radio and podcast', 'hiding keeps the name');

  v_sub := public.save_sub_media(null, v_media, 'FM spot');
  perform test.check((v_sub ->> 'media_id')::bigint = v_media, 'sub media is added under its media');
  perform test.expect_error(format($f$select public.save_sub_media(null, %s, 'fm spot')$f$, v_media), 'PT409', 'a duplicate under the same media is refused');
  select id into v_digital from public.media where name = 'Digital';
  v_sub := public.save_sub_media(null, v_digital, 'FM spot');
  perform test.check((v_sub ->> 'media_id')::bigint = v_digital, 'the same name under another media is fine');
  perform test.expect_error($f$select public.save_sub_media(null, -1, 'X')$f$, 'PT400', 'sub media needs an existing media');
end
$$;
reset role;
do $$
begin
  perform test.check((select count(*) from public.audit_log where event_type in ('settings.list_option_added', 'settings.media', 'settings.sub_media')
    and actor_id = 'b5555555-5555-4555-8555-555555555555') >= 5, 'list and media changes are audited');
end
$$;

rollback;
