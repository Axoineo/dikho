-- ============================================================================
-- EMAIL HUB, part 2: consent and suppression, delivery events from Amazon
-- SES, templates, and campaigns that need someone else's approval.
-- Decision record: docs/decisions/0009-email-hub.md.
--
-- CONSENT (email_preferences, one row per address)
--   - A CRM record is not permission to send marketing. Campaigns go only to
--     addresses whose marketing preference is 'subscribed', recorded with its
--     source, and that are not suppressed.
--   - Unsubscribing (link, one-click header, or a person's request) sets
--     'unsubscribed'. A complaint does the same. A permanent bounce suppresses
--     the address for all mail. Every campaign send re-checks this row at the
--     moment it is claimed, not only when the audience was chosen.
--
-- APPROVAL (email_campaigns)
--   - Submitting freezes the audience into email_campaign_recipients and
--     computes snapshot_hash over everything an approver judges: sender,
--     reply-to, subject, preheader, content, the audience definition, the
--     exact recipient list and the schedule.
--   - Approval names that hash. Changing anything afterwards returns the
--     campaign to draft and clears the approval. Nobody approves a campaign
--     they created or submitted. Dispatch re-checks approved_hash =
--     snapshot_hash before every batch.
--
-- SENDING
--   - Recipients are claimed in batches with FOR UPDATE SKIP LOCKED, and the
--     daily budget row is advanced in the same statement, so two workers
--     cannot claim the same person or overspend the cap.
--   - A claim that never reported back (the Worker died mid-send) becomes
--     'uncertain', never 'pending': it is not sent again automatically.
--   - (campaign_id, email) is unique: one campaign mails one address once.
--
-- BROWSER ACCESS: none, as in part 1. The Worker calls the em_* functions.
--
-- ORDER: needs 20261021120000_email_hub_mailboxes.sql. Uses pgcrypto
-- (extensions schema) for snapshot hashes. Harmless before the API that uses
-- it is deployed. If applied with the Supabase MCP `apply_migration` tool,
-- rename this file to the version it records (supabase/AGENTS.md).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Permissions
-- ─────────────────────────────────────────────────────────────────────────
insert into public.permissions (key, module, action, label, description, allowed_scopes, developer_only, min_developer_level, sort_order) values
  ('email_campaigns.view',    'Email', 'view',    'View email campaigns and results', null, array['all'], false, null, 410),
  ('email_campaigns.create',  'Email', 'create',  'Create email campaigns',
   'Write campaigns and submit them for approval. Sending needs someone else''s approval.', array['all'], false, null, 411),
  ('email_campaigns.approve', 'Email', 'approve', 'Approve email campaigns',
   'Approve or reject campaigns written by others. Never their own.', array['all'], false, null, 412),
  ('email_templates.manage',  'Email', 'edit',    'Manage email templates', null, array['all'], false, null, 413),
  ('email_consent.manage',    'Email', 'edit',    'Manage email consent and suppression',
   'Record marketing consent, unsubscribe or re-subscribe an address, lift a suppression.', array['all'], false, null, 414)
on conflict (key) do update set
  module = excluded.module, action = excluded.action, label = excluded.label,
  description = excluded.description, allowed_scopes = excluded.allowed_scopes,
  developer_only = excluded.developer_only, min_developer_level = excluded.min_developer_level,
  sort_order = excluded.sort_order;

insert into public.template_permissions (template_id, permission_key, scope)
select t.id, v.permission_key, 'all'
from (values
  ('administrator', 'email_campaigns.view'), ('administrator', 'email_campaigns.create'),
  ('administrator', 'email_campaigns.approve'), ('administrator', 'email_templates.manage'),
  ('administrator', 'email_consent.manage'),
  ('marketing', 'email_campaigns.view'), ('marketing', 'email_campaigns.create'), ('marketing', 'email_templates.manage'),
  ('management', 'email_campaigns.view')
) as v (template_key, permission_key)
join public.permission_templates t on t.key = v.template_key
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Tables
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.email_preferences (
  email text primary key check (char_length(email) <= 254 and email = lower(email) and email ~ '^[^[:space:]@]{1,64}@[^[:space:]@]{1,189}\.[^[:space:]@]{2,63}$'),
  marketing text check (marketing in ('subscribed', 'unsubscribed')),
  marketing_source text check (marketing_source in ('form', 'verbal', 'written', 'imported', 'unsubscribe_link', 'complaint', 'request')),
  marketing_note text check (char_length(marketing_note) <= 300),
  marketing_changed_at timestamptz,
  marketing_changed_by uuid references public.staff_members (user_id) on delete set null,
  suppressed boolean not null default false,
  suppressed_reason text check (suppressed_reason in ('hard_bounce', 'manual')),
  suppressed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (suppressed = (suppressed_reason is not null))
);
create index if not exists email_preferences_changed_by_idx on public.email_preferences (marketing_changed_by);

-- Delivery events from SES, normalized. No raw payload and no addresses:
-- effects on addresses are applied to email_preferences when recorded.
-- Kept 180 days (pruned on insert).
create table if not exists public.email_delivery_events (
  id bigint generated always as identity primary key,
  notification_id text not null unique check (char_length(notification_id) between 1 and 100),
  provider text not null default 'ses' check (provider in ('ses')),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  event_type text not null check (event_type in ('send', 'delivery', 'bounce', 'complaint', 'reject', 'delivery_delay', 'rendering_failure', 'other')),
  recipient_count integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists email_delivery_events_message_idx on public.email_delivery_events (provider_message_id);
create index if not exists email_delivery_events_time_idx on public.email_delivery_events (received_at);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('marketing', 'transactional')),
  subject text not null default '' check (char_length(subject) <= 900),
  preheader text not null default '' check (char_length(preheader) <= 200),
  html text not null default '' check (char_length(html) <= 500000),
  text_body text not null default '' check (char_length(text_body) <= 200000),
  version integer not null default 1,
  archived_at timestamptz,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.staff_members (user_id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists email_templates_name_key on public.email_templates (lower(name)) where archived_at is null;
create index if not exists email_templates_created_by_idx on public.email_templates (created_by);
create index if not exists email_templates_updated_by_idx on public.email_templates (updated_by);

create table if not exists public.email_template_versions (
  template_id uuid not null references public.email_templates (id) on delete cascade,
  version integer not null,
  subject text not null,
  preheader text not null,
  html text not null,
  text_body text not null,
  saved_by uuid references public.staff_members (user_id) on delete set null,
  saved_at timestamptz not null default now(),
  primary key (template_id, version)
);
create index if not exists email_template_versions_saved_by_idx on public.email_template_versions (saved_by);

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'rejected', 'sending', 'paused', 'sent', 'cancelled')),
  from_name text not null default '' check (char_length(from_name) <= 120),
  from_email text not null default '' check (char_length(from_email) <= 254),
  reply_to text check (char_length(reply_to) <= 254),
  subject text not null default '' check (char_length(subject) <= 900),
  preheader text not null default '' check (char_length(preheader) <= 200),
  html text not null default '' check (char_length(html) <= 500000),
  text_body text not null default '' check (char_length(text_body) <= 200000),
  template_id uuid references public.email_templates (id) on delete set null,
  audience jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  send_at timestamptz,
  snapshot_hash text,
  recipient_count integer not null default 0,
  created_by uuid not null references public.staff_members (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.staff_members (user_id) on delete set null,
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.staff_members (user_id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references public.staff_members (user_id) on delete set null,
  approved_at timestamptz,
  approved_hash text,
  decision_note text check (char_length(decision_note) <= 500),
  started_at timestamptz,
  finished_at timestamptz,
  check ((status in ('approved', 'sending', 'paused', 'sent')) = (approved_hash is not null) or status = 'cancelled')
);
create index if not exists email_campaigns_status_idx on public.email_campaigns (status, send_at);
create index if not exists email_campaigns_created_by_idx on public.email_campaigns (created_by);
create index if not exists email_campaigns_template_idx on public.email_campaigns (template_id);
create index if not exists email_campaigns_people_idx on public.email_campaigns (submitted_by, approved_by, updated_by);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  email text not null check (char_length(email) <= 254),
  name text check (char_length(name) <= 120),
  company text check (char_length(company) <= 200),
  source_type text not null check (source_type in ('client', 'vendor', 'lead')),
  source_id text not null check (char_length(source_id) <= 40),
  status text not null default 'pending' check (status in (
    'pending', 'sending', 'sent', 'failed', 'uncertain', 'skipped', 'delivered', 'bounced', 'complained', 'unsubscribed')),
  skip_reason text check (char_length(skip_reason) <= 60),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  unique (campaign_id, email)
);
create index if not exists email_campaign_recipients_pending_idx on public.email_campaign_recipients (campaign_id, status);
create index if not exists email_campaign_recipients_message_idx on public.email_campaign_recipients (provider_message_id) where provider_message_id is not null;

