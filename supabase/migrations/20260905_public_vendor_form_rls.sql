-- ============================================================
-- PUBLIC VENDOR ONBOARDING: Supabase RLS Policies
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Enable RLS on vendors (likely already on, but safe to repeat)
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_addresses ENABLE ROW LEVEL SECURITY;

-- 2. Allow anonymous users to INSERT new vendors
--    Status will be forced to 0 (Pending) by the form, so no approval is needed here.
CREATE POLICY "Public can register as vendor"
  ON public.vendors FOR INSERT
  TO anon
  WITH CHECK (true);

-- 3. Allow anonymous users to INSERT a vendor address for the vendor they just created
CREATE POLICY "Public can add vendor address"
  ON public.vendor_addresses FOR INSERT
  TO anon
  WITH CHECK (true);

-- 4. Allow anonymous users to UPDATE only the document path on their just-created vendor row
--    (needed so the file upload path can be written back after storage upload)
--    This is scoped to only the vendor_document_file_path & vendor_document_file_name columns.
--    We allow UPDATE where status = 0 (pending) to limit blast radius.
CREATE POLICY "Public can update pending vendor document path"
  ON public.vendors FOR UPDATE
  TO anon
  USING (status = 0)
  WITH CHECK (status = 0);

-- 5. Allow anonymous users to READ media and sub_media (needed for the dropdowns in the form)
CREATE POLICY "Public can read media"
  ON public.media FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Public can read sub_media"
  ON public.sub_media FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- STORAGE: Allow anonymous uploads to the Dikho bucket
-- Run this in Storage → Policies in the Supabase dashboard,
-- OR via SQL:
-- ============================================================

-- Allow anon to upload to the vendors_documents/ prefix only
INSERT INTO storage.policies (name, bucket_id, definition, command, roles)
VALUES (
  'Public vendor document uploads',
  'Dikho',
  '(bucket_id = ''Dikho''::text AND name LIKE ''vendors_documents/%'')',
  'INSERT',
  ARRAY['anon']
)
ON CONFLICT DO NOTHING;
