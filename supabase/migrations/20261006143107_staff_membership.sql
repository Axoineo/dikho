-- ============================================================================
-- STAFF MEMBERSHIP GATE: a Supabase session is no longer enough to read or
-- write business data. The account must also hold a staff role.
--
-- WHY: every business table granted `authenticated` full access with
-- USING (true), and Supabase sign-up was open (checked 2026-10-05:
-- /auth/v1/settings reported disable_signup=false with email and phone on).
-- So anyone with the public key could create an account, confirm it, and read
-- or change vendors (bank details), clients, invoices and payments, and join
-- the WhatsApp inbox channel. The SPA's `shouldCreateUser: false` is a client
-- setting and protects nothing. Turn sign-up off in the dashboard as well;
-- this migration is the database half of the fix, not a substitute for it.
--
-- WHAT A STAFF MEMBER IS: an auth user whose app_metadata has
--   "dikho_roles": [ one or more of admin, finance, sales, operations, support ]
-- app_metadata is writable only with the service role, never by the user.
-- The same list is enforced by the API Worker (src/lib/staffRoles.js).
-- Membership is all-or-nothing for now: per-role permissions are a separate,
-- undecided step (docs/PERMISSIONS.md).
--
-- WHAT THIS DOES:
--   1. public.is_staff(), read fresh from auth.users on every check, so
--      removing a role or banning a user takes effect immediately in the
--      database (not at the next token refresh).
--   2. A RESTRICTIVE "staff members only" policy for `authenticated` on every
--      table in `public`. Restrictive policies are ANDed with the existing
--      permissive ones, so current access is unchanged for staff and removed
--      for everyone else, without rewriting each table's policies. `anon` is
--      untouched (it keeps only the media/sub_media reads the public form uses).
--   3. issue_invoice() refuses non-staff (SECURITY DEFINER skips RLS) and is
--      no longer executable by `anon`.
--   4. A policy letting staff, and only staff, receive the private `wa-inbox`
--      Realtime broadcasts.
--
-- ORDER (each step before the next; full sequence in
-- docs/tasks/2026-10-05-security-hardening.md):
--   1. Turn off "Allow new users to sign up" in Supabase Auth settings.
--   2. Give every real operator a role (docs/runbooks/staff-access.md).
--   3. Apply THIS migration. It needs nothing else deployed: the current
--      dashboard keeps working for staff, and the inbox policy is in place
--      before the new SPA starts joining the private channel.
--   4. Then deploy the API Worker, push the SPA, and only after that apply
--      20261005000001_vendor_document_storage.sql.
-- Applying this before step 2 locks every operator out of all data. The guard
-- below refuses to run in that state.
--
-- NEW TABLES: the loop below covers the tables that exist today. Any table
-- added later must get the same restrictive policy in its own migration.
--
-- ROLLBACK (re-opens the gap; emergencies only): drop the policies named
-- "staff members only" on public.* and "staff receive inbox broadcasts" on
-- realtime.messages. Keep is_staff(); issue_invoice references it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 0. Guard: refuse to lock out an existing team. A database with no users at
--    all (fresh install, local reset) has nobody to lock out, so it passes.
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from auth.users)
     and not exists (
       select 1 from auth.users
       where jsonb_typeof(raw_app_meta_data -> 'dikho_roles') = 'array'
         and raw_app_meta_data -> 'dikho_roles' ?| array['admin', 'finance', 'sales', 'operations', 'support']
     )
  then
    raise exception 'No user has a dikho_roles staff role yet. Assign roles first (docs/runbooks/staff-access.md); applying this now would lock every operator out.';
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Membership check.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_typeof(u.raw_app_meta_data -> 'dikho_roles') = 'array'
       and u.raw_app_meta_data -> 'dikho_roles' ?| array['admin', 'finance', 'sales', 'operations', 'support']
    from auth.users u
    where u.id = auth.uid()
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
  ), false)
$$;

