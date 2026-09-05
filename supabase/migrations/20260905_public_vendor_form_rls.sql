-- ============================================================
-- PUBLIC VENDOR ONBOARDING: Supabase RLS Policies
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- ── Vendors table ─────────────────────────────────────────────────────
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- DROP existing policies first so this migration is idempotent
DROP POLICY IF EXISTS "Public can register as vendor"              ON public.vendors;
DROP POLICY IF EXISTS "Public can update pending vendor document path" ON public.vendors;
DROP POLICY IF EXISTS "Public can read own pending vendor"         ON public.vendors;
DROP POLICY IF EXISTS "Public can delete pending vendor"           ON public.vendors;

-- Allow anonymous INSERT for new vendor registrations
CREATE POLICY "Public can register as vendor"
  ON public.vendors FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous SELECT on the row just inserted (needed because the
-- insert uses `.select('id').single()` which triggers a RETURNING query
-- that checks SELECT policies).  Scoped to pending rows only.
CREATE POLICY "Public can read own pending vendor"
  ON public.vendors FOR SELECT
  TO anon
  USING (status = 0);

-- Allow anonymous UPDATE only on pending rows (status=0) — needed to write
-- back the document file path after storage upload
CREATE POLICY "Public can update pending vendor document path"
  ON public.vendors FOR UPDATE
  TO anon
  USING (status = 0)
  WITH CHECK (status = 0);

-- Allow anonymous DELETE on pending rows — the form's error handling
-- rolls back a partially created vendor on failure
CREATE POLICY "Public can delete pending vendor"
  ON public.vendors FOR DELETE
  TO anon
  USING (status = 0);

-- ── Vendor addresses table ─────────────────────────────────────────────
ALTER TABLE public.vendor_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can add vendor address"    ON public.vendor_addresses;
DROP POLICY IF EXISTS "Public can delete vendor address"  ON public.vendor_addresses;

CREATE POLICY "Public can add vendor address"
  ON public.vendor_addresses FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous DELETE — the form rolls back addresses on failure
CREATE POLICY "Public can delete vendor address"
  ON public.vendor_addresses FOR DELETE
  TO anon
  USING (true);

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
-- Create the bucket if it doesn't exist yet.
INSERT INTO storage.buckets (id, name, public) VALUES ('Dikho', 'Dikho', false)
  ON CONFLICT (id) DO NOTHING;

-- Storage policies for anonymous vendor document uploads
DROP POLICY IF EXISTS "Anon can upload vendor documents" ON storage.objects;

CREATE POLICY "Anon can upload vendor documents"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'Dikho' AND (storage.foldername(name))[1] = 'vendors_documents');

-- Allow cleanup on upload failure
DROP POLICY IF EXISTS "Anon can delete vendor documents" ON storage.objects;

CREATE POLICY "Anon can delete vendor documents"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'Dikho' AND (storage.foldername(name))[1] = 'vendors_documents');
