-- Migration: Client address fields for Corporate Gifting welcome form
-- Created: 2026-09-08
--
-- Adds address-related columns directly to the existing `clients` table.
-- All new columns are nullable so existing client records remain valid.
-- Also adds RLS policies to allow anonymous INSERT from the public /welcome form.
--
-- This migration is idempotent: columns use IF NOT EXISTS, and each
-- policy is dropped-then-created, so it is safe to re-run.

-- ── New columns ──────────────────────────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS designation       text,
  ADD COLUMN IF NOT EXISTS country_dialcode  text,
  ADD COLUMN IF NOT EXISTS address_line1     text,
  ADD COLUMN IF NOT EXISTS address_line2     text,
  ADD COLUMN IF NOT EXISTS city              text,
  ADD COLUMN IF NOT EXISTS state             text,
  ADD COLUMN IF NOT EXISTS pincode           text,
  ADD COLUMN IF NOT EXISTS country           text DEFAULT 'India';

-- ── Row Level Security for the public welcome form ───────────────────────────
-- The clients table should already have RLS enabled. Enable it idempotently.
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- DROP existing policies first so this migration is idempotent
DROP POLICY IF EXISTS "Public can submit client welcome"    ON public.clients;
DROP POLICY IF EXISTS "Public can read own pending client"  ON public.clients;

-- Allow anonymous INSERT for new client submissions from the /welcome form
CREATE POLICY "Public can submit client welcome"
  ON public.clients FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous SELECT on pending rows (status=0) — needed because the
-- insert uses `.select('id').single()` which triggers a RETURNING query
-- that checks SELECT policies.
CREATE POLICY "Public can read own pending client"
  ON public.clients FOR SELECT
  TO anon
  USING (status = 0);

-- ── Tell PostgREST about the schema changes immediately ──────────────────────
NOTIFY pgrst, 'reload schema';