-- Global daily ceiling on campaign sends (UTC days).
create table if not exists public.email_send_budget (
  day date primary key,
  sent integer not null default 0 check (sent >= 0)
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'email_preferences', 'email_delivery_events', 'email_templates', 'email_template_versions',
    'email_campaigns', 'email_campaign_recipients', 'email_send_budget'
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
-- 3. Consent, suppression, delivery events
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.em_valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(char_length(p_email) <= 254
    and p_email ~ '^[^[:space:]@]{1,64}@[^[:space:]@]{1,189}\.[^[:space:]@]{2,63}$', false)
$$;

-- May this address receive marketing now? Subscribed and not suppressed.
create or replace function public.em_marketable(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.marketing = 'subscribed' and not p.suppressed
    from public.email_preferences p where p.email = lower(btrim(p_email))
  ), false)
$$;

create or replace function public.em_preference_json(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email', lower(btrim(p_email)),
    'marketing', p.marketing,
    'marketing_source', p.marketing_source,
    'marketing_note', p.marketing_note,
    'marketing_changed_at', p.marketing_changed_at,
    'marketing_changed_by_name', (select m.full_name from public.staff_members m where m.user_id = p.marketing_changed_by),
    'suppressed', coalesce(p.suppressed, false),
    'suppressed_reason', p.suppressed_reason,
    'suppressed_at', p.suppressed_at
  )
  from (select 1) one
  left join public.email_preferences p on p.email = lower(btrim(p_email))
$$;