comment on function public.is_staff() is
  'True when the calling user holds a Dikho staff role in app_metadata.dikho_roles. Keep the role list in sync with src/lib/staffRoles.js.';

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Restrictive staff policy on every table in `public`.
--    `(select ...)` makes Postgres evaluate the check once per statement
--    instead of once per row.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('drop policy if exists "staff members only" on public.%I', t.relname);
    execute format(
      'create policy "staff members only" on public.%I as restrictive for all to authenticated '
      'using ((select public.is_staff())) with check ((select public.is_staff()))',
      t.relname
    );
  end loop;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. issue_invoice: identical to the live definition (verified by md5 against
--    production on 2026-10-05) except for the staff check after the
--    auth.uid() check.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice_id uuid)
 RETURNS public.invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  invoice_row public.invoices;
  profile_row public.organization_profiles;
  line_count integer;
  calculated_subtotal numeric(14,2);
  calculated_tax_total numeric(14,2);
  calculated_grand_total numeric(14,2);
  next_number integer;
  period_start date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to issue an invoice.';
  END IF;
  -- Added 2026-10-05: SECURITY DEFINER bypasses RLS, so the staff gate the
  -- tables now carry does not reach in here. A session alone is not enough.
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only staff can issue invoices.';
  END IF;

  SELECT * INTO invoice_row FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;
  IF invoice_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be issued.';
  END IF;

  SELECT * INTO profile_row FROM public.organization_profiles WHERE id = invoice_row.organization_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invoice organization profile no longer exists.';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(taxable_amount), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(total_amount), 0)
  INTO line_count, calculated_subtotal, calculated_tax_total, calculated_grand_total
  FROM public.invoice_lines
  WHERE invoice_id = invoice_row.id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'Add at least one invoice line before issuing.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_lines
    WHERE invoice_id = invoice_row.id
      AND (btrim(description) = '' OR hsn_sac IS NULL OR btrim(hsn_sac) = '')
  ) THEN
    RAISE EXCEPTION 'Every invoice line needs a description and HSN/SAC code before issuing.';
  END IF;
  IF calculated_grand_total <> calculated_subtotal + calculated_tax_total THEN
    RAISE EXCEPTION 'Invoice totals do not reconcile.';
  END IF;

  period_start := date_trunc('month', invoice_row.invoice_date)::date;
  INSERT INTO public.invoice_sequences (organization_profile_id, invoice_month, last_number)
  VALUES (invoice_row.organization_profile_id, period_start, 1)
  ON CONFLICT (organization_profile_id, invoice_month)
  DO UPDATE SET last_number = public.invoice_sequences.last_number + 1
  RETURNING last_number INTO next_number;

  UPDATE public.invoices
  SET status = 'issued',
      invoice_number = profile_row.invoice_prefix || '/' || upper(to_char(invoice_row.invoice_date, 'MON')) || next_number || '/' || to_char(invoice_row.invoice_date, 'YY'),
      subtotal = calculated_subtotal,
      tax_total = calculated_tax_total,
      grand_total = calculated_grand_total,
      due_date = COALESCE(invoice_row.due_date, invoice_row.invoice_date + profile_row.invoice_terms_days),
      seller_snapshot = jsonb_build_object(
        'legal_name', profile_row.legal_name,
        'gstin', profile_row.gstin,
        'pan', profile_row.pan,
        'address_line1', profile_row.address_line1,
        'address_line2', profile_row.address_line2,
        'city', profile_row.city,
        'state', profile_row.state,
        'state_code', profile_row.state_code,
        'country', profile_row.country,
        'pincode', profile_row.pincode,
        'bank_name', profile_row.bank_name,
        'bank_account_name', profile_row.bank_account_name,
        'bank_account_number', profile_row.bank_account_number,
        'bank_ifsc', profile_row.bank_ifsc,
        'bank_branch', profile_row.bank_branch
      ),
      issued_at = now(),
      issued_by = auth.uid()
  WHERE id = invoice_row.id
  RETURNING * INTO invoice_row;

  INSERT INTO public.document_events (entity_type, entity_id, event_type, payload)
  VALUES ('invoice', invoice_row.id, 'issued', jsonb_build_object('invoice_number', invoice_row.invoice_number, 'grand_total', invoice_row.grand_total));

  RETURN invoice_row;
END;
$function$;

revoke all on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Private Realtime channel for the WhatsApp inbox. The Worker publishes
--    with the service role (bypasses this); staff may only receive.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "staff receive inbox broadcasts" on realtime.messages;
create policy "staff receive inbox broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    (select public.is_staff())
    and (select realtime.topic()) = 'wa-inbox'
    and realtime.messages.extension in ('broadcast')
  );

notify pgrst, 'reload schema';
