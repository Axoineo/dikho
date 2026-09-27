-- ============================================================================
-- PHASE 3 — RESTRICTIVE / LOCKDOWN. Makes the Cloudflare Turnstile check
-- load-bearing instead of advisory.
--
-- BACKGROUND: Phases 1 and 2 (20260925000000 / 20260925000001) moved the public
-- forms' writes behind SECURITY DEFINER RPCs and took away anon's direct table
-- access. But anon still had EXECUTE on the RPCs themselves, and the browser
-- called them directly — so the Turnstile widget on those forms protected
-- nothing: a bot could skip the page and POST straight to
-- /rest/v1/rpc/public_register_vendor with the public anon key.
--
-- THIS MIGRATION removes anon's (and authenticated's) EXECUTE and grants it to
-- service_role only. The dikho-api Worker holds the service-role key, and it
-- verifies a Turnstile token against siteverify before it calls either function
-- (src/api/services/turnstile.js). After this, the Worker is the only path in.
--
-- ORDER (zero-downtime) — same coupling as the Phase 1/2 split:
--   1. Set the Worker secrets:
--        npx wrangler secret put TURNSTILE_SECRET        --name dikho-api
--        npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name dikho-api
--      and set TURNSTILE_HOSTNAMES + SUPABASE_URL for the Worker.
--   2. Deploy the API Worker  (npm run deploy:api) — adds /api/public/*.
--   3. Deploy the SPA         (npm run deploy)     — forms now POST to the Worker.
--   4. Verify BOTH public forms actually submit end to end.
--   5. Apply THIS migration.
--
-- If you apply this BEFORE steps 2-3 are live, the currently-deployed frontend's
-- direct anon RPC calls start failing with "permission denied for function" and
-- both public forms break. There is no partial state: it is anon or the Worker.
--
-- ROLLBACK (re-opens the bypass, so only as an emergency):
--   grant execute on function public.public_register_vendor(jsonb, jsonb) to anon;
--   grant execute on function public.public_submit_cg_lead(jsonb)        to anon;
--
-- Idempotent (idempotent REVOKE/GRANT), so re-running is harmless.
-- APPLY: `npx supabase db push`, or paste into the Supabase SQL editor.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Take EXECUTE away from the browser-facing roles.
--
--    `authenticated` is revoked too: the dashboard has never called these two
--    functions (it writes vendors/clients through its own authenticated paths),
--    so leaving the grant would only preserve a second unverified entry point
--    for anyone holding any logged-in session.
-- ─────────────────────────────────────────────────────────────────────────
revoke execute on function public.public_register_vendor(jsonb, jsonb) from anon, authenticated;
revoke execute on function public.public_submit_cg_lead(jsonb)         from anon, authenticated;

-- Belt and braces: strip the implicit PUBLIC grant that CREATE FUNCTION hands
-- out, in case a later `create or replace` re-established it.
revoke all on function public.public_register_vendor(jsonb, jsonb) from public;
revoke all on function public.public_submit_cg_lead(jsonb)         from public;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Grant EXECUTE to service_role — the dikho-api Worker's role.
--
--    This is belt-and-braces rather than strictly required: this project's
--    default privileges already grant ALL on functions in `public` to
--    service_role when they are created by `postgres` (see remote_schema.sql,
--    "ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO service_role"), and
--    Phase 1's `revoke all ... from public` only dropped the PUBLIC pseudo-role's
--    grant, not service_role's. Stating it explicitly means the Worker keeps
--    working even if those default privileges are ever changed, and makes the
--    one role that is supposed to call these functions obvious to the next
--    reader. Granting twice is a no-op.
-- ─────────────────────────────────────────────────────────────────────────
grant execute on function public.public_register_vendor(jsonb, jsonb) to service_role;
grant execute on function public.public_submit_cg_lead(jsonb)         to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Storage is deliberately untouched.
--
--    The vendor form still uploads its document straight to Supabase storage
--    from the browser, under the folder-scoped anon INSERT policy that Phase 2
--    kept ("Anon can upload vendor documents"). That upload is therefore still
--    NOT behind Turnstile — a bot can spam objects into vendors_documents/
--    without ever touching the RPCs. Closing that means proxying the upload
--    through the Worker (or moving it to R2); tracked separately.
-- ─────────────────────────────────────────────────────────────────────────

notify pgrst, 'reload schema';
