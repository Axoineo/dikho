-- ============================================================================
-- Harden public (anonymous) writes: route them through SECURITY DEFINER RPCs
-- and remove ALL direct anon table access on vendors / vendor_addresses /
-- clients / cg_leads.
--
-- WHY:
--   The dashboard talks to Supabase directly with the public anon key, so the
--   only thing standing between the internet and these tables is RLS. The old
--   policies were broader than their names implied:
--     * "read own pending vendor/client" was USING (status = 0) with no owner
--       predicate  ->  any anon could read EVERY pending row (PII, bank name).
--     * anon UPDATE/DELETE on pending vendors, and an unconditional anon DELETE
--       on vendor_addresses (USING (true))  ->  any anon could tamper with or
--       wipe other people's rows.
--     * INSERT policies were WITH CHECK (true)  ->  anon could set ANY column,
--       including `status` (self-approve) and `opening_balance`.
--
--   This migration replaces those direct-table grants with two SECURITY DEFINER
--   functions. anon keeps EXECUTE on the functions only; it has no SELECT,
--   INSERT, UPDATE or DELETE on the underlying tables. The functions hard-code
--   the security-sensitive columns (status, opening_balance) so they can never
--   be set by the client.
--
-- APPLY (from the repo root):
--   npx supabase db push
--   -- or paste this file into the Supabase SQL editor.
--
-- NOTE: In Supabase, migrations run as the `postgres` role, so these functions
-- are owned by postgres and their inserts bypass RLS by design. If you apply
-- them as a different role, that role must own the functions and be able to
-- insert into the tables below.
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

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Remove EVERY anon policy on these tables. RLS stays enabled, so with no
--    anon policy the default is deny — anon can reach these tables only via the
--    SECURITY DEFINER functions above.
-- ─────────────────────────────────────────────────────────────────────────
-- vendors
drop policy if exists "Public can register as vendor"                on public.vendors;
drop policy if exists "Public can read own pending vendor"           on public.vendors;
drop policy if exists "Public can update pending vendor document path" on public.vendors;
drop policy if exists "Public can delete pending vendor"             on public.vendors;

-- vendor_addresses
drop policy if exists "Public can add vendor address"    on public.vendor_addresses;
drop policy if exists "Public can delete vendor address" on public.vendor_addresses;

-- clients — the live public welcome form writes cg_leads, never clients, so the
-- clients table should have NO anonymous access at all.
drop policy if exists "Public can submit client welcome"   on public.clients;
drop policy if exists "Public can read own pending client" on public.clients;

-- cg_leads
drop policy if exists "Anyone can insert cg leads." on public.cg_leads;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Defense in depth: strip the underlying table privileges from anon so that
--    even a future accidental "enable a permissive policy" or "disable RLS"
--    cannot re-open direct access. The RPCs run as their owner and do not rely
--    on these grants. (authenticated is intentionally left untouched.)
-- ─────────────────────────────────────────────────────────────────────────
revoke all on table public.vendors           from anon;
revoke all on table public.vendor_addresses  from anon;
revoke all on table public.clients           from anon;
revoke all on table public.cg_leads          from anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Storage: the public form still needs to upload the document, so keep the
--    folder-scoped anon INSERT ("Anon can upload vendor documents"). Drop the
--    anon DELETE — it let any anon delete ANY object under vendors_documents/,
--    and the new single-RPC flow no longer needs client-side rollback.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "Anon can delete vendor documents" on storage.objects;

-- media / sub_media keep their anon SELECT: they are non-sensitive reference
-- lists that populate the public form's dropdowns (no PII).

-- Tell PostgREST to reload the schema so the new functions are callable at once.
notify pgrst, 'reload schema';
