-- ============================================================================
-- FIX: public_submit_cg_lead failed with
--   "column \"mobile\" is of type numeric but expression is of type text"
--
-- Schema drift: every migration declares cg_leads.mobile as `text`, but the
-- production column is actually `numeric` (confirmed via information_schema).
-- The old direct-insert path worked only because PostgREST silently coerced the
-- JSON string to numeric; the RPC extracts `p_lead->>'mobile'` as text, and
-- Postgres will not auto-cast text -> numeric on assignment.
--
-- Fix: cast mobile to ::numeric to match the real column type. The corporate-
-- gifting form only ever sends a digits-only string (form strips non-digits),
-- so the cast is safe. Only `mobile` drifted — vendors/vendor_addresses column
-- types all match their RPC inserts (verified), so no other RPC changes needed.
--
-- Idempotent (CREATE OR REPLACE). APPLY: `npx supabase db push`, or paste into
-- the Supabase SQL editor.
-- ============================================================================
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
    nullif(p_lead->>'mobile', '')::numeric,   -- cg_leads.mobile is numeric in prod
    nullif(p_lead->>'email', ''),
    nullif(p_lead->>'city', '')
  );
end;
$$;

-- CREATE OR REPLACE preserves existing privileges, but re-assert for a fresh run.
revoke all on function public.public_submit_cg_lead(jsonb) from public;
grant execute on function public.public_submit_cg_lead(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
