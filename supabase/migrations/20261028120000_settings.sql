-- Settings, phase 1 (docs/tasks/2026-10-28-settings.md).
--
--   1. settings.manage: the permission behind the organization pages of
--      Settings. Owners hold it as they hold every permission; the admin
--      role is given it here.
--   2. Personal preferences on the staff record, saved by
--      set_my_preferences() and returned by my_access() beside the theme.
--   3. organization_settings: one row of organization-wide display formats.
--   4. option_lists: the values dropdowns offer, until now fixed in code.
--   5. A write path for the company's issuer profile (organization_profiles),
--      media and sub media, none of which could be edited before.
--
-- New tables are reached only through the functions below: RLS on, direct
-- privileges revoked, the restrictive "staff members only" policy as on every
-- other table. Organization changes are written to audit_log. Additive: the
-- dashboard works before this is applied (it falls back to built-in values)
-- and after.

-- ── 1. Permission ───────────────────────────────────────────────────────────

insert into public.permissions (key, module, action, label, description, allowed_scopes, developer_only, min_developer_level, sort_order) values
  ('settings.manage', 'Settings', 'manage', 'Manage organization settings',
   'Company details, regional formats, dropdown lists and media, for everyone.', array['all'], false, null, 800)
on conflict (key) do update set
  module = excluded.module, action = excluded.action, label = excluded.label,
  description = excluded.description, allowed_scopes = excluded.allowed_scopes,
  developer_only = excluded.developer_only, min_developer_level = excluded.min_developer_level,
  sort_order = excluded.sort_order;

insert into public.role_permissions (system_role, permission_key, scope) values
  ('admin', 'settings.manage', 'all')
on conflict do nothing;

-- ── 2. Personal preferences ─────────────────────────────────────────────────

alter table public.staff_members
  add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table public.staff_members drop constraint if exists staff_members_preferences_shape;
alter table public.staff_members add constraint staff_members_preferences_shape
  check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 2048);