-- Staff change an address's consent or suppression (email_consent.manage).
-- p_change: { marketing: 'subscribed'|'unsubscribed'|null, source, note, unsuppress: bool, suppress: bool }
create or replace function public.em_set_preference(p_actor uuid, p_email text, p_change jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_old jsonb;
  v_marketing text := p_change ->> 'marketing';
  v_source text := p_change ->> 'source';
begin
  perform public.um_actor(p_actor, 'email_consent.manage');
  if not public.em_valid_email(v_email) then
    perform public.um_fail(400, 'Enter a valid email address.');
  end if;
  if p_change ? 'marketing' and v_marketing is not null and v_marketing not in ('subscribed', 'unsubscribed') then
    perform public.um_fail(400, 'Unknown marketing preference.');
  end if;
  if v_marketing = 'subscribed' and coalesce(v_source, '') not in ('form', 'verbal', 'written', 'imported') then
    perform public.um_fail(400, 'Say how this person agreed to receive marketing email (form, verbal, written or imported).');
  end if;
  v_old := public.em_preference_json(v_email);

  insert into public.email_preferences (email) values (v_email) on conflict (email) do nothing;
  update public.email_preferences
  set marketing = case when p_change ? 'marketing' then v_marketing else marketing end,
      marketing_source = case when p_change ? 'marketing' then coalesce(v_source, 'request') else marketing_source end,
      marketing_note = case when p_change ? 'marketing' then left(p_change ->> 'note', 300) else marketing_note end,
      marketing_changed_at = case when p_change ? 'marketing' then now() else marketing_changed_at end,
      marketing_changed_by = case when p_change ? 'marketing' then p_actor else marketing_changed_by end,
      suppressed = case when coalesce((p_change ->> 'suppress')::boolean, false) then true
                        when coalesce((p_change ->> 'unsuppress')::boolean, false) then false else suppressed end,
      suppressed_reason = case when coalesce((p_change ->> 'suppress')::boolean, false) then 'manual'
                               when coalesce((p_change ->> 'unsuppress')::boolean, false) then null else suppressed_reason end,
      suppressed_at = case when coalesce((p_change ->> 'suppress')::boolean, false) then now()
                           when coalesce((p_change ->> 'unsuppress')::boolean, false) then null else suppressed_at end,
      updated_at = now()
  where email = v_email;

  perform public.um_audit(p_actor, null, 'email_consent.changed', v_old, public.em_preference_json(v_email), p_ctx,
    jsonb_build_object('email_domain', split_part(v_email, '@', 2)));
  return public.em_preference_json(v_email);
end
$$;

create or replace function public.em_get_preference(p_actor uuid, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.em_holds(p_actor, 'email_consent.manage') or public.em_holds(p_actor, 'email_campaigns.create')) then
    perform public.um_actor(p_actor, 'email_consent.manage');
  end if;
  perform public.um_actor(p_actor, null);
  if not public.em_valid_email(lower(btrim(coalesce(p_email, '')))) then
    perform public.um_fail(400, 'Enter a valid email address.');
  end if;
  return public.em_preference_json(p_email);
end
$$;

-- An unsubscribe link or one-click POST, already verified by the Worker's
-- signature check. Idempotent.
create or replace function public.em_unsubscribe_recipient(p_recipient uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.email_campaign_recipients;
begin
  select * into v_row from public.email_campaign_recipients where id = p_recipient;
  if v_row.id is null then
    return null;
  end if;
  insert into public.email_preferences (email, marketing, marketing_source, marketing_changed_at)
  values (v_row.email, 'unsubscribed', 'unsubscribe_link', now())
  on conflict (email) do update
    set marketing = 'unsubscribed', marketing_source = 'unsubscribe_link', marketing_changed_at = now(),
        marketing_changed_by = null, updated_at = now()
    where public.email_preferences.marketing is distinct from 'unsubscribed';
  update public.email_campaign_recipients set status = 'unsubscribed'
  where id = p_recipient and status in ('sent', 'delivered');
  return jsonb_build_object('email', v_row.email);
end
$$;

-- One SES event, normalized by the Worker after verifying SNS's signature.
-- p_event: { notification_id, provider_message_id, event_type, occurred_at,
--            recipients: [emails], permanent: bool, detail: {} }
-- Returns 'duplicate' for a notification already recorded (SNS retries).
create or replace function public.em_record_delivery_event(p_event jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_type text := p_event ->> 'event_type';
  v_message text := left(p_event ->> 'provider_message_id', 200);
  v_recipients text[];
begin
  if v_type not in ('send', 'delivery', 'bounce', 'complaint', 'reject', 'delivery_delay', 'rendering_failure', 'other') then
    v_type := 'other';
  end if;
  select coalesce(array_agg(lower(btrim(r))) filter (where public.em_valid_email(lower(btrim(r)))), '{}')
  into v_recipients
  from (select jsonb_array_elements_text(case when jsonb_typeof(p_event -> 'recipients') = 'array' then p_event -> 'recipients' else '[]'::jsonb end) r limit 50) x;

  insert into public.email_delivery_events (notification_id, provider_message_id, event_type, recipient_count, detail, occurred_at)
  values (left(p_event ->> 'notification_id', 100), v_message, v_type, cardinality(v_recipients),
          coalesce(p_event -> 'detail', '{}'::jsonb), (p_event ->> 'occurred_at')::timestamptz)
  on conflict (notification_id) do nothing;
  if not found then
    return 'duplicate';
  end if;
  delete from public.email_delivery_events where received_at < now() - interval '180 days';

  if v_type = 'bounce' and coalesce((p_event ->> 'permanent')::boolean, false) then
    insert into public.email_preferences (email, suppressed, suppressed_reason, suppressed_at)
    select r, true, 'hard_bounce', now() from unnest(v_recipients) r
    on conflict (email) do update set suppressed = true, suppressed_reason = 'hard_bounce', suppressed_at = now(), updated_at = now();
  elsif v_type = 'complaint' then
    insert into public.email_preferences (email, marketing, marketing_source, marketing_changed_at)
    select r, 'unsubscribed', 'complaint', now() from unnest(v_recipients) r
    on conflict (email) do update set marketing = 'unsubscribed', marketing_source = 'complaint', marketing_changed_at = now(),
      marketing_changed_by = null, updated_at = now();
  end if;

  if v_message is not null and v_type in ('delivery', 'bounce', 'complaint', 'reject') then
    update public.email_campaign_recipients
    set status = case v_type when 'delivery' then 'delivered' when 'complaint' then 'complained'
                             when 'bounce' then 'bounced' else 'failed' end
    where provider_message_id = v_message
      -- Never step back: a complaint after delivery stays a complaint.
      and (status in ('sent', 'uncertain') or (status = 'delivered' and v_type in ('bounce', 'complaint')));
  end if;
  return 'recorded';
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Templates
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.em_template_json(p_template public.email_templates, p_full boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_template.id, 'name', p_template.name, 'kind', p_template.kind, 'subject', p_template.subject,
    'preheader', p_template.preheader, 'version', p_template.version, 'archived', p_template.archived_at is not null,
    'updated_at', p_template.updated_at,
    'updated_by_name', (select m.full_name from public.staff_members m where m.user_id = p_template.updated_by)
  ) || case when p_full then jsonb_build_object(
    'html', p_template.html, 'text_body', p_template.text_body,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('version', v.version, 'subject', v.subject, 'saved_at', v.saved_at,
               'saved_by_name', (select m.full_name from public.staff_members m where m.user_id = v.saved_by)) order by v.version desc)
      from public.email_template_versions v where v.template_id = p_template.id
    ), '[]'::jsonb)) else '{}'::jsonb end
