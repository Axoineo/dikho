-- Migration: PO Relationships and Views
-- Created: 2026-09-04

-- Add a foreign key to link a PO item back to its specific parent SO item
ALTER TABLE public.salesorderdocument
  ADD COLUMN IF NOT EXISTS so_item_id bigint REFERENCES public.salesorderdocument(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS salesorderdocument_so_item_id_idx ON public.salesorderdocument(so_item_id);
CREATE INDEX IF NOT EXISTS salesorderdocument_purchase_order_id_idx ON public.salesorderdocument(purchase_order_id);

-- Add vendor_address_id to salesorder to save the selected vendor address snapshot for POs
ALTER TABLE public.salesorder
  ADD COLUMN IF NOT EXISTS vendor_address_id bigint REFERENCES public.vendor_addresses(id) ON DELETE SET NULL;

-- Create a view for PO Items / Documents to expose the calculated profit and related SO fields
CREATE OR REPLACE VIEW public.purchaseorderdocuments AS
SELECT
  po_item.id,
  po_item.purchase_order_id,
  po_item.type,
  po_item.name,
  po_item.short_name,
  po_item."date",
  po_item.label,
  po_item.invoice_number,
  po_item.is_taxable,
  po_item.gst_type,
  po_item.taxable_amount,
  po_item.utgst_amount,
  po_item.igst_amount,
  po_item.sgst_amount,
  po_item.cgst_amount,
  po_item.tax_amount,
  po_item.after_tax_amount,
  po_item.document_color,
  po_item.document_note,
  po_item.self_audit_completed,
  po_item.courier_status AS document_status,
  po_item.created_at,
  po_item.updated_at,
  po_item.file_url,
  
  -- Calculated and joined fields
  po_item.taxable_amount AS po_before_tax,
  so_item.taxable_amount AS so_item_before_tax,
  (so_item.taxable_amount - po_item.taxable_amount) AS profit,
  so.brand_name

FROM public.salesorderdocument po_item
LEFT JOIN public.salesorderdocument so_item ON so_item.id = po_item.so_item_id
LEFT JOIN public.salesorder so ON so.id = so_item.sales_order_id
WHERE po_item.purchase_order_id IS NOT NULL;

-- Ensure PostgREST reloads the schema cache
NOTIFY pgrst, 'reload schema';
