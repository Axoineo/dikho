-- Migration: Sales Order module schema for Dikho SO-PO
-- Created: 2026-08-29
--
-- salesorder          — parent: one row per sales order.
-- salesorderdocument  — child: line items / documents belonging to an order.
--
-- Both tables are created here (mirroring 20260821_device_tracking.sql, which
-- bundles its two related tables in one file). The column set is exactly what
-- the Sales Orders UI reads and writes — nothing speculative.
--
-- Money invariants the UI guarantees before it writes:
--   sub_total = Σ taxable_amount, tax_total = Σ tax_amount, total = Σ after_tax_amount
--   per item: taxable_amount + tax_amount = after_tax_amount
--             tax_amount = cgst + sgst + igst + utgst
-- They are stored as plain columns (not generated/checked) so the app stays the
-- single source of truth; it reconciles them on the client before every save.
--
-- This migration is idempotent: tables and indexes use IF NOT EXISTS, and each
-- policy is dropped-then-created, so it is safe to re-run.

-- ── salesorder (parent) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.salesorder (
  id                     bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- identity / references
  order_number           text          NOT NULL,
  unique_id              text,
  crm_reference_id       text,

  -- client (company = client company name; fullname = contact person)
  company                text          NOT NULL,
  order_client_fullname  text,

  -- classification
  order_type             text,
  brand_name             text,
  multi_purpose_so       boolean       NOT NULL DEFAULT false,

  -- dates
  order_date             date,
  invoice_date           date,
  campaign_start_date    date,
  campaign_end_date      date,

  -- money (Σ of the child rows; reconciled client-side before write)
  sub_total              numeric(14,2) NOT NULL DEFAULT 0,
  tax_total              numeric(14,2) NOT NULL DEFAULT 0,
  total                  numeric(14,2) NOT NULL DEFAULT 0,
  payment_receipt_amount numeric(14,2),

  -- workflow
  order_status           text,
  purchase_status        text,
  order_color            text,

  -- approval / completion
  approved_by            text,
  approved_date          date,
  complete_date          date,

  -- logistics
  invoice_courier        text,

  -- audit: created_by is a display name/email (text); created_by_id links the
  -- auth user and is stamped best-effort after insert. ON DELETE SET NULL keeps
  -- the business record if the user is later removed.
  created_by             text,
  created_by_id          uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now()
);

-- The list orders by id DESC (PK index covers it); these help the human lookups.
CREATE INDEX IF NOT EXISTS salesorder_order_number_idx ON public.salesorder (order_number);
CREATE INDEX IF NOT EXISTS salesorder_created_at_idx   ON public.salesorder (created_at DESC);

-- ── salesorderdocument (child) ───────────────────────────────────────────────
-- purchase_order_id / inv_id / inv_number are deliberately plain columns with no
-- foreign key: the PO and invoice modules do not exist yet, so there is nothing
-- to reference. Add the constraints when those tables land.

CREATE TABLE IF NOT EXISTS public.salesorderdocument (
  id                    bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sales_order_id        bigint        NOT NULL
                                      REFERENCES public.salesorder(id) ON DELETE CASCADE,

  -- what the row is
  type                  text,
  name                  text          NOT NULL,
  short_name            text,
  label                 text,
  reference_type        text,
  "date"                date,
  invoice_number        text,

  -- money: taxable_amount + tax_amount = after_tax_amount, and
  -- tax_amount = cgst + sgst + igst + utgst. The UI derives every one of these
  -- from the taxable amount and the GST type before it writes.
  is_taxable            boolean       NOT NULL DEFAULT true,
  gst_type              text,
  taxable_amount        numeric(14,2) NOT NULL DEFAULT 0,
  cgst_amount           numeric(14,2) NOT NULL DEFAULT 0,
  sgst_amount           numeric(14,2) NOT NULL DEFAULT 0,
  igst_amount           numeric(14,2) NOT NULL DEFAULT 0,
  utgst_amount          numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount            numeric(14,2) NOT NULL DEFAULT 0,
  after_tax_amount      numeric(14,2) NOT NULL DEFAULT 0,

  -- annotation / workflow
  document_color        text,
  document_note         text,
  self_audit_completed  boolean       NOT NULL DEFAULT false,
  file_url              text,
  document_courier      text,
  courier_status        text,

  -- cross-module references (no FK yet — see note above)
  purchase_order_id     bigint,
  inv_id                bigint,
  inv_number            text,

  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

-- Every read is "the items belonging to this one sales order", so the FK is the
-- only index that matters for the module's own queries.
CREATE INDEX IF NOT EXISTS salesorderdocument_sales_order_id_idx
  ON public.salesorderdocument (sales_order_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- The browser talks to PostgREST with the publishable key and a signed-in
-- session, so the JWT role is `authenticated`. The Sales Orders list, search and
-- details panel are team-wide (every order is visible to every signed-in user —
-- created_by is an audit stamp, not an ownership boundary), so a single
-- FOR ALL TO authenticated policy is the correct match for the built UI.
--
-- If your other tables (clients / vendors) scope rows by created_by, tighten
-- these to match — but note the master list would then only show a user's own
-- orders, which is not what this module was built to do.

ALTER TABLE public.salesorder         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salesorderdocument ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "salesorder_authenticated_all" ON public.salesorder;
CREATE POLICY "salesorder_authenticated_all"
  ON public.salesorder
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "salesorderdocument_authenticated_all" ON public.salesorderdocument;
CREATE POLICY "salesorderdocument_authenticated_all"
  ON public.salesorderdocument
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Tell PostgREST about the new tables immediately ──────────────────────────
-- Without this the API keeps serving its cached schema and returns
-- "Could not find the table 'public.salesorder' in the schema cache" until the
-- cache expires. Supabase's PostgREST listens on this channel.
NOTIFY pgrst, 'reload schema';