$$;

create or replace function public.em_list_templates(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.um_actor(p_actor, null);
  if not (public.em_holds(p_actor, 'email_templates.manage') or public.em_holds(p_actor, 'email_campaigns.create')
          or public.em_holds(p_actor, 'email_campaigns.view')) then
    perform public.um_fail(403, 'You do not have permission to do this.');
  end if;
  return coalesce((select jsonb_agg(public.em_template_json(t, false) order by t.updated_at desc)
                   from public.email_templates t where t.archived_at is null), '[]'::jsonb);
end
$$;

create or replace function public.em_get_template(p_actor uuid, p_template uuid, p_version integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_template public.email_templates;
  v_version public.email_template_versions;
begin
  perform public.em_list_templates(p_actor);
  select * into v_template from public.email_templates where id = p_template;
  if v_template.id is null then
    perform public.um_fail(404, 'Template not found.');
  end if;
  if p_version is not null then
    select * into v_version from public.email_template_versions where template_id = p_template and version = p_version;
    if v_version.template_id is null then
      perform public.um_fail(404, 'That version does not exist.');
    end if;
    v_template.subject := v_version.subject;
    v_template.preheader := v_version.preheader;
    v_template.html := v_version.html;
    v_template.text_body := v_version.text_body;
    v_template.version := v_version.version;
  end if;
  return public.em_template_json(v_template, true);
end
$$;

-- Creates (p_template null) or saves a new version. HTML arrives sanitized
-- and variable-checked by the Worker.
create or replace function public.em_save_template(p_actor uuid, p_template uuid, p_fields jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_template public.email_templates;
begin
  perform public.um_actor(p_actor, 'email_templates.manage');
  if p_template is null then
    if coalesce(p_fields ->> 'kind', '') not in ('marketing', 'transactional') then
      perform public.um_fail(400, 'Choose marketing or transactional.');
    end if;
    begin
      insert into public.email_templates (name, kind, subject, preheader, html, text_body, created_by, updated_by)
      values (btrim(p_fields ->> 'name'), p_fields ->> 'kind', coalesce(p_fields ->> 'subject', ''), coalesce(p_fields ->> 'preheader', ''),
              coalesce(p_fields ->> 'html', ''), coalesce(p_fields ->> 'text_body', ''), p_actor, p_actor)
      returning * into v_template;
    exception when unique_violation then
      perform public.um_fail(409, 'A template with this name already exists.');
    when check_violation or not_null_violation then
      perform public.um_fail(400, 'Check the template: a name is required and fields have length limits.');
    end;
  else
    select * into v_template from public.email_templates where id = p_template and archived_at is null for update;
    if v_template.id is null then
      perform public.um_fail(404, 'Template not found.');
    end if;
    begin
      update public.email_templates
      set name = coalesce(nullif(btrim(p_fields ->> 'name'), ''), name),
          subject = coalesce(p_fields ->> 'subject', subject),
          preheader = coalesce(p_fields ->> 'preheader', preheader),
          html = coalesce(p_fields ->> 'html', html),
          text_body = coalesce(p_fields ->> 'text_body', text_body),
          version = version + 1, updated_by = p_actor, updated_at = now()
      where id = p_template
      returning * into v_template;
    exception when unique_violation then
      perform public.um_fail(409, 'A template with this name already exists.');
    when check_violation then
      perform public.um_fail(400, 'Check the template: fields have length limits.');
    end;
  end if;
  insert into public.email_template_versions (template_id, version, subject, preheader, html, text_body, saved_by)
  values (v_template.id, v_template.version, v_template.subject, v_template.preheader, v_template.html, v_template.text_body, p_actor);
  return public.em_template_json(v_template, true);
end
$$;

create or replace function public.em_archive_template(p_actor uuid, p_template uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.um_actor(p_actor, 'email_templates.manage');
  update public.email_templates set archived_at = now(), updated_by = p_actor, updated_at = now()
  where id = p_template and archived_at is null;
  if not found then
    perform public.um_fail(404, 'Template not found.');
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Audiences. Built only from fields that exist in this database:
--    clients (country, state, city, status), vendors (media / sub-media,
--    status, default address), corporate-gifting leads (city). A kind is
--    included only if the actor may view that kind of record.
--    p_spec: { sources: ['client','vendor','lead'], country: [], state: [],
--              city: [], media: [ids], sub_media: [ids], active_only: bool }
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.em_audience_rows(p_actor uuid, p_spec jsonb)
returns table (email text, name text, company text, source_type text, source_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sources text[] := array(select jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'sources') = 'array' then p_spec -> 'sources' else '[]'::jsonb end));
  v_country text[] := array(select lower(btrim(x)) from jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'country') = 'array' then p_spec -> 'country' else '[]'::jsonb end) x);
  v_state text[] := array(select lower(btrim(x)) from jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'state') = 'array' then p_spec -> 'state' else '[]'::jsonb end) x);
  v_city text[] := array(select lower(btrim(x)) from jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'city') = 'array' then p_spec -> 'city' else '[]'::jsonb end) x);
  v_media bigint[] := array(select x::bigint from jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'media') = 'array' then p_spec -> 'media' else '[]'::jsonb end) x where x ~ '^[0-9]{1,18}$');
  v_sub bigint[] := array(select x::bigint from jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'sub_media') = 'array' then p_spec -> 'sub_media' else '[]'::jsonb end) x where x ~ '^[0-9]{1,18}$');
  v_active boolean := coalesce((p_spec ->> 'active_only')::boolean, true);
