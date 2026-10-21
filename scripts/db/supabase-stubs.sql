-- ============================================================================
-- Minimal stand-ins for the Supabase platform objects that the migrations in
-- supabase/migrations/ reference, so they can be applied to a throwaway local
-- PostgreSQL by scripts/db/verify-local.sh. LOCAL TESTING ONLY: never apply
-- this to a Supabase project, which already has the real objects.
--
-- What is modelled is only what the migrations and the SQL tests touch:
--   - the anon / authenticated / service_role roles and the role switch
--     PostgREST performs (SET ROLE + request.jwt.claims);
--   - auth.users, auth.sessions, auth.uid(), auth.jwt(), auth.role();
--   - storage.buckets, storage.objects, storage.foldername();
--   - realtime.messages, realtime.topic().
-- Column lists are the subsets the migrations use, not Supabase's full tables.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
end
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
-- Supabase exposes gen_random_uuid() from pg_catalog (PG13+), as here.

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ── auth ────────────────────────────────────────────────────────────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  encrypted_password text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  deleted_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  not_after timestamptz,
  user_agent text,
  ip inet
);

create or replace function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

create or replace function auth.role() returns text
language sql stable
as $$ select coalesce(auth.jwt() ->> 'role', current_user) $$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- ── storage ─────────────────────────────────────────────────────────────────
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1:array_length(parts, 1) - 1];
end
$$;

-- ── realtime ────────────────────────────────────────────────────────────────
create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table if not exists realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null default '',
  extension text not null default 'broadcast',
  payload jsonb,
  event text,
  private boolean default true,
  inserted_at timestamptz default now()
);
alter table realtime.messages enable row level security;

create or replace function realtime.topic() returns text
language sql stable
as $$ select coalesce(current_setting('realtime.topic', true), '') $$;
grant execute on function realtime.topic() to anon, authenticated, service_role;

-- ── test helpers (not Supabase objects) ─────────────────────────────────────
-- Act as a signed-in browser session the way PostgREST does: switch to the
-- `authenticated` role and publish the token's claims. `reset role` ends it.
create schema if not exists test;
grant usage on schema test to public;

create or replace function test.act_as(p_user uuid, p_session uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, false);
  execute 'set role authenticated';
end
$$;

create or replace function test.act_as_anon() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, false);
  execute 'set role anon';
end
$$;
-- Runs a statement that must fail with the given SQLSTATE (e.g. 'PT403' from
-- um_fail, '42501' for a missing privilege). Anything else fails the test.
create or replace function test.expect_error(p_sql text, p_code text, p_label text) returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_code then
      raise exception '% : expected SQLSTATE %, got % (%)', p_label, p_code, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception '% : expected SQLSTATE %, but it succeeded', p_label, p_code;
end
$$;

create or replace function test.check(p_ok boolean, p_label text) returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'check failed: %', p_label;
  end if;
end
$$;
grant execute on all functions in schema test to public;
