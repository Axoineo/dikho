-- The internal dashboard's new "Leads" page needs to read cg_leads, and
-- currently cannot: RLS has been enabled since the table's creation
-- (20260924000000_cg_leads.sql) but the only policy ever added was an anon
-- INSERT ("Anyone can insert cg leads."), dropped for anon entirely by the
-- Turnstile lockdown (20260927000000_turnstile_lockdown.sql) and never
-- replaced with anything for `authenticated`. With RLS on and zero matching
-- policies, `authenticated` gets EMPTY RESULTS, not an error — easy to miss
-- in testing.
--
-- Read-only and unconditional: leads are internal, team-wide data, same
-- visibility as clients/vendors (see "Authenticated users can view clients" /
-- "authenticated users can read vendors" in 20260918213533_remote_schema.sql),
-- not scoped per staff member. Only SELECT is granted here — nothing can
-- write through this policy, so the WhatsApp send outcome (tracked separately
-- in D1's `messages` table, not on this row) can only ever be changed by the
-- dikho-api Worker's own service-role key, never by a dashboard user.
grant select on table public.cg_leads to authenticated;

create policy "Authenticated users can view cg leads"
  on public.cg_leads
  for select
  to authenticated
  using (true);