begin
  return query
  select distinct on (lower(btrim(s.email))) lower(btrim(s.email)), left(s.name, 120), left(s.company, 200), s.source_type, s.source_id
  from (
    select c.email, coalesce(c.contact_person, c.company_name) as name, c.company_name as company, 'client'::text as source_type, c.id::text as source_id, 1 as rank
    from public.clients c
    where 'client' = any (v_sources) and public.em_holds(p_actor, 'clients.view')
      and (not v_active or coalesce(c.status, 1) = 1)
      and (cardinality(v_country) = 0 or lower(btrim(c.country)) = any (v_country))
      and (cardinality(v_state) = 0 or lower(btrim(c.state)) = any (v_state))
      and (cardinality(v_city) = 0 or lower(btrim(c.city)) = any (v_city))
      and cardinality(v_media) = 0 and cardinality(v_sub) = 0
    union all
    select v.email, coalesce(v.contact_person, v.company_name), v.company_name, 'vendor', v.id::text, 2
    from public.vendors v
    left join lateral (
      select a.country, a.state, a.city from public.vendor_addresses a
      where a.vendor_id = v.id order by a.is_default desc nulls last, a.id limit 1
    ) a on true
    where 'vendor' = any (v_sources) and public.em_holds(p_actor, 'vendors.view')
      and (not v_active or coalesce(v.status, 1) = 1)
      and (cardinality(v_country) = 0 or lower(btrim(a.country)) = any (v_country))
      and (cardinality(v_state) = 0 or lower(btrim(a.state)) = any (v_state))
      and (cardinality(v_city) = 0 or lower(btrim(a.city)) = any (v_city))
      and (cardinality(v_media) = 0 or v.media_id = any (v_media))
      and (cardinality(v_sub) = 0 or v.sub_media_id = any (v_sub))
    union all
    select g.email, g.name, g.company_name, 'lead', g.id::text, 3
    from public.cg_leads g
    where 'lead' = any (v_sources) and public.em_holds(p_actor, 'leads.view')
      and cardinality(v_country) = 0 and cardinality(v_state) = 0
      and (cardinality(v_city) = 0 or lower(btrim(g.city)) = any (v_city))
      and cardinality(v_media) = 0 and cardinality(v_sub) = 0
  ) s
  where public.em_valid_email(lower(btrim(s.email)))
  order by lower(btrim(s.email)), s.rank, s.source_id;
end
$$;

create or replace function public.em_audience_preview(p_actor uuid, p_spec jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.um_actor(p_actor, 'email_campaigns.create');
  return (
    with rows as (
      select r.*, p.marketing, coalesce(p.suppressed, false) as suppressed
      from public.em_audience_rows(p_actor, p_spec) r
      left join public.email_preferences p on p.email = r.email
    )
    select jsonb_build_object(
      'matched', count(*),
      'eligible', count(*) filter (where marketing = 'subscribed' and not suppressed),
      'no_consent', count(*) filter (where marketing is null and not suppressed),
      'unsubscribed', count(*) filter (where marketing = 'unsubscribed' and not suppressed),
      'suppressed', count(*) filter (where suppressed),
      'by_source', jsonb_build_object(
        'client', count(*) filter (where source_type = 'client'),
        'vendor', count(*) filter (where source_type = 'vendor'),
        'lead', count(*) filter (where source_type = 'lead')),
      'can_use', jsonb_build_object(
        'client', public.em_holds(p_actor, 'clients.view'),
        'vendor', public.em_holds(p_actor, 'vendors.view'),
        'lead', public.em_holds(p_actor, 'leads.view')),
      'sample', coalesce((select jsonb_agg(jsonb_build_object('email', s.email, 'name', s.name, 'company', s.company, 'source_type', s.source_type))
                          from (select * from rows where marketing = 'subscribed' and not suppressed order by email limit 8) s), '[]'::jsonb)
    )
    from rows
  );
end
$$;

-- What the audience filters can choose from, from real data.
create or replace function public.em_audience_options(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.um_actor(p_actor, 'email_campaigns.create');
  return jsonb_build_object(
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name) from public.media m), '[]'::jsonb),
    'sub_media', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'media_id', s.media_id, 'name', s.name) order by s.name) from public.sub_media s), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(x order by x) from (
      select distinct initcap(btrim(country)) x from public.clients where public.em_holds(p_actor, 'clients.view') and nullif(btrim(country), '') is not null
      union select distinct initcap(btrim(country)) from public.vendor_addresses where public.em_holds(p_actor, 'vendors.view') and nullif(btrim(country), '') is not null) c), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(x order by x) from (
      select distinct initcap(btrim(state)) x from public.clients where public.em_holds(p_actor, 'clients.view') and nullif(btrim(state), '') is not null
      union select distinct initcap(btrim(state)) from public.vendor_addresses where public.em_holds(p_actor, 'vendors.view') and nullif(btrim(state), '') is not null) s), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(x order by x) from (
      select distinct initcap(btrim(city)) x from public.clients where public.em_holds(p_actor, 'clients.view') and nullif(btrim(city), '') is not null
      union select distinct initcap(btrim(city)) from public.vendor_addresses where public.em_holds(p_actor, 'vendors.view') and nullif(btrim(city), '') is not null
      union select distinct initcap(btrim(city)) from public.cg_leads where public.em_holds(p_actor, 'leads.view') and nullif(btrim(city), '') is not null) t), '[]'::jsonb)
  );
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Campaigns
-- ─────────────────────────────────────────────────────────────────────────
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
    'subject', p_campaign.subject, 'preheader', p_campaign.preheader, 'template_id', p_campaign.template_id,
    'audience', p_campaign.audience, 'send_at', p_campaign.send_at, 'recipient_count', p_campaign.recipient_count,
    'snapshot_hash', p_campaign.snapshot_hash, 'approved_hash', p_campaign.approved_hash,
    'created_by', p_campaign.created_by,
    'created_by_name', (select m.full_name from public.staff_members m where m.user_id = p_campaign.created_by),
    'created_at', p_campaign.created_at, 'updated_at', p_campaign.updated_at,
    'submitted_by_name', (select m.full_name from public.staff_members m where m.user_id = p_campaign.submitted_by),
    'submitted_by', p_campaign.submitted_by, 'submitted_at', p_campaign.submitted_at,
    'approved_by_name', (select m.full_name from public.staff_members m where m.user_id = p_campaign.approved_by),
    'approved_at', p_campaign.approved_at, 'decision_note', p_campaign.decision_note,
    'started_at', p_campaign.started_at, 'finished_at', p_campaign.finished_at,
    'stats', (select jsonb_object_agg(r.status, r.n) from (
       select status, count(*) n from public.email_campaign_recipients where campaign_id = p_campaign.id group by status) r)
  ) || case when p_full then jsonb_build_object('html', p_campaign.html, 'text_body', p_campaign.text_body) else '{}'::jsonb end