-- Merges `p_changes` into the caller's own preferences; a null value clears
-- that key. Only known keys and values are accepted.
create or replace function public.set_my_preferences(p_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'Not signed in' using errcode = 'PT401';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Preferences must be an object' using errcode = 'PT400';
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_changes) e loop
    continue when v_value = 'null'::jsonb;
    case v_key
      when 'density' then
        if v_value not in ('"comfortable"'::jsonb, '"compact"'::jsonb) then
          raise exception 'Unknown table density' using errcode = 'PT400';
        end if;
      when 'page_size' then
        if v_value not in ('25'::jsonb, '50'::jsonb, '100'::jsonb) then
          raise exception 'Rows per page must be 25, 50 or 100' using errcode = 'PT400';
        end if;
      when 'start_page' then
        if jsonb_typeof(v_value) <> 'string'
           or (v_value #>> '{}') !~ '^/[a-z][a-z0-9-]{0,30}(/[a-z][a-z0-9-]{0,30})?$' then
          raise exception 'Unknown start page' using errcode = 'PT400';
        end if;
      else
        raise exception 'Unknown preference' using errcode = 'PT400';
    end case;
  end loop;

  update public.staff_members
  set preferences = jsonb_strip_nulls(preferences || p_changes)
  where user_id = auth.uid()
  returning preferences into v_result;

  return coalesce(v_result, '{}'::jsonb);
end
$$;

-- my_access(), unchanged except that it also returns `preferences`.
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
    'preferences', m.preferences,
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

-- ── 3. Organization settings (one row) ──────────────────────────────────────

create table if not exists public.organization_settings (
  id boolean primary key default true check (id),
  date_format text not null default 'd MMM yyyy' check (date_format in ('d MMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd')),
  number_format text not null default 'en-IN' check (number_format in ('en-IN', 'en-US')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.organization_settings (id) values (true) on conflict (id) do nothing;

-- ── 4. Dropdown values ──────────────────────────────────────────────────────

create table if not exists public.option_lists (
  id bigint generated always as identity primary key,
  list_key text not null check (list_key in (
    'order_type', 'order_status', 'purchase_status', 'item_type', 'courier_status', 'row_color', 'registration')),
  value text not null check (char_length(value) between 1 and 60 and value = btrim(value)),
  label text check (label is null or char_length(btrim(label)) between 1 and 40),
  sort_order integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (list_key, value),
  -- A row colour is stored on orders as its hex value and shown by name.
  check (list_key <> 'row_color' or (value ~ '^#[0-9a-f]{6}$' and label is not null))
);

-- Today's built-in values, in today's order.
insert into public.option_lists (list_key, value, label, sort_order)
select v.list_key, v.value, v.label, v.position * 10
from (values
  ('order_type', 'ATL', null, 1), ('order_type', 'TTL', null, 2), ('order_type', 'BTL', null, 3),
  ('order_status', 'Draft', null, 1), ('order_status', 'Pending Approval', null, 2), ('order_status', 'Approved', null, 3),
  ('order_status', 'In Progress', null, 4), ('order_status', 'Completed', null, 5), ('order_status', 'Cancelled', null, 6),
  ('purchase_status', 'Not Started', null, 1), ('purchase_status', 'Partial', null, 2), ('purchase_status', 'Completed', null, 3),
  ('item_type', 'Media', null, 1), ('item_type', 'Production', null, 2), ('item_type', 'Printing', null, 3),
  ('item_type', 'Installation', null, 4), ('item_type', 'Service', null, 5), ('item_type', 'Other', null, 6),
  ('courier_status', 'Not Sent', null, 1), ('courier_status', 'Dispatched', null, 2), ('courier_status', 'In Transit', null, 3),
  ('courier_status', 'Delivered', null, 4), ('courier_status', 'Returned', null, 5),
  ('row_color', '#185494', 'Blue', 1), ('row_color', '#f9af1b', 'Amber', 2), ('row_color', '#2f9e6f', 'Green', 3),
  ('row_color', '#b23b43', 'Red', 4), ('row_color', '#6c4bb6', 'Purple', 5), ('row_color', '#6b7684', 'Slate', 6),
  ('registration', 'Registered', null, 1), ('registration', 'Unregistered', null, 2),
  ('registration', 'Composition', null, 3), ('registration', 'Other', null, 4)
) as v(list_key, value, label, position)
on conflict (list_key, value) do nothing;

-- ── 5. Media can be hidden from pickers (never deleted: vendors point at it)

alter table public.media add column if not exists hidden boolean not null default false;
alter table public.sub_media add column if not exists hidden boolean not null default false;

-- ── Lock the new tables down ────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['organization_settings', 'option_lists']
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

-- ── Functions ───────────────────────────────────────────────────────────────

-- Fails unless the caller is signed-in staff holding settings.manage.
create or replace function public.settings_require_manager()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Not signed in' using errcode = 'PT401';
  end if;
  if not public.has_permission('settings.manage') then
    raise exception 'You do not have permission to change organization settings' using errcode = 'PT403';
  end if;
end
$$;

-- What every signed-in person's dashboard needs: display formats and the
-- dropdown values (hidden ones included, so a saved value still shows its
-- name).
create or replace function public.get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org jsonb;
begin
  if not public.is_staff() then
    raise exception 'Not signed in' using errcode = 'PT401';
  end if;
  select jsonb_build_object('date_format', s.date_format, 'number_format', s.number_format, 'updated_at', s.updated_at)
  into v_org
  from public.organization_settings s
  where s.id;

  return jsonb_build_object(
    'organization', coalesce(v_org, '{}'::jsonb),
    'lists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'list_key', o.list_key, 'value', o.value, 'label', o.label,
        'sort_order', o.sort_order, 'hidden', o.hidden) order by o.list_key, o.sort_order, o.id)
      from public.option_lists o
    ), '[]'::jsonb)
  );
end
$$;

