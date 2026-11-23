-- Pre-launch audit 4.5-A (2026-11-22), defence in depth. Changes no behaviour today:
-- every table below already has RLS that lets `anon` read or write nothing, and the
-- functions already work. This removes the grants and the loose setting that only
-- matter if a policy is ever loosened by mistake. Tightening only: nothing is granted.

-- 1. Trigger functions with no fixed search_path (Supabase advisor 0011). A fixed
--    path with pg_temp last keeps their unqualified table names resolving exactly as
--    now, while nothing a session creates can shadow them.
alter function public.finance_touch_updated_at() set search_path = public, pg_temp;
alter function public.prevent_issued_invoice_mutation() set search_path = public, pg_temp;
alter function public.prevent_issued_invoice_line_mutation() set search_path = public, pg_temp;
alter function public.prevent_void_payment_with_allocations() set search_path = public, pg_temp;
alter function public.validate_payment_allocation() set search_path = public, pg_temp;

-- 2. The event-trigger helper that turns RLS on for new tables runs as a trigger,
--    never as an RPC, so nobody needs EXECUTE on it (advisor 0028/0029).
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 3. Supabase's default table grants to `anon` on tables no signed-out page uses.
--    The public forms write through the Worker (service role); the vendor form reads
--    only `media` and `sub_media`, which keep their grant and policy.
revoke all on table
  public.document_events,
  public.invoice_lines,
  public.invoice_sequences,
  public.invoices,
  public.login_events,
  public.organization_profiles,
  public.payment_allocations,
  public.payments,
  public.purchaseorders,
  public.salesorder,
  public.salesorderdocument,
  public.salesorders,
  public.user_devices,
  public.vendor_media,
  public.invoice_balances,
  public.purchaseorderdocuments
from anon;