$$;

create or replace function public.em_campaign_access(p_actor uuid, p_campaign uuid, p_lock boolean)
returns public.email_campaigns
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign public.email_campaigns;
begin
  perform public.um_actor(p_actor, null);
  if not (public.em_holds(p_actor, 'email_campaigns.view') or public.em_holds(p_actor, 'email_campaigns.create')
          or public.em_holds(p_actor, 'email_campaigns.approve')) then
    perform public.um_fail(403, 'You do not have permission to do this.');
  end if;
  if p_lock then
    select * into v_campaign from public.email_campaigns where id = p_campaign for update;
  else
    select * into v_campaign from public.email_campaigns where id = p_campaign;
  end if;
  if v_campaign.id is null then
    perform public.um_fail(404, 'Campaign not found.');
  end if;
  return v_campaign;
end
$$;

create or replace function public.em_list_campaigns(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.um_actor(p_actor, null);
  if not (public.em_holds(p_actor, 'email_campaigns.view') or public.em_holds(p_actor, 'email_campaigns.create')
          or public.em_holds(p_actor, 'email_campaigns.approve')) then
    perform public.um_fail(403, 'You do not have permission to do this.');
  end if;
  return coalesce((select jsonb_agg(public.em_campaign_json(c, false) order by c.updated_at desc)
                   from (select * from public.email_campaigns order by updated_at desc limit 200) c), '[]'::jsonb);
end
$$;

create or replace function public.em_get_campaign(p_actor uuid, p_campaign uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return public.em_campaign_json(public.em_campaign_access(p_actor, p_campaign, false), true)
    || jsonb_build_object(
      'can_edit', public.em_holds(p_actor, 'email_campaigns.create'),
      'can_approve', public.em_holds(p_actor, 'email_campaigns.approve'),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object('event', a.event_type, 'at', a.occurred_at,
                 'by', (select m.full_name from public.staff_members m where m.user_id = a.actor_id),
                 'note', a.new_value ->> 'note') order by a.id)
        from public.audit_log a
        where a.event_type like 'email\_campaign.%' and a.metadata ->> 'campaign_id' = p_campaign::text
      ), '[]'::jsonb));
end
$$;

-- Saves a draft (p_campaign null creates one). Editing anything after
-- submission returns the campaign to draft and clears its approval.
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
begin
  perform public.um_actor(p_actor, 'email_campaigns.create');
  if p_fields ? 'reply_to' and nullif(btrim(p_fields ->> 'reply_to'), '') is not null
     and not public.em_valid_email(lower(btrim(p_fields ->> 'reply_to'))) then
    perform public.um_fail(400, 'Reply-to must be a valid email address.');
  end if;

  if p_campaign is null then
    begin
      insert into public.email_campaigns (name, from_name, from_email, reply_to, subject, preheader, html, text_body, template_id, audience, send_at, created_by, updated_by)
      values (btrim(coalesce(p_fields ->> 'name', '')), coalesce(p_fields ->> 'from_name', ''), lower(coalesce(p_fields ->> 'from_email', '')),
              nullif(lower(btrim(p_fields ->> 'reply_to')), ''), coalesce(p_fields ->> 'subject', ''), coalesce(p_fields ->> 'preheader', ''),
              coalesce(p_fields ->> 'html', ''), coalesce(p_fields ->> 'text_body', ''),
              case when p_fields ->> 'template_id' ~ '^[0-9a-f-]{36}$' then (p_fields ->> 'template_id')::uuid end,
              coalesce(case when jsonb_typeof(p_fields -> 'audience') = 'object' then p_fields -> 'audience' end, '{}'::jsonb),
              (p_fields ->> 'send_at')::timestamptz, p_actor, p_actor)
      returning * into v_campaign;
    exception when check_violation then
      perform public.um_fail(400, 'Give the campaign a name. Check field lengths.');
    end;
    perform public.um_audit(p_actor, null, 'email_campaign.created', null, jsonb_build_object('name', v_campaign.name), p_ctx,
      jsonb_build_object('campaign_id', v_campaign.id));
    return public.em_campaign_json(v_campaign, true);
  end if;

  v_campaign := public.em_campaign_access(p_actor, p_campaign, true);
  -- Once anything has gone out, the recipient list is the record of who got
  -- what: no edits, duplicate instead.
  if v_campaign.status in ('sending', 'sent', 'cancelled') or v_campaign.started_at is not null then
    perform public.um_fail(409, 'This campaign has started or ended and can no longer be changed. Duplicate it instead.');
  end if;
  v_was := v_campaign.status;

  begin
    update public.email_campaigns
    set name = coalesce(nullif(btrim(p_fields ->> 'name'), ''), name),
        from_name = coalesce(p_fields ->> 'from_name', from_name),
        from_email = coalesce(lower(p_fields ->> 'from_email'), from_email),
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

