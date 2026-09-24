-- ============================================================================
-- PHASE 2 of 2 — RESTRICTIVE / LOCKDOWN. Apply this ONLY after the frontend
-- that calls public_register_vendor / public_submit_cg_lead (Phase 1) is live
-- and verified. It removes every remaining direct anon path to these tables.
--
-- ORDER (zero-downtime):
--   1. Apply Phase 1 (20260925000000_public_write_rpcs.sql) — creates the RPCs.
--   2. Deploy the new frontend (merge to main -> Cloudflare Pages builds).
--   3. Verify the public vendor + corporate-gifting forms submit.
--   4. Apply THIS migration.
--
-- If you apply this BEFORE the new frontend is live, the currently-deployed
-- (old) frontend's direct anon inserts will start failing.
--
-- Idempotent (DROP POLICY IF EXISTS + idempotent REVOKE), so re-running is safe.
-- APPLY: `npx supabase db push` (Phase 1 is already applied, so only this runs),
-- or paste into the Supabase SQL editor.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Remove EVERY anon policy on these tables. RLS stays enabled, so with no anon
-- policy the default is deny — anon can reach these tables only via the
-- SECURITY DEFINER functions created in Phase 1.
-- ─────────────────────────────────────────────────────────────────────────
-- vendors
drop policy if exists "Public can register as vendor"                 on public.vendors;
drop policy if exists "Public can read own pending vendor"            on public.vendors;
drop policy if exists "Public can update pending vendor document path" on public.vendors;
drop policy if exists "Public can delete pending vendor"              on public.vendors;

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
-- Defense in depth: strip the underlying table privileges from anon so that
-- even a future accidental "enable a permissive policy" or "disable RLS" cannot
-- re-open direct access. The RPCs run as their owner and do not rely on these
-- grants. (authenticated is intentionally left untouched.)
-- ─────────────────────────────────────────────────────────────────────────
revoke all on table public.vendors           from anon;
revoke all on table public.vendor_addresses  from anon;
revoke all on table public.clients           from anon;
revoke all on table public.cg_leads          from anon;

-- ─────────────────────────────────────────────────────────────────────────
-- Storage: the public form still needs to upload the document, so keep the
-- folder-scoped anon INSERT ("Anon can upload vendor documents"). Drop the anon
-- DELETE — it let any anon delete ANY object under vendors_documents/, and the
-- single-RPC flow no longer needs client-side rollback.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "Anon can delete vendor documents" on storage.objects;

-- media / sub_media keep their anon SELECT: they are non-sensitive reference
-- lists that populate the public form's dropdowns (no PII).

notify pgrst, 'reload schema';
