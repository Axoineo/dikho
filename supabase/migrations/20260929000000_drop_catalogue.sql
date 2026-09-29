-- ============================================================================
-- Retires the S3-backed catalogue feature. NOT APPLIED AUTOMATICALLY — see the
-- EXPORT FIRST note below before running this against production.
--
-- BACKGROUND: 20260910_corporate_gifting.sql created catalogues /
-- catalogue_files / catalogue_leads for a viewer that listed PDFs out of an S3
-- bucket (catalogue_files.s3_key) and captured leads against a catalogue.
-- That feature is gone:
--
--   * Its only frontend, CorporateGiftingCatalogue.jsx, has been deleted — and
--     it was never registered in App.jsx, so manage.dikho.in/catalogue has
--     been falling through the SPA catch-all to the login screen regardless.
--   * The live /corporategifting page (PublicClientWelcome) links straight to
--     a Dropbox folder (DRIVE_CATALOGUE_URL) and never touches these tables.
--   * No API route, worker or RPC references them.
--   * No AWS credentials or bucket name remain anywhere in the repo, so
--     nothing here can reach the S3 objects s3_key points at.
--
-- catalogue_leads was superseded by cg_leads on 2026-09-24
-- (20260924000000_cg_leads.sql, whose own comment notes it "matches
-- catalogue_leads"). cg_leads is LIVE — the public welcome form writes it
-- through public_submit_cg_lead — and is deliberately untouched here.
--
-- SECURITY: this is also a cleanup. The two lockdown migrations
-- (20260925000001, 20260927000000) enumerated tables by name and never covered
-- catalogue_*, so anon still holds GRANT ALL on all three plus an "Anyone can
-- insert leads." INSERT policy on catalogue_leads — a publicly writable table
-- behind a feature nobody can reach. Dropping them closes that surface.
--
-- DATA LOSS, ACCEPTED: catalogue_leads holds real customer contacts (name,
-- company_name, email, mobile, city) captured between 2026-09-10 and the
-- 2026-09-24 cutover to cg_leads. Discarding them rather than exporting or
-- folding them into cg_leads was a deliberate call on 2026-09-29 — those early
-- leads were judged not worth keeping. There is no backup; this is one-way.
--
-- The S3 objects themselves are NOT touched by this migration and must be
-- removed (or left) in AWS separately.
-- ============================================================================

-- Policies go first so the drops do not trip over them on older Postgres.
drop policy if exists "Catalogues are viewable by everyone."      on public.catalogues;
drop policy if exists "Catalogue files are viewable by everyone." on public.catalogue_files;
drop policy if exists "Anyone can insert leads."                  on public.catalogue_leads;

-- catalogue_files and catalogue_leads both FK to catalogues with ON DELETE
-- CASCADE; cascade here covers the constraints themselves.
drop table if exists public.catalogue_files cascade;
drop table if exists public.catalogue_leads cascade;
drop table if exists public.catalogues      cascade;