-- Display formats for everyone's screens.
create or replace function public.update_organization_settings(p_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_old public.organization_settings;
  v_new public.organization_settings;
begin
  perform public.settings_require_manager();
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Changes must be an object' using errcode = 'PT400';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('date_format', 'number_format') then
      raise exception 'Unknown setting' using errcode = 'PT400';
    end if;
  end loop;

  insert into public.organization_settings (id) values (true) on conflict (id) do nothing;
  select * into v_old from public.organization_settings where id;

  begin
    update public.organization_settings
    set date_format = coalesce(p_changes ->> 'date_format', date_format),
        number_format = coalesce(p_changes ->> 'number_format', number_format),
        updated_at = now(), updated_by = auth.uid()
    where id
    returning * into v_new;
  exception when check_violation then
    raise exception 'That format is not one Dikho offers' using errcode = 'PT400';
  end;

  perform public.um_audit(auth.uid(), null, 'settings.organization',
    jsonb_build_object('date_format', v_old.date_format, 'number_format', v_old.number_format),
    jsonb_build_object('date_format', v_new.date_format, 'number_format', v_new.number_format), '{}'::jsonb);
  return jsonb_build_object('date_format', v_new.date_format, 'number_format', v_new.number_format, 'updated_at', v_new.updated_at);
end
$$;

-- The issuer profile printed on invoices. Issued invoices keep their own copy
-- (invoices.seller_snapshot), so editing this never rewrites one.
create or replace function public.get_organization_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.settings_require_manager();
  select to_jsonb(p) - 'invoice_prefix' - 'invoice_terms_days'
  into v
  from public.organization_profiles p
  order by p.created_at, p.id
  limit 1;
  return v;
end
$$;

create or replace function public.update_organization_profile(p_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_old public.organization_profiles;
  v_new public.organization_profiles;
  v_masked_old jsonb;
  v_masked_new jsonb;
begin
  perform public.settings_require_manager();
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Changes must be an object' using errcode = 'PT400';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('legal_name', 'gstin', 'pan', 'address_line1', 'address_line2', 'city', 'state', 'state_code',
                     'country', 'pincode', 'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_branch') then
      raise exception 'Unknown company field' using errcode = 'PT400';
    end if;
  end loop;

  select * into v_old from public.organization_profiles order by created_at, id limit 1;
  if v_old.id is null then
    v_new.id := gen_random_uuid();
    v_new.profile_code := 'default';
    v_new.country := 'India';
  else
    v_new := v_old;
  end if;

  -- Text fields: trimmed, empty means "not set".
  v_new.legal_name := coalesce(nullif(btrim(p_changes ->> 'legal_name'), ''), case when p_changes ? 'legal_name' then null else v_new.legal_name end);
  v_new.address_line1 := case when p_changes ? 'address_line1' then nullif(btrim(p_changes ->> 'address_line1'), '') else v_new.address_line1 end;
  v_new.address_line2 := case when p_changes ? 'address_line2' then nullif(btrim(p_changes ->> 'address_line2'), '') else v_new.address_line2 end;
  v_new.city := case when p_changes ? 'city' then nullif(btrim(p_changes ->> 'city'), '') else v_new.city end;
  v_new.state := case when p_changes ? 'state' then nullif(btrim(p_changes ->> 'state'), '') else v_new.state end;
  v_new.country := case when p_changes ? 'country' then nullif(btrim(p_changes ->> 'country'), '') else v_new.country end;
  v_new.pincode := case when p_changes ? 'pincode' then nullif(btrim(p_changes ->> 'pincode'), '') else v_new.pincode end;
  v_new.bank_name := case when p_changes ? 'bank_name' then nullif(btrim(p_changes ->> 'bank_name'), '') else v_new.bank_name end;
  v_new.bank_account_name := case when p_changes ? 'bank_account_name' then nullif(btrim(p_changes ->> 'bank_account_name'), '') else v_new.bank_account_name end;
  v_new.bank_branch := case when p_changes ? 'bank_branch' then nullif(btrim(p_changes ->> 'bank_branch'), '') else v_new.bank_branch end;
  -- Identifiers: upper case, no spaces.
  v_new.gstin := case when p_changes ? 'gstin' then nullif(upper(regexp_replace(p_changes ->> 'gstin', '\s', '', 'g')), '') else v_new.gstin end;
  v_new.pan := case when p_changes ? 'pan' then nullif(upper(regexp_replace(p_changes ->> 'pan', '\s', '', 'g')), '') else v_new.pan end;
  v_new.bank_ifsc := case when p_changes ? 'bank_ifsc' then nullif(upper(regexp_replace(p_changes ->> 'bank_ifsc', '\s', '', 'g')), '') else v_new.bank_ifsc end;
  v_new.bank_account_number := case when p_changes ? 'bank_account_number' then nullif(regexp_replace(p_changes ->> 'bank_account_number', '\s', '', 'g'), '') else v_new.bank_account_number end;
  v_new.state_code := case when p_changes ? 'state_code' then nullif(btrim(p_changes ->> 'state_code'), '') else v_new.state_code end;
  -- A GSTIN begins with its state code: keep the two in step.
  if v_new.gstin is not null then
    v_new.state_code := left(v_new.gstin, 2);
  end if;

  if v_new.legal_name is null or char_length(v_new.legal_name) > 200 then
    raise exception 'Enter the legal name (up to 200 characters)' using errcode = 'PT400';
  end if;
  if v_new.address_line1 is null or v_new.city is null or v_new.state is null or v_new.pincode is null then
    raise exception 'Enter the address, city, state and PIN code' using errcode = 'PT400';
  end if;
  if v_new.gstin is not null and v_new.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'The GSTIN is not in the right format' using errcode = 'PT400';
  end if;
  if v_new.pan is not null and v_new.pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'The PAN is not in the right format' using errcode = 'PT400';
  end if;
  if v_new.gstin is not null and v_new.pan is not null and substr(v_new.gstin, 3, 10) <> v_new.pan then
    raise exception 'The PAN does not match the GSTIN' using errcode = 'PT400';
  end if;
  if v_new.state_code is null or v_new.state_code !~ '^[0-9]{2}$' then
    raise exception 'Enter the two-digit GST state code' using errcode = 'PT400';
  end if;
  if coalesce(v_new.country, 'India') = 'India' and v_new.pincode !~ '^[1-9][0-9]{5}$' then
    raise exception 'The PIN code must be 6 digits' using errcode = 'PT400';
  end if;
  if v_new.bank_ifsc is not null and v_new.bank_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'The IFSC is not in the right format' using errcode = 'PT400';
  end if;
  if v_new.bank_account_number is not null and v_new.bank_account_number !~ '^[0-9]{6,18}$' then
    raise exception 'The account number must be 6 to 18 digits' using errcode = 'PT400';
  end if;
  if greatest(char_length(v_new.address_line1), char_length(coalesce(v_new.address_line2, '')), char_length(v_new.city),
              char_length(v_new.state), char_length(coalesce(v_new.bank_name, '')), char_length(coalesce(v_new.bank_account_name, '')),
              char_length(coalesce(v_new.bank_branch, ''))) > 200 then
    raise exception 'One of the values is too long' using errcode = 'PT400';
  end if;

  if v_old.id is null then
    insert into public.organization_profiles (id, profile_code, legal_name, gstin, pan, address_line1, address_line2, city, state,
      state_code, country, pincode, bank_name, bank_account_name, bank_account_number, bank_ifsc, bank_branch)
    values (v_new.id, v_new.profile_code, v_new.legal_name, v_new.gstin, v_new.pan, v_new.address_line1, v_new.address_line2,
      v_new.city, v_new.state, v_new.state_code, coalesce(v_new.country, 'India'), v_new.pincode, v_new.bank_name,
      v_new.bank_account_name, v_new.bank_account_number, v_new.bank_ifsc, v_new.bank_branch)
    returning * into v_new;
  else
    update public.organization_profiles
    set legal_name = v_new.legal_name, gstin = v_new.gstin, pan = v_new.pan, address_line1 = v_new.address_line1,
        address_line2 = v_new.address_line2, city = v_new.city, state = v_new.state, state_code = v_new.state_code,
        country = coalesce(v_new.country, 'India'), pincode = v_new.pincode, bank_name = v_new.bank_name,
        bank_account_name = v_new.bank_account_name, bank_account_number = v_new.bank_account_number,
        bank_ifsc = v_new.bank_ifsc, bank_branch = v_new.bank_branch, updated_at = now()
    where id = v_old.id
    returning * into v_new;
  end if;

  -- The audit trail shows that the account number changed, not the number.
  v_masked_old := to_jsonb(v_old) - 'created_at' - 'updated_at' - 'invoice_prefix' - 'invoice_terms_days';
  v_masked_new := to_jsonb(v_new) - 'created_at' - 'updated_at' - 'invoice_prefix' - 'invoice_terms_days';
  -- (jsonb_set is strict: a SQL null would null the whole object, so the
  -- "not set" case is a JSON null.)
  v_masked_old := jsonb_set(v_masked_old, '{bank_account_number}',
    coalesce(to_jsonb('••••' || right(v_old.bank_account_number, 4)), 'null'::jsonb));
  v_masked_new := jsonb_set(v_masked_new, '{bank_account_number}',
    coalesce(to_jsonb('••••' || right(v_new.bank_account_number, 4)), 'null'::jsonb));
  if v_old.id is null then
    v_masked_old := null;
  end if;
  perform public.um_audit(auth.uid(), null, 'settings.company', v_masked_old, v_masked_new, '{}'::jsonb);

  return to_jsonb(v_new) - 'invoice_prefix' - 'invoice_terms_days';
end
$$;

-- Add a dropdown value at the end of its list.
create or replace function public.add_list_option(p_list text, p_value text, p_label text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.option_lists;
  v_value text := btrim(coalesce(p_value, ''));
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  perform public.settings_require_manager();
  if p_list = 'row_color' then
    v_value := lower(v_value);
  end if;
  if exists (select 1 from public.option_lists o where o.list_key = p_list and lower(o.value) = lower(v_value)) then
    raise exception 'That value is already in the list' using errcode = 'PT409';
  end if;
  begin
    insert into public.option_lists (list_key, value, label, sort_order, created_by)
    values (p_list, v_value, v_label,
            coalesce((select max(o.sort_order) from public.option_lists o where o.list_key = p_list), 0) + 10, auth.uid())
    returning * into v_row;
  exception when check_violation or not_null_violation then
    raise exception 'That value is not valid for this list' using errcode = 'PT400';
  end;
  perform public.um_audit(auth.uid(), null, 'settings.list_option_added', null,
    jsonb_build_object('list', v_row.list_key, 'value', v_row.value, 'label', v_row.label), '{}'::jsonb);
  return to_jsonb(v_row);
end
$$;

-- Hide or show a value. Values are never deleted: orders already store them.
create or replace function public.set_list_option_hidden(p_id bigint, p_hidden boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.option_lists;
begin
  perform public.settings_require_manager();
  update public.option_lists set hidden = coalesce(p_hidden, false) where id = p_id returning * into v_row;
  if v_row.id is null then
    raise exception 'Value not found' using errcode = 'PT404';
  end if;
  perform public.um_audit(auth.uid(), null, case when v_row.hidden then 'settings.list_option_hidden' else 'settings.list_option_shown' end,
    null, jsonb_build_object('list', v_row.list_key, 'value', v_row.value), '{}'::jsonb);
  return to_jsonb(v_row);
end
$$;

-- Move a value one place up (-1) or down (+1) within its list.
create or replace function public.move_list_option(p_id bigint, p_direction integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.option_lists;
  v_other public.option_lists;
begin
  perform public.settings_require_manager();
  if p_direction not in (-1, 1) then
    raise exception 'Direction must be -1 or 1' using errcode = 'PT400';
  end if;
  select * into v_row from public.option_lists where id = p_id for update;
  if v_row.id is null then
    raise exception 'Value not found' using errcode = 'PT404';
  end if;
  select * into v_other from public.option_lists o
  where o.list_key = v_row.list_key
    and case when p_direction < 0 then (o.sort_order, o.id) < (v_row.sort_order, v_row.id)
             else (o.sort_order, o.id) > (v_row.sort_order, v_row.id) end
  order by case when p_direction < 0 then o.sort_order end desc, case when p_direction < 0 then o.id end desc,
           case when p_direction > 0 then o.sort_order end, case when p_direction > 0 then o.id end
  limit 1
  for update;
  if v_other.id is null then
    return;
  end if;
  update public.option_lists set sort_order = case when id = v_row.id then v_other.sort_order else v_row.sort_order end
  where id in (v_row.id, v_other.id);
  -- Equal sort orders cannot swap; space the whole list out and retry once.
  if v_row.sort_order = v_other.sort_order then
    update public.option_lists o set sort_order = r.n * 10
    from (select id, row_number() over (order by sort_order, id) as n from public.option_lists where list_key = v_row.list_key) r
    where o.id = r.id;
    perform public.move_list_option(p_id, p_direction);
  end if;
end
$$;

-- Add (p_id null) or change a media type. Vendors refer to media by id, so a
-- rename shows everywhere at once; hiding keeps it on existing vendors.
create or replace function public.save_media(p_id bigint, p_name text, p_hidden boolean default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_old jsonb;
  v_row jsonb;
begin
  perform public.settings_require_manager();
  if v_name is not null and char_length(v_name) > 60 then
    raise exception 'Names are up to 60 characters' using errcode = 'PT400';
  end if;
  if v_name is not null and exists (select 1 from public.media m where lower(m.name) = lower(v_name) and m.id is distinct from p_id) then
    raise exception 'A media type with that name already exists' using errcode = 'PT409';
  end if;
  if p_id is null then
    if v_name is null then
      raise exception 'Enter a name' using errcode = 'PT400';
    end if;
    insert into public.media (name, hidden) values (v_name, coalesce(p_hidden, false))
    returning to_jsonb(media.*) into v_row;
  else
    select to_jsonb(m) into v_old from public.media m where m.id = p_id;
    if v_old is null then
      raise exception 'Media type not found' using errcode = 'PT404';
    end if;
    update public.media set name = coalesce(v_name, name), hidden = coalesce(p_hidden, hidden)
    where id = p_id
    returning to_jsonb(media.*) into v_row;
  end if;
  perform public.um_audit(auth.uid(), null, 'settings.media', v_old, v_row, '{}'::jsonb);
  return v_row;
end
$$;

create or replace function public.save_sub_media(p_id bigint, p_media_id bigint, p_name text, p_hidden boolean default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_media_id bigint := p_media_id;
  v_old jsonb;
  v_row jsonb;
begin
  perform public.settings_require_manager();
  if p_id is not null then
    select to_jsonb(s) into v_old from public.sub_media s where s.id = p_id;
    if v_old is null then
      raise exception 'Sub media not found' using errcode = 'PT404';
    end if;
    v_media_id := (v_old ->> 'media_id')::bigint;
  elsif not exists (select 1 from public.media m where m.id = v_media_id) then
    raise exception 'Choose the media type first' using errcode = 'PT400';
  end if;
  if v_name is not null and char_length(v_name) > 60 then
    raise exception 'Names are up to 60 characters' using errcode = 'PT400';
  end if;
  if v_name is not null and exists (select 1 from public.sub_media s
      where s.media_id = v_media_id and lower(s.name) = lower(v_name) and s.id is distinct from p_id) then
    raise exception 'That media type already has a sub media with that name' using errcode = 'PT409';
  end if;
  if p_id is null then
    if v_name is null then
      raise exception 'Enter a name' using errcode = 'PT400';
    end if;
    insert into public.sub_media (media_id, name, hidden) values (v_media_id, v_name, coalesce(p_hidden, false))
    returning to_jsonb(sub_media.*) into v_row;
  else
    update public.sub_media set name = coalesce(v_name, name), hidden = coalesce(p_hidden, hidden)
    where id = p_id
    returning to_jsonb(sub_media.*) into v_row;
  end if;
  perform public.um_audit(auth.uid(), null, 'settings.sub_media', v_old, v_row, '{}'::jsonb);
  return v_row;
end
$$;

-- ── Execution rights: signed-in staff only; the functions check the rest ───

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_my_preferences(jsonb)',
    'public.settings_require_manager()',
    'public.get_settings()',
    'public.update_organization_settings(jsonb)',
    'public.get_organization_profile()',
    'public.update_organization_profile(jsonb)',
    'public.add_list_option(text, text, text)',
    'public.set_list_option_hidden(bigint, boolean)',
    'public.move_list_option(bigint, integer)',
    'public.save_media(bigint, text, boolean)',
    'public.save_sub_media(bigint, bigint, text, boolean)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
-- my_access() was replaced in place above, so it keeps its existing grants.

notify pgrst, 'reload schema';
