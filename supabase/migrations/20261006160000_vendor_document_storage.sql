-- ============================================================================
-- VENDOR DOCUMENT STORAGE: least-privilege policies for the `Dikho` bucket.
--
-- Effective policies on storage.objects, exported from production 2026-10-05:
--   "Anon can upload vendor documents"  INSERT anon  bucket Dikho, vendors_documents/*
--   "vendor documents read|upload|update|delete"
--                                        ALL four verbs, authenticated, whole bucket
--   "authenticated users can read|upload|update|delete vendor documents"
--                                        ALL four verbs, authenticated, bucket
--                                        'vendor-documents' (that bucket does not
--                                        exist; the policies would arm themselves
--                                        if anyone created it)
--
-- So: anyone could write into vendors_documents/ without passing Turnstile, and
-- any signed-in account could read, overwrite or delete every vendor's
-- documents. The bucket accepted 50 MB of any type.
--
-- AFTER THIS:
--   anon           no access at all. The public vendor form now uploads
--                  through POST /api/public/vendor, which verifies Turnstile,
--                  checks size and real file type, and stores the file with the
--                  service role under vendors_documents/public/<uuid>.<ext>.
--   staff read     any object under vendors_documents/ (the vendor list opens
--                  documents through short-lived signed URLs, which need SELECT).
--   staff upload   only to vendors_documents/<id of an existing vendor>/...,
--                  which is the path AddVendorModal writes.
--   staff update   nobody. Uploads use upsert:false, so nothing needs it, and
--                  replacing evidence in place is what we want to rule out.
--   staff delete   only objects the same user uploaded (AddVendorModal removes
--                  its own upload when the vendor save fails). Nobody can
--                  delete another person's or a public upload through the API.
--   bucket         10 MB per object, PDF/JPEG/PNG/WEBP only, enforced by
--                  Storage itself for every caller including the service role.
-- "Staff" is public.is_staff() from 20261006143107_staff_membership.sql, which
-- must be applied first.
--
-- ORDER: apply only after the API Worker with the new /api/public/vendor and
-- the SPA that uses it are both live (see the header of
-- 20261006143107_staff_membership.sql for the full sequence). Applied earlier,
-- the old public form's direct upload fails; it is written to carry on without
-- the document, so registrations still save, but they lose their attachment.
--
-- ROLLBACK (re-opens the findings; emergencies only):
--   create policy "Anon can upload vendor documents" on storage.objects
--     for insert to anon
--     with check (bucket_id = 'Dikho' and (storage.foldername(name))[1] = 'vendors_documents');
--
-- Existing objects are not moved, re-typed or deleted. Idempotent.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Remove every existing policy that touches these buckets.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "Anon can upload vendor documents" on storage.objects;
drop policy if exists "Anon can delete vendor documents" on storage.objects;

drop policy if exists "vendor documents read"   on storage.objects;
drop policy if exists "vendor documents upload" on storage.objects;
drop policy if exists "vendor documents update" on storage.objects;
drop policy if exists "vendor documents delete" on storage.objects;

drop policy if exists "authenticated users can read vendor documents"   on storage.objects;
drop policy if exists "authenticated users can upload vendor documents" on storage.objects;
drop policy if exists "authenticated users can update vendor documents" on storage.objects;
drop policy if exists "authenticated users can delete vendor documents" on storage.objects;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Scoped staff policies.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "staff read vendor documents" on storage.objects;
create policy "staff read vendor documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'Dikho'
    and (storage.foldername(name))[1] = 'vendors_documents'
    and (select public.is_staff())
  );

drop policy if exists "staff upload documents for a known vendor" on storage.objects;
create policy "staff upload documents for a known vendor"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'Dikho'
    and (storage.foldername(name))[1] = 'vendors_documents'
    and array_length(storage.foldername(name), 1) = 2
    and exists (
      select 1 from public.vendors v
      where v.id::text = (storage.foldername(name))[2]
    )
    and (select public.is_staff())
  );

drop policy if exists "staff delete their own vendor document uploads" on storage.objects;
create policy "staff delete their own vendor document uploads"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'Dikho'
    and (storage.foldername(name))[1] = 'vendors_documents'
    and owner_id = (select auth.uid())::text
    and (select public.is_staff())
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Bucket limits, enforced by Storage for every upload.
-- ─────────────────────────────────────────────────────────────────────────
update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
where id = 'Dikho';