-- What an approval covers. Changing any of it changes the hash.
create or replace function public.em_campaign_hash(p_campaign uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'from_name', c.from_name, 'from_email', c.from_email, 'reply_to', c.reply_to,
    'subject', c.subject, 'preheader', c.preheader, 'html', c.html, 'text_body', c.text_body,
    'audience', c.audience, 'send_at', c.send_at,
    'recipients', (select coalesce(string_agg(r.email, ',' order by r.email), '')
                   from public.email_campaign_recipients r where r.campaign_id = c.id)
  )::text, 'UTF8'), 'sha256'), 'hex')
  from public.email_campaigns c where c.id = p_campaign
$$;

-- Freezes the audience and asks for approval. p_max bounds the list.
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
begin
  perform public.um_actor(p_actor, 'email_campaigns.create');
  v_campaign := public.em_campaign_access(p_actor, p_campaign, true);
  if v_campaign.status not in ('draft', 'rejected') then
    perform public.um_fail(409, 'Only a draft can be submitted for approval.');
  end if;
  if btrim(v_campaign.subject) = '' or btrim(v_campaign.html) = '' or v_campaign.from_email = '' then
    perform public.um_fail(400, 'A campaign needs a sender, a subject and content before it can be submitted.');
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

-- Approve or reject exactly the version the approver reviewed (p_hash).
create or replace function public.em_decide_campaign(p_actor uuid, p_campaign uuid, p_approve boolean, p_hash text, p_note text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign public.email_campaigns;
begin
  perform public.um_actor(p_actor, 'email_campaigns.approve');
  v_campaign := public.em_campaign_access(p_actor, p_campaign, true);
  if v_campaign.status <> 'pending_approval' then
    perform public.um_fail(409, 'This campaign is not waiting for approval.');
  end if;
  if p_actor = v_campaign.created_by or p_actor is not distinct from v_campaign.submitted_by then
    perform public.um_fail(403, 'You cannot approve or reject a campaign you wrote or submitted. Ask another approver.');
  end if;
  if p_hash is null or p_hash is distinct from v_campaign.snapshot_hash
     or v_campaign.snapshot_hash is distinct from public.em_campaign_hash(p_campaign) then
    perform public.um_fail(409, 'This campaign changed after you opened it. Review it again.');
  end if;

  update public.email_campaigns
  set status = case when p_approve then 'approved' else 'rejected' end,
      approved_by = case when p_approve then p_actor end,
      approved_at = case when p_approve then now() end,
      approved_hash = case when p_approve then v_campaign.snapshot_hash end,
      decision_note = left(p_note, 500),
      updated_at = now()
  where id = p_campaign
  returning * into v_campaign;
  if not p_approve then
    delete from public.email_campaign_recipients where campaign_id = p_campaign;
    update public.email_campaigns set recipient_count = 0 where id = p_campaign returning * into v_campaign;
  end if;
  perform public.um_audit(p_actor, v_campaign.created_by,
    case when p_approve then 'email_campaign.approved' else 'email_campaign.rejected' end, null,
    jsonb_build_object('hash', p_hash, 'note', left(p_note, 500)), p_ctx, jsonb_build_object('campaign_id', p_campaign));
  return public.em_campaign_json(v_campaign, true);
end
$$;

-- Pause, resume or cancel. Cancelling keeps what was already sent.
create or replace function public.em_control_campaign(p_actor uuid, p_campaign uuid, p_action text, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign public.email_campaigns;
  v_was text;
begin
  perform public.um_actor(p_actor, null);
  if not (public.em_holds(p_actor, 'email_campaigns.create') or public.em_holds(p_actor, 'email_campaigns.approve')) then
    perform public.um_fail(403, 'You do not have permission to do this.');
  end if;
  v_campaign := public.em_campaign_access(p_actor, p_campaign, true);
  v_was := v_campaign.status;
  if p_action = 'pause' and v_was in ('approved', 'sending') then
    update public.email_campaigns set status = 'paused', updated_at = now() where id = p_campaign returning * into v_campaign;
  elsif p_action = 'resume' and v_was = 'paused' then
    update public.email_campaigns set status = case when started_at is null then 'approved' else 'sending' end, updated_at = now()
    where id = p_campaign returning * into v_campaign;
  elsif p_action = 'cancel' and v_was in ('draft', 'pending_approval', 'approved', 'rejected', 'paused', 'sending') then
    update public.email_campaigns set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_campaign returning * into v_campaign;
    update public.email_campaign_recipients set status = 'skipped', skip_reason = 'cancelled'
    where campaign_id = p_campaign and status = 'pending';
  else
    perform public.um_fail(409, format('A %s campaign cannot be %s.', replace(v_was, '_', ' '),
      case p_action when 'pause' then 'paused' when 'resume' then 'resumed' when 'cancel' then 'cancelled' else 'changed that way' end));
  end if;
  perform public.um_audit(p_actor, null, 'email_campaign.' || case p_action when 'pause' then 'paused' when 'resume' then 'resumed' else 'cancelled' end,
    jsonb_build_object('status', v_was), jsonb_build_object('status', v_campaign.status), p_ctx, jsonb_build_object('campaign_id', p_campaign));
  return public.em_campaign_json(v_campaign, true);
end
$$;

-- A copy as a new draft, for changes after sending.
create or replace function public.em_duplicate_campaign(p_actor uuid, p_campaign uuid, p_ctx jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source public.email_campaigns;
begin
  perform public.um_actor(p_actor, 'email_campaigns.create');
  v_source := public.em_campaign_access(p_actor, p_campaign, false);
  return public.em_save_campaign(p_actor, null, jsonb_build_object(
    'name', left('Copy of ' || v_source.name, 120), 'from_name', v_source.from_name, 'from_email', v_source.from_email,
    'reply_to', v_source.reply_to, 'subject', v_source.subject, 'preheader', v_source.preheader, 'html', v_source.html,
    'text_body', v_source.text_body, 'template_id', v_source.template_id, 'audience', v_source.audience), p_ctx);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Dispatch (system calls from the Worker)
-- ─────────────────────────────────────────────────────────────────────────

-- Claims the next batch of one approved campaign. Each recipient's consent
-- is re-checked here; the daily budget is advanced in the same transaction.
-- Returns null when there is nothing to send (or the budget is spent).
create or replace function public.em_claim_campaign_batch(p_limit integer, p_daily_cap integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_campaign public.email_campaigns;
  v_room integer;
  v_rows jsonb;
  v_count integer;
begin
  -- A claim that never reported back may or may not have been sent.
  update public.email_campaign_recipients
  set status = 'uncertain', last_error = 'No result was recorded for this send.'
  where status = 'sending' and claimed_at < now() - interval '10 minutes';

  select * into v_campaign
  from public.email_campaigns
  where status in ('approved', 'sending') and (send_at is null or send_at <= now())
  order by coalesce(send_at, approved_at)
  limit 1
  for update skip locked;
  if v_campaign.id is null then
    return null;
  end if;
  -- Integrity: what is sent is exactly what was approved.
  if v_campaign.approved_hash is null or v_campaign.approved_hash is distinct from public.em_campaign_hash(v_campaign.id) then
    update public.email_campaigns set status = 'paused', decision_note = 'Paused automatically: content no longer matches the approval.', updated_at = now()
    where id = v_campaign.id;
    return null;
  end if;

  -- Recipients who withdrew consent or were suppressed since approval.
  update public.email_campaign_recipients r
  set status = 'skipped',
      skip_reason = case when exists (select 1 from public.email_preferences p where p.email = r.email and p.suppressed)
                         then 'suppressed' else 'no_consent' end
  where r.campaign_id = v_campaign.id and r.status = 'pending' and not public.em_marketable(r.email);

  insert into public.email_send_budget (day, sent) values ((now() at time zone 'utc')::date, 0) on conflict (day) do nothing;
  select case when coalesce(p_daily_cap, 0) <= 0 then p_limit else greatest(p_daily_cap - b.sent, 0) end into v_room
  from public.email_send_budget b where b.day = (now() at time zone 'utc')::date for update;
  v_room := least(coalesce(v_room, 0), greatest(p_limit, 0), 50);

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
    update public.email_send_budget set sent = sent + v_count where day = (now() at time zone 'utc')::date;
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
    'recipients', v_rows);
end
$$;

-- Results of a batch: [{ id, status: sent|failed|uncertain|pending, message_id, error }].
-- 'pending' returns a throttled send to the queue (and its budget unit).
create or replace function public.em_finish_campaign_batch(p_results jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_returned integer;
begin
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 50 then
    raise exception 'Expected at most 50 results' using errcode = 'PT400';
  end if;
  -- A throttled send goes back to the queue, at most five times in all.
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
  end if;
end
$$;

-- Spends n units of today's campaign budget, or none. Test sends use it.
create or replace function public.em_take_budget(p_n integer, p_cap integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(p_cap, 0) <= 0 or coalesce(p_n, 0) <= 0 then
    return false;
  end if;
  insert into public.email_send_budget (day, sent) values ((now() at time zone 'utc')::date, 0) on conflict (day) do nothing;
  update public.email_send_budget set sent = sent + p_n
  where day = (now() at time zone 'utc')::date and sent + p_n <= p_cap;
  return found;
end
$$;

-- Numbers for the Analytics screen, from recorded data only.
create or replace function public.em_email_analytics(p_actor uuid, p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  perform public.um_actor(p_actor, null);
  if not (public.em_holds(p_actor, 'email_campaigns.view') or public.em_holds(p_actor, 'email_campaigns.approve')) then
    perform public.um_fail(403, 'You do not have permission to do this.');
  end if;
  return jsonb_build_object(
    'since', v_since,
    'campaign_recipients', coalesce((select jsonb_object_agg(status, n) from (
       select r.status, count(*) n from public.email_campaign_recipients r
       join public.email_campaigns c on c.id = r.campaign_id
       where coalesce(r.sent_at, c.started_at, c.updated_at) >= v_since group by r.status) x), '{}'::jsonb),
    'events', coalesce((select jsonb_object_agg(event_type, n) from (
       select event_type, count(*) n from public.email_delivery_events where received_at >= v_since group by event_type) e), '{}'::jsonb),
    'unsubscribes', (select count(*) from public.email_preferences where marketing = 'unsubscribed'
                     and marketing_source in ('unsubscribe_link', 'complaint') and marketing_changed_at >= v_since),
    'suppressed', (select count(*) from public.email_preferences where suppressed),
    'subscribed', (select count(*) from public.email_preferences where marketing = 'subscribed' and not suppressed),
    'campaigns', coalesce((select jsonb_object_agg(status, n) from (
       select status, count(*) n from public.email_campaigns where updated_at >= v_since group by status) s), '{}'::jsonb)
  );
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Grants: the Worker (service role) only.
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
