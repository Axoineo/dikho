-- ============================================================================
-- PHASE 1 of 2 — ADDITIVE. Safe to apply at any time; changes nothing for the
-- currently-deployed frontend.
--
-- Creates the SECURITY DEFINER RPCs that public (anonymous) forms use to write,
-- and grants anon EXECUTE on them. It does NOT yet remove any direct anon table
-- access — that is Phase 2 (20260925000001_public_write_lockdown.sql), which
-- you apply only AFTER the frontend that calls these RPCs is live.
--
-- WHY the split: this migration + the new frontend are compatible with the OLD
-- database (old anon policies still present). The Phase-2 lockdown is compatible
-- with the NEW frontend (which no longer touches these tables directly). Applying
-- them at different times gives a zero-downtime rollout. See the deploy runbook.
--
-- This migration is idempotent (CREATE OR REPLACE + idempotent GRANT/REVOKE),
-- so re-running it is harmless.
--
-- APPLY: paste this file into the Supabase SQL editor and run (do NOT run
-- `supabase db push` yet — that would also apply Phase 2). In Supabase, run as
-- the `postgres` role so the functions are owned by postgres and their inserts
-- bypass RLS by design.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Vendor registration RPC (replaces the public vendor form's direct
--    insert + select + update + delete flow).
--
--    The frontend uploads the document to storage FIRST (under a random id it
--    generates), then calls this once. Inserting the vendor and its default
--    address happens in a single transaction: if the address insert fails, the
--    vendor insert rolls back automatically — no client-side DELETE needed.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.public_register_vendor(p_vendor jsonb, p_address jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  -- Basic anti-abuse guards on an unauthenticated entry point.
  if coalesce(length(p_vendor->>'company_name'), 0) = 0 then
    raise exception 'company_name is required';
  end if;
  if length(coalesce(p_vendor->>'company_name', '')) > 300
     or length(coalesce(p_address->>'address', '')) > 1000 then
    raise exception 'input too long';
  end if;

  insert into public.vendors (
    alias, contact_person, company_name, gstin, gstin_date,
    payment_term_type, payment_term_value, vendor_type,
    country_dialcode, country_code, contact, email,
    media_id, sub_media_id, registration, pan_number,
    tds_percentage, tds_section,
    vendor_bank_name, vendor_ifsc_code,
    vendor_account_number, vendor_confirm_account_number,
    vendor_document_file_name, vendor_document_file_path,
    opening_balance, status, created_at
  ) values (
    nullif(p_vendor->>'alias', ''),
    nullif(p_vendor->>'contact_person', ''),
    p_vendor->>'company_name',
    nullif(p_vendor->>'gstin', ''),
    nullif(p_vendor->>'gstin_date', ''),
    nullif(p_vendor->>'payment_term_type', ''),
    nullif(p_vendor->>'payment_term_value', '')::bigint,
    nullif(p_vendor->>'vendor_type', ''),
    nullif(regexp_replace(coalesce(p_vendor->>'country_dialcode', ''), '\D', '', 'g'), '')::bigint,
    nullif(p_vendor->>'country_code', ''),
    nullif(p_vendor->>'contact', ''),
    nullif(p_vendor->>'email', ''),
    nullif(p_vendor->>'media_id', '')::bigint,
    nullif(p_vendor->>'sub_media_id', '')::bigint,
    nullif(p_vendor->>'registration', ''),
    nullif(p_vendor->>'pan_number', ''),
    nullif(p_vendor->>'tds_percentage', ''),
    nullif(p_vendor->>'tds_section', ''),
    nullif(p_vendor->>'vendor_bank_name', ''),
    nullif(p_vendor->>'vendor_ifsc_code', ''),
    nullif(p_vendor->>'vendor_account_number', ''),
    nullif(p_vendor->>'vendor_confirm_account_number', ''),
    nullif(p_vendor->>'vendor_document_file_name', ''),
    nullif(p_vendor->>'vendor_document_file_path', ''),
    0,     -- opening_balance: never client-controlled
    0,     -- status: always "pending", never self-approved
    now()
  )
  returning id into v_id;

  insert into public.vendor_addresses (
    vendor_id, address, country, country_code, state, city, zipcode, is_default
  ) values (
    v_id,
    p_address->>'address',
    coalesce(nullif(p_address->>'country', ''), 'India'),
    coalesce(nullif(p_address->>'country_code', ''), 'IN'),
    p_address->>'state',
    nullif(p_address->>'city', ''),
    nullif(p_address->>'zipcode', ''),
    true
  );

  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Corporate-gifting lead RPC (replaces the public welcome form's direct
--    insert into cg_leads). Whitelists columns so anon can't inject others.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.public_submit_cg_lead(p_lead jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(length(p_lead->>'name'), 0) = 0
     or coalesce(length(p_lead->>'company_name'), 0) = 0 then
    raise exception 'name and company_name are required';
  end if;
  if length(coalesce(p_lead->>'company_name', '')) > 300
     or length(coalesce(p_lead->>'name', '')) > 200
     or length(coalesce(p_lead->>'email', '')) > 320 then
    raise exception 'input too long';
  end if;

  insert into public.cg_leads (company_name, name, country_code, mobile, email, city)
  values (
    p_lead->>'company_name',
    p_lead->>'name',
    nullif(p_lead->>'country_code', ''),
    nullif(p_lead->>'mobile', ''),
    nullif(p_lead->>'email', ''),
    nullif(p_lead->>'city', '')
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Grants: anon may EXECUTE the two functions and nothing else. Revoke the
--    implicit PUBLIC execute grant first so only the roles we name can call.
-- ─────────────────────────────────────────────────────────────────────────
revoke all on function public.public_register_vendor(jsonb, jsonb) from public;
revoke all on function public.public_submit_cg_lead(jsonb)        from public;
grant execute on function public.public_register_vendor(jsonb, jsonb) to anon, authenticated;
grant execute on function public.public_submit_cg_lead(jsonb)        to anon, authenticated;

-- Tell PostgREST to reload the schema so the new functions are callable at once.
notify pgrst, 'reload schema';
