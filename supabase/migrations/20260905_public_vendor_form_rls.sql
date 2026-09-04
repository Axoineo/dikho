-- ============================================================
-- PUBLIC VENDOR ONBOARDING: Supabase RLS Policies
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- ── Vendors table ─────────────────────────────────────────────────────
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- Allow anonymous INSERT for new vendor registrations
CREATE POLICY "Public can register as vendor"
  ON public.vendors FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous UPDATE only on pending rows (status=0) — needed to write
-- back the document file path after storage upload
CREATE POLICY "Public can update pending vendor document path"
  ON public.vendors FOR UPDATE
  TO anon
  USING (status = 0)
  WITH CHECK (status = 0);

-- ── Vendor addresses table ─────────────────────────────────────────────
ALTER TABLE public.vendor_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can add vendor address"
  ON public.vendor_addresses FOR INSERT
  TO anon
  WITH CHECK (true);

-- ── Media & Sub Media (needed for dropdown options on the public form) ──
-- These tables need RLS enabled AND a SELECT policy so anon users can read them.
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_media ENABLE ROW LEVEL SECURITY;

-- DROP existing policies first in case they already exist from a previous run
DROP POLICY IF EXISTS "Public can read media" ON public.media;
DROP POLICY IF EXISTS "Public can read sub_media" ON public.sub_media;

CREATE POLICY "Public can read media"
  ON public.media FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can read sub_media"
  ON public.sub_media FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── Storage bucket (for vendor document uploads) ────────────────────────
-- Run this only if it hasn't been created yet. If it errors, ignore and continue.
INSERT INTO storage.buckets (id, name, public) VALUES ('Dikho', 'Dikho', false)
  ON CONFLICT (id) DO NOTHING;
