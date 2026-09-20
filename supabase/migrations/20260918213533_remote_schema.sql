drop extension if exists "pg_net";


  create table "public"."document_events" (
    "id" uuid not null default gen_random_uuid(),
    "entity_type" text not null,
    "entity_id" uuid not null,
    "event_type" text not null,
    "payload" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now(),
    "created_by" uuid default auth.uid()
      );


alter table "public"."document_events" enable row level security;


  create table "public"."invoice_lines" (
    "id" bigint generated always as identity not null,
    "invoice_id" uuid not null,
    "source_sales_order_item_id" bigint,
    "line_number" integer not null,
    "description" text not null,
    "hsn_sac" text,
    "quantity" numeric(14,3) not null default 1,
    "unit" text not null default 'NOS'::text,
    "unit_price" numeric(14,2) not null default 0,
    "discount_amount" numeric(14,2) not null default 0,
    "taxable_amount" numeric(14,2) not null default 0,
    "gst_rate" numeric(5,2) not null default 0,
    "gst_type" text,
    "cgst_amount" numeric(14,2) not null default 0,
    "sgst_amount" numeric(14,2) not null default 0,
    "igst_amount" numeric(14,2) not null default 0,
    "utgst_amount" numeric(14,2) not null default 0,
    "tax_amount" numeric(14,2) not null default 0,
    "total_amount" numeric(14,2) not null default 0,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."invoice_lines" enable row level security;


  create table "public"."invoice_sequences" (
    "organization_profile_id" uuid not null,
    "invoice_month" date not null,
    "last_number" integer not null default 0
      );


alter table "public"."invoice_sequences" enable row level security;


  create table "public"."invoices" (
    "id" uuid not null default gen_random_uuid(),
    "organization_profile_id" uuid not null,
    "sales_order_id" bigint,
    "status" text not null default 'draft'::text,
    "invoice_number" text,
    "invoice_date" date not null default CURRENT_DATE,
    "due_date" date,
    "currency" text not null default 'INR'::text,
    "place_of_supply" text not null,
    "buyer_name" text not null,
    "buyer_gstin" text,
    "buyer_pan" text,
    "buyer_contact_name" text,
    "buyer_email" text,
    "buyer_phone" text,
    "buyer_address_line1" text not null,
    "buyer_address_line2" text,
    "buyer_city" text not null,
    "buyer_state" text not null,
    "buyer_state_code" text not null,
    "buyer_country" text not null default 'India'::text,
    "buyer_pincode" text not null,
    "seller_snapshot" jsonb not null default '{}'::jsonb,
    "subtotal" numeric(14,2) not null default 0,
    "tax_total" numeric(14,2) not null default 0,
    "grand_total" numeric(14,2) not null default 0,
    "notes" text,
    "terms" text,
    "issued_at" timestamp with time zone,
    "issued_by" uuid,
    "cancelled_at" timestamp with time zone,
    "cancelled_by" uuid,
    "cancellation_reason" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."invoices" enable row level security;


  create table "public"."organization_profiles" (
    "id" uuid not null default gen_random_uuid(),
    "profile_code" text not null,
    "legal_name" text not null,
    "gstin" text,
    "pan" text,
    "address_line1" text not null,
    "address_line2" text,
    "city" text not null,
    "state" text not null,
    "state_code" text not null,
    "country" text not null default 'India'::text,
    "pincode" text not null,
    "bank_name" text,
    "bank_account_name" text,
    "bank_account_number" text,
    "bank_ifsc" text,
    "bank_branch" text,
    "invoice_prefix" text not null default 'DGM'::text,
    "invoice_terms_days" integer not null default 30,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."organization_profiles" enable row level security;


  create table "public"."payment_allocations" (
    "id" uuid not null default gen_random_uuid(),
    "payment_id" uuid not null,
    "invoice_id" uuid not null,
    "amount" numeric(14,2) not null,
    "created_at" timestamp with time zone not null default now(),
    "created_by" uuid default auth.uid()
      );


alter table "public"."payment_allocations" enable row level security;


  create table "public"."payments" (
    "id" uuid not null default gen_random_uuid(),
    "organization_profile_id" uuid not null,
    "receipt_number" text,
    "status" text not null default 'recorded'::text,
    "payment_date" date not null default CURRENT_DATE,
    "payer_name" text not null,
    "payer_gstin" text,
    "amount" numeric(14,2) not null,
    "payment_method" text not null,
    "reference_number" text,
    "bank_name" text,
    "notes" text,
    "voided_at" timestamp with time zone,
    "voided_by" uuid,
    "void_reason" text,
    "created_by" uuid default auth.uid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."payments" enable row level security;


  create table "public"."purchaseorders" (
    "id" text not null,
    "crm_reference_id" text,
    "company" text,
    "order_type" text,
    "unique_id" text,
    "order_number" text,
    "order_date" text,
    "sub_total" text,
    "tax_total" text,
    "total" text,
    "order_sales_number" text,
    "campaign_start_date" text,
    "campaign_end_date" text,
    "order_vendor_fullname" text,
    "created_by" text,
    "approved_date" text,
    "approved_by" text,
    "order_status" text,
    "complete_date" text,
    "order_color" text,
    "payment_request_amount" text,
    "id_1" text,
    "city" text,
    "type" text,
    "alias" text,
    "email" text,
    "gstin" text,
    "state" text,
    "address" text,
    "contact" text,
    "country" text,
    "zipcode" text,
    "telephone" text,
    "address_id" text,
    "created_by_1" text,
    "gstin_date" text,
    "pan_number" text,
    "updated_by" text,
    "tds_section" text,
    "vendor_type" text,
    "activated_at" text,
    "activated_by" text,
    "company_name" text,
    "country_code" text,
    "creator_name" text,
    "registration" text,
    "updater_name" text,
    "date_of_birth" text,
    "activator_name" text,
    "contact_person" text,
    "tds_percentage" text,
    "opening_balance" text,
    "country_dialcode" text,
    "vendor_bank_name" text,
    "vendor_ifsc_code" text,
    "payment_term_type" text,
    "payment_term_value" text,
    "document_deleted_at" text,
    "document_deleted_by" text,
    "created_at_formatted" text,
    "updated_at_formatted" text,
    "date_of_incorporation" text,
    "document_deletor_name" text,
    "vendor_account_number" text,
    "activated_at_formatted" text,
    "vendor_document_file_name" text,
    "vendor_document_file_path" text,
    "date_of_marriage_anniversary" text,
    "document_deleted_at_formatted" text,
    "vendor_confirm_account_number" text,
    "status" text,
    "created_at" text,
    "ledger_add" text,
    "updated_at" text,
    "so_item_before_tax" text,
    "po_before_tax" text,
    "profit" text,
    "brand_name" text,
    "id_2" text,
    "purchase_order_id" text,
    "type_1" text,
    "name" text,
    "short_name" text,
    "date" text,
    "label" text,
    "invoice_number" text,
    "is_taxable" text,
    "gst_type" text,
    "taxable_amount" text,
    "utgst_amount" text,
    "igst_amount" text,
    "sgst_amount" text,
    "cgst_amount" text,
    "tax_amount" text,
    "after_tax_amount" text,
    "document_color" text,
    "document_note" text,
    "self_audit_completed" text,
    "document_status" text,
    "created_at_1" text,
    "updated_at_1" text,
    "file_url" text
      );


alter table "public"."purchaseorders" enable row level security;


  create table "public"."salesorders" (
    "id" bigint not null,
    "crm_reference_id" text,
    "company" text,
    "order_type" text,
    "unique_id" text,
    "order_number" text,
    "order_date" timestamp with time zone,
    "invoice_date" text,
    "sub_total" text,
    "tax_total" double precision,
    "total" text,
    "campaign_start_date" timestamp with time zone,
    "campaign_end_date" text,
    "order_client_fullname" text,
    "created_by" text,
    "created_by_id" text,
    "approved_date" text,
    "approved_by" text,
    "order_status" text,
    "purchase_status" text,
    "complete_date" text,
    "order_color" text,
    "created_at" timestamp with time zone,
    "updated_at" text,
    "multi_purpose_so" text,
    "brand_name" text,
    "invoice_courier" text,
    "id_1" text,
    "sales_order_id" text,
    "type" text,
    "name" text,
    "short_name" text,
    "date" text,
    "label" text,
    "invoice_number" text,
    "is_taxable" text,
    "gst_type" text,
    "taxable_amount" text,
    "utgst_amount" text,
    "igst_amount" text,
    "sgst_amount" text,
    "cgst_amount" text,
    "tax_amount" text,
    "after_tax_amount" text,
    "document_color" text,
    "document_note" text,
    "self_audit_completed" text,
    "reference_type" text,
    "purchase_order_id" text,
    "created_at_1" text,
    "updated_at_1" text,
    "file_url" text,
    "document_courier" text,
    "courier_status" text
      );


alter table "public"."salesorders" enable row level security;


  create table "public"."vendor_media" (
    "id" bigint generated by default as identity not null,
    "vendor_id" bigint not null,
    "media_id" bigint not null,
    "sub_media_id" bigint not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."vendor_media" enable row level security;

alter sequence "public"."vendors_id_seq" owned by "public"."vendors"."id";

CREATE INDEX document_events_entity_idx ON public.document_events USING btree (entity_type, entity_id, created_at DESC);

CREATE UNIQUE INDEX document_events_pkey ON public.document_events USING btree (id);

CREATE INDEX invoice_lines_invoice_id_idx ON public.invoice_lines USING btree (invoice_id);

CREATE UNIQUE INDEX invoice_lines_invoice_id_line_number_key ON public.invoice_lines USING btree (invoice_id, line_number);

CREATE UNIQUE INDEX invoice_lines_pkey ON public.invoice_lines USING btree (id);

CREATE UNIQUE INDEX invoice_sequences_pkey ON public.invoice_sequences USING btree (organization_profile_id, invoice_month);

CREATE UNIQUE INDEX invoices_issued_number_unique ON public.invoices USING btree (organization_profile_id, invoice_number) WHERE (invoice_number IS NOT NULL);

CREATE UNIQUE INDEX invoices_pkey ON public.invoices USING btree (id);

CREATE INDEX invoices_sales_order_id_idx ON public.invoices USING btree (sales_order_id);

CREATE INDEX invoices_status_due_date_idx ON public.invoices USING btree (status, due_date);

CREATE UNIQUE INDEX organization_profiles_pkey ON public.organization_profiles USING btree (id);

CREATE UNIQUE INDEX organization_profiles_profile_code_key ON public.organization_profiles USING btree (profile_code);

CREATE INDEX payment_allocations_invoice_id_idx ON public.payment_allocations USING btree (invoice_id);

CREATE UNIQUE INDEX payment_allocations_payment_id_invoice_id_key ON public.payment_allocations USING btree (payment_id, invoice_id);

CREATE UNIQUE INDEX payment_allocations_pkey ON public.payment_allocations USING btree (id);

CREATE INDEX payments_payment_date_idx ON public.payments USING btree (payment_date DESC);

CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id);

CREATE UNIQUE INDEX payments_receipt_number_unique ON public.payments USING btree (organization_profile_id, receipt_number) WHERE (receipt_number IS NOT NULL);

CREATE UNIQUE INDEX purchaseorders_pkey ON public.purchaseorders USING btree (id);

CREATE UNIQUE INDEX salesorders_pkey ON public.salesorders USING btree (id);

CREATE UNIQUE INDEX vendor_media_pkey ON public.vendor_media USING btree (id);

CREATE UNIQUE INDEX vendor_media_vendor_id_media_id_sub_media_id_key ON public.vendor_media USING btree (vendor_id, media_id, sub_media_id);

alter table "public"."document_events" add constraint "document_events_pkey" PRIMARY KEY using index "document_events_pkey";

alter table "public"."invoice_lines" add constraint "invoice_lines_pkey" PRIMARY KEY using index "invoice_lines_pkey";

alter table "public"."invoice_sequences" add constraint "invoice_sequences_pkey" PRIMARY KEY using index "invoice_sequences_pkey";

alter table "public"."invoices" add constraint "invoices_pkey" PRIMARY KEY using index "invoices_pkey";

alter table "public"."organization_profiles" add constraint "organization_profiles_pkey" PRIMARY KEY using index "organization_profiles_pkey";

alter table "public"."payment_allocations" add constraint "payment_allocations_pkey" PRIMARY KEY using index "payment_allocations_pkey";

alter table "public"."payments" add constraint "payments_pkey" PRIMARY KEY using index "payments_pkey";

alter table "public"."purchaseorders" add constraint "purchaseorders_pkey" PRIMARY KEY using index "purchaseorders_pkey";

alter table "public"."salesorders" add constraint "salesorders_pkey" PRIMARY KEY using index "salesorders_pkey";

alter table "public"."vendor_media" add constraint "vendor_media_pkey" PRIMARY KEY using index "vendor_media_pkey";

alter table "public"."document_events" add constraint "document_events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."document_events" validate constraint "document_events_created_by_fkey";

alter table "public"."document_events" add constraint "document_events_entity_type_check" CHECK ((entity_type = ANY (ARRAY['invoice'::text, 'payment'::text]))) not valid;

alter table "public"."document_events" validate constraint "document_events_entity_type_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_cgst_amount_check" CHECK ((cgst_amount >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_cgst_amount_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_check" CHECK ((tax_amount = (((cgst_amount + sgst_amount) + igst_amount) + utgst_amount))) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_check1" CHECK ((total_amount = (taxable_amount + tax_amount))) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_check1";

alter table "public"."invoice_lines" add constraint "invoice_lines_check2" CHECK ((discount_amount <= (quantity * unit_price))) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_check2";

alter table "public"."invoice_lines" add constraint "invoice_lines_check3" CHECK ((taxable_amount = round(((quantity * unit_price) - discount_amount), 2))) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_check3";

alter table "public"."invoice_lines" add constraint "invoice_lines_discount_amount_check" CHECK ((discount_amount >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_discount_amount_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_gst_rate_check" CHECK ((gst_rate = ANY (ARRAY[(0)::numeric, (5)::numeric, (12)::numeric, (18)::numeric, (28)::numeric]))) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_gst_rate_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_gst_type_check" CHECK ((gst_type = ANY (ARRAY['Intra-State'::text, 'Inter-State'::text, 'Union Territory'::text]))) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_gst_type_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_igst_amount_check" CHECK ((igst_amount >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_igst_amount_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_invoice_id_fkey";

alter table "public"."invoice_lines" add constraint "invoice_lines_invoice_id_line_number_key" UNIQUE using index "invoice_lines_invoice_id_line_number_key";

alter table "public"."invoice_lines" add constraint "invoice_lines_line_number_check" CHECK ((line_number > 0)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_line_number_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_quantity_check" CHECK ((quantity > (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_quantity_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_sgst_amount_check" CHECK ((sgst_amount >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_sgst_amount_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_source_sales_order_item_id_fkey" FOREIGN KEY (source_sales_order_item_id) REFERENCES public.salesorderdocument(id) ON DELETE SET NULL not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_source_sales_order_item_id_fkey";

alter table "public"."invoice_lines" add constraint "invoice_lines_tax_amount_check" CHECK ((tax_amount >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_tax_amount_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_taxable_amount_check" CHECK ((taxable_amount >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_taxable_amount_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_total_amount_check" CHECK ((total_amount >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_total_amount_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_unit_price_check" CHECK ((unit_price >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_unit_price_check";

alter table "public"."invoice_lines" add constraint "invoice_lines_utgst_amount_check" CHECK ((utgst_amount >= (0)::numeric)) not valid;

alter table "public"."invoice_lines" validate constraint "invoice_lines_utgst_amount_check";

alter table "public"."invoice_sequences" add constraint "invoice_sequences_invoice_month_check" CHECK ((invoice_month = (date_trunc('month'::text, (invoice_month)::timestamp with time zone))::date)) not valid;

alter table "public"."invoice_sequences" validate constraint "invoice_sequences_invoice_month_check";

alter table "public"."invoice_sequences" add constraint "invoice_sequences_last_number_check" CHECK ((last_number >= 0)) not valid;

alter table "public"."invoice_sequences" validate constraint "invoice_sequences_last_number_check";

alter table "public"."invoice_sequences" add constraint "invoice_sequences_organization_profile_id_fkey" FOREIGN KEY (organization_profile_id) REFERENCES public.organization_profiles(id) ON DELETE RESTRICT not valid;

alter table "public"."invoice_sequences" validate constraint "invoice_sequences_organization_profile_id_fkey";

alter table "public"."invoices" add constraint "invoices_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."invoices" validate constraint "invoices_cancelled_by_fkey";

alter table "public"."invoices" add constraint "invoices_check" CHECK ((grand_total = (subtotal + tax_total))) not valid;

alter table "public"."invoices" validate constraint "invoices_check";

alter table "public"."invoices" add constraint "invoices_check1" CHECK (((status = 'issued'::text) = (invoice_number IS NOT NULL))) not valid;

alter table "public"."invoices" validate constraint "invoices_check1";

alter table "public"."invoices" add constraint "invoices_check2" CHECK (((due_date IS NULL) OR (due_date >= invoice_date))) not valid;

alter table "public"."invoices" validate constraint "invoices_check2";

alter table "public"."invoices" add constraint "invoices_currency_check" CHECK ((currency = 'INR'::text)) not valid;

alter table "public"."invoices" validate constraint "invoices_currency_check";

alter table "public"."invoices" add constraint "invoices_grand_total_check" CHECK ((grand_total >= (0)::numeric)) not valid;

alter table "public"."invoices" validate constraint "invoices_grand_total_check";

alter table "public"."invoices" add constraint "invoices_issued_by_fkey" FOREIGN KEY (issued_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."invoices" validate constraint "invoices_issued_by_fkey";

alter table "public"."invoices" add constraint "invoices_organization_profile_id_fkey" FOREIGN KEY (organization_profile_id) REFERENCES public.organization_profiles(id) ON DELETE RESTRICT not valid;

alter table "public"."invoices" validate constraint "invoices_organization_profile_id_fkey";

alter table "public"."invoices" add constraint "invoices_sales_order_id_fkey" FOREIGN KEY (sales_order_id) REFERENCES public.salesorder(id) ON DELETE SET NULL not valid;

alter table "public"."invoices" validate constraint "invoices_sales_order_id_fkey";

alter table "public"."invoices" add constraint "invoices_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'issued'::text, 'cancelled'::text]))) not valid;

alter table "public"."invoices" validate constraint "invoices_status_check";

alter table "public"."invoices" add constraint "invoices_subtotal_check" CHECK ((subtotal >= (0)::numeric)) not valid;

alter table "public"."invoices" validate constraint "invoices_subtotal_check";

alter table "public"."invoices" add constraint "invoices_tax_total_check" CHECK ((tax_total >= (0)::numeric)) not valid;

alter table "public"."invoices" validate constraint "invoices_tax_total_check";

alter table "public"."organization_profiles" add constraint "organization_profiles_invoice_terms_days_check" CHECK ((invoice_terms_days >= 0)) not valid;

alter table "public"."organization_profiles" validate constraint "organization_profiles_invoice_terms_days_check";

alter table "public"."organization_profiles" add constraint "organization_profiles_profile_code_key" UNIQUE using index "organization_profiles_profile_code_key";

alter table "public"."payment_allocations" add constraint "payment_allocations_amount_check" CHECK ((amount > (0)::numeric)) not valid;

alter table "public"."payment_allocations" validate constraint "payment_allocations_amount_check";

alter table "public"."payment_allocations" add constraint "payment_allocations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."payment_allocations" validate constraint "payment_allocations_created_by_fkey";

alter table "public"."payment_allocations" add constraint "payment_allocations_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT not valid;

alter table "public"."payment_allocations" validate constraint "payment_allocations_invoice_id_fkey";

alter table "public"."payment_allocations" add constraint "payment_allocations_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT not valid;

alter table "public"."payment_allocations" validate constraint "payment_allocations_payment_id_fkey";

alter table "public"."payment_allocations" add constraint "payment_allocations_payment_id_invoice_id_key" UNIQUE using index "payment_allocations_payment_id_invoice_id_key";

alter table "public"."payments" add constraint "payments_amount_check" CHECK ((amount > (0)::numeric)) not valid;

alter table "public"."payments" validate constraint "payments_amount_check";

alter table "public"."payments" add constraint "payments_check" CHECK (((status = 'void'::text) = (voided_at IS NOT NULL))) not valid;

alter table "public"."payments" validate constraint "payments_check";

alter table "public"."payments" add constraint "payments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."payments" validate constraint "payments_created_by_fkey";

alter table "public"."payments" add constraint "payments_organization_profile_id_fkey" FOREIGN KEY (organization_profile_id) REFERENCES public.organization_profiles(id) ON DELETE RESTRICT not valid;

alter table "public"."payments" validate constraint "payments_organization_profile_id_fkey";

alter table "public"."payments" add constraint "payments_payment_method_check" CHECK ((payment_method = ANY (ARRAY['bank_transfer'::text, 'cash'::text, 'cheque'::text, 'upi'::text, 'other'::text]))) not valid;

alter table "public"."payments" validate constraint "payments_payment_method_check";

alter table "public"."payments" add constraint "payments_status_check" CHECK ((status = ANY (ARRAY['recorded'::text, 'void'::text]))) not valid;

alter table "public"."payments" validate constraint "payments_status_check";

alter table "public"."payments" add constraint "payments_voided_by_fkey" FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."payments" validate constraint "payments_voided_by_fkey";

alter table "public"."vendor_media" add constraint "vendor_media_media_id_fkey" FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE RESTRICT not valid;

alter table "public"."vendor_media" validate constraint "vendor_media_media_id_fkey";

alter table "public"."vendor_media" add constraint "vendor_media_sub_media_id_fkey" FOREIGN KEY (sub_media_id) REFERENCES public.sub_media(id) ON DELETE RESTRICT not valid;

alter table "public"."vendor_media" validate constraint "vendor_media_sub_media_id_fkey";

alter table "public"."vendor_media" add constraint "vendor_media_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."vendor_media" validate constraint "vendor_media_vendor_id_fkey";

alter table "public"."vendor_media" add constraint "vendor_media_vendor_id_media_id_sub_media_id_key" UNIQUE using index "vendor_media_vendor_id_media_id_sub_media_id_key";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.finance_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

create or replace view "public"."invoice_balances" as  SELECT invoice.id AS invoice_id,
    invoice.organization_profile_id,
    invoice.status,
    invoice.invoice_number,
    invoice.invoice_date,
    invoice.due_date,
    invoice.buyer_name,
    invoice.grand_total,
    (COALESCE(sum(allocation.amount), (0)::numeric))::numeric(14,2) AS paid_amount,
    ((invoice.grand_total - COALESCE(sum(allocation.amount), (0)::numeric)))::numeric(14,2) AS outstanding_amount
   FROM (public.invoices invoice
     LEFT JOIN public.payment_allocations allocation ON ((allocation.invoice_id = invoice.id)))
  GROUP BY invoice.id;


CREATE OR REPLACE FUNCTION public.issue_invoice(p_invoice_id uuid)
 RETURNS public.invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  invoice_row public.invoices;
  profile_row public.organization_profiles;
  line_count integer;
  calculated_subtotal numeric(14,2);
  calculated_tax_total numeric(14,2);
  calculated_grand_total numeric(14,2);
  next_number integer;
  period_start date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to issue an invoice.';
  END IF;

  SELECT * INTO invoice_row FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;
  IF invoice_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be issued.';
  END IF;

  SELECT * INTO profile_row FROM public.organization_profiles WHERE id = invoice_row.organization_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invoice organization profile no longer exists.';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(taxable_amount), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(total_amount), 0)
  INTO line_count, calculated_subtotal, calculated_tax_total, calculated_grand_total
  FROM public.invoice_lines
  WHERE invoice_id = invoice_row.id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'Add at least one invoice line before issuing.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_lines
    WHERE invoice_id = invoice_row.id
      AND (btrim(description) = '' OR hsn_sac IS NULL OR btrim(hsn_sac) = '')
  ) THEN
    RAISE EXCEPTION 'Every invoice line needs a description and HSN/SAC code before issuing.';
  END IF;
  IF calculated_grand_total <> calculated_subtotal + calculated_tax_total THEN
    RAISE EXCEPTION 'Invoice totals do not reconcile.';
  END IF;

  period_start := date_trunc('month', invoice_row.invoice_date)::date;
  INSERT INTO public.invoice_sequences (organization_profile_id, invoice_month, last_number)
  VALUES (invoice_row.organization_profile_id, period_start, 1)
  ON CONFLICT (organization_profile_id, invoice_month)
  DO UPDATE SET last_number = public.invoice_sequences.last_number + 1
  RETURNING last_number INTO next_number;

  UPDATE public.invoices
  SET status = 'issued',
      invoice_number = profile_row.invoice_prefix || '/' || upper(to_char(invoice_row.invoice_date, 'MON')) || next_number || '/' || to_char(invoice_row.invoice_date, 'YY'),
      subtotal = calculated_subtotal,
      tax_total = calculated_tax_total,
      grand_total = calculated_grand_total,
      due_date = COALESCE(invoice_row.due_date, invoice_row.invoice_date + profile_row.invoice_terms_days),
      seller_snapshot = jsonb_build_object(
        'legal_name', profile_row.legal_name,
        'gstin', profile_row.gstin,
        'pan', profile_row.pan,
        'address_line1', profile_row.address_line1,
        'address_line2', profile_row.address_line2,
        'city', profile_row.city,
        'state', profile_row.state,
        'state_code', profile_row.state_code,
        'country', profile_row.country,
        'pincode', profile_row.pincode,
        'bank_name', profile_row.bank_name,
        'bank_account_name', profile_row.bank_account_name,
        'bank_account_number', profile_row.bank_account_number,
        'bank_ifsc', profile_row.bank_ifsc,
        'bank_branch', profile_row.bank_branch
      ),
      issued_at = now(),
      issued_by = auth.uid()
  WHERE id = invoice_row.id
  RETURNING * INTO invoice_row;

  INSERT INTO public.document_events (entity_type, entity_id, event_type, payload)
  VALUES ('invoice', invoice_row.id, 'issued', jsonb_build_object('invoice_number', invoice_row.invoice_number, 'grand_total', invoice_row.grand_total));

  RETURN invoice_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_issued_invoice_line_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  locked_invoice_id uuid;
BEGIN
  locked_invoice_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.invoice_id
    ELSE NEW.invoice_id
  END;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE id = locked_invoice_id AND status = 'issued') THEN
    RAISE EXCEPTION 'Lines on an issued invoice cannot be changed.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_issued_invoice_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'issued' THEN
    RAISE EXCEPTION 'Issued invoices cannot be deleted. Create a credit note instead.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'issued' THEN
    RAISE EXCEPTION 'Issued invoices cannot be edited. Create a credit note instead.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_void_payment_with_allocations()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'void' AND OLD.status <> 'void'
    AND EXISTS (SELECT 1 FROM public.payment_allocations WHERE payment_id = NEW.id) THEN
    RAISE EXCEPTION 'Remove payment allocations before voiding this receipt.';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_payment_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  payment_row public.payments;
  invoice_row public.invoices;
  allocated_to_payment numeric(14,2);
  allocated_to_invoice numeric(14,2);
BEGIN
  SELECT * INTO payment_row FROM public.payments WHERE id = NEW.payment_id FOR UPDATE;
  SELECT * INTO invoice_row FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;

  IF payment_row.status <> 'recorded' THEN
    RAISE EXCEPTION 'Only recorded payments can be allocated.';
  END IF;
  IF invoice_row.status <> 'issued' THEN
    RAISE EXCEPTION 'Payments can only be allocated to issued invoices.';
  END IF;
  IF payment_row.organization_profile_id <> invoice_row.organization_profile_id THEN
    RAISE EXCEPTION 'Payment and invoice must belong to the same organization.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO allocated_to_payment
  FROM public.payment_allocations
  WHERE payment_id = NEW.payment_id AND id IS DISTINCT FROM NEW.id;

  SELECT COALESCE(SUM(amount), 0) INTO allocated_to_invoice
  FROM public.payment_allocations
  WHERE invoice_id = NEW.invoice_id AND id IS DISTINCT FROM NEW.id;

  IF allocated_to_payment + NEW.amount > payment_row.amount THEN
    RAISE EXCEPTION 'Allocation exceeds the available payment amount.';
  END IF;
  IF allocated_to_invoice + NEW.amount > invoice_row.grand_total THEN
    RAISE EXCEPTION 'Allocation exceeds the invoice balance.';
  END IF;

  RETURN NEW;
END;
$function$
;

grant delete on table "public"."document_events" to "anon";

grant insert on table "public"."document_events" to "anon";

grant references on table "public"."document_events" to "anon";

grant select on table "public"."document_events" to "anon";

grant trigger on table "public"."document_events" to "anon";

grant truncate on table "public"."document_events" to "anon";

grant update on table "public"."document_events" to "anon";

grant delete on table "public"."document_events" to "authenticated";

grant insert on table "public"."document_events" to "authenticated";

grant references on table "public"."document_events" to "authenticated";

grant select on table "public"."document_events" to "authenticated";

grant trigger on table "public"."document_events" to "authenticated";

grant truncate on table "public"."document_events" to "authenticated";

grant update on table "public"."document_events" to "authenticated";

grant delete on table "public"."document_events" to "service_role";

grant insert on table "public"."document_events" to "service_role";

grant references on table "public"."document_events" to "service_role";

grant select on table "public"."document_events" to "service_role";

grant trigger on table "public"."document_events" to "service_role";

grant truncate on table "public"."document_events" to "service_role";

grant update on table "public"."document_events" to "service_role";

grant delete on table "public"."invoice_lines" to "anon";

grant insert on table "public"."invoice_lines" to "anon";

grant references on table "public"."invoice_lines" to "anon";

grant select on table "public"."invoice_lines" to "anon";

grant trigger on table "public"."invoice_lines" to "anon";

grant truncate on table "public"."invoice_lines" to "anon";

grant update on table "public"."invoice_lines" to "anon";

grant delete on table "public"."invoice_lines" to "authenticated";

grant insert on table "public"."invoice_lines" to "authenticated";

grant references on table "public"."invoice_lines" to "authenticated";

grant select on table "public"."invoice_lines" to "authenticated";

grant trigger on table "public"."invoice_lines" to "authenticated";

grant truncate on table "public"."invoice_lines" to "authenticated";

grant update on table "public"."invoice_lines" to "authenticated";

grant delete on table "public"."invoice_lines" to "service_role";

grant insert on table "public"."invoice_lines" to "service_role";

grant references on table "public"."invoice_lines" to "service_role";

grant select on table "public"."invoice_lines" to "service_role";

grant trigger on table "public"."invoice_lines" to "service_role";

grant truncate on table "public"."invoice_lines" to "service_role";

grant update on table "public"."invoice_lines" to "service_role";

grant delete on table "public"."invoice_sequences" to "anon";

grant insert on table "public"."invoice_sequences" to "anon";

grant references on table "public"."invoice_sequences" to "anon";

grant select on table "public"."invoice_sequences" to "anon";

grant trigger on table "public"."invoice_sequences" to "anon";

grant truncate on table "public"."invoice_sequences" to "anon";

grant update on table "public"."invoice_sequences" to "anon";

grant delete on table "public"."invoice_sequences" to "authenticated";

grant insert on table "public"."invoice_sequences" to "authenticated";

grant references on table "public"."invoice_sequences" to "authenticated";

grant select on table "public"."invoice_sequences" to "authenticated";

grant trigger on table "public"."invoice_sequences" to "authenticated";

grant truncate on table "public"."invoice_sequences" to "authenticated";

grant update on table "public"."invoice_sequences" to "authenticated";

grant delete on table "public"."invoice_sequences" to "service_role";

grant insert on table "public"."invoice_sequences" to "service_role";

grant references on table "public"."invoice_sequences" to "service_role";

grant select on table "public"."invoice_sequences" to "service_role";

grant trigger on table "public"."invoice_sequences" to "service_role";

grant truncate on table "public"."invoice_sequences" to "service_role";

grant update on table "public"."invoice_sequences" to "service_role";

grant delete on table "public"."invoices" to "anon";

grant insert on table "public"."invoices" to "anon";

grant references on table "public"."invoices" to "anon";

grant select on table "public"."invoices" to "anon";

grant trigger on table "public"."invoices" to "anon";

grant truncate on table "public"."invoices" to "anon";

grant update on table "public"."invoices" to "anon";

grant delete on table "public"."invoices" to "authenticated";

grant insert on table "public"."invoices" to "authenticated";

grant references on table "public"."invoices" to "authenticated";

grant select on table "public"."invoices" to "authenticated";

grant trigger on table "public"."invoices" to "authenticated";

grant truncate on table "public"."invoices" to "authenticated";

grant update on table "public"."invoices" to "authenticated";

grant delete on table "public"."invoices" to "service_role";

grant insert on table "public"."invoices" to "service_role";

grant references on table "public"."invoices" to "service_role";

grant select on table "public"."invoices" to "service_role";

grant trigger on table "public"."invoices" to "service_role";

grant truncate on table "public"."invoices" to "service_role";

grant update on table "public"."invoices" to "service_role";

grant delete on table "public"."organization_profiles" to "anon";

grant insert on table "public"."organization_profiles" to "anon";

grant references on table "public"."organization_profiles" to "anon";

grant select on table "public"."organization_profiles" to "anon";

grant trigger on table "public"."organization_profiles" to "anon";

grant truncate on table "public"."organization_profiles" to "anon";

grant update on table "public"."organization_profiles" to "anon";

grant delete on table "public"."organization_profiles" to "authenticated";

grant insert on table "public"."organization_profiles" to "authenticated";

grant references on table "public"."organization_profiles" to "authenticated";

grant select on table "public"."organization_profiles" to "authenticated";

grant trigger on table "public"."organization_profiles" to "authenticated";

grant truncate on table "public"."organization_profiles" to "authenticated";

grant update on table "public"."organization_profiles" to "authenticated";

grant delete on table "public"."organization_profiles" to "service_role";

grant insert on table "public"."organization_profiles" to "service_role";

grant references on table "public"."organization_profiles" to "service_role";

grant select on table "public"."organization_profiles" to "service_role";

grant trigger on table "public"."organization_profiles" to "service_role";

grant truncate on table "public"."organization_profiles" to "service_role";

grant update on table "public"."organization_profiles" to "service_role";

grant delete on table "public"."payment_allocations" to "anon";

grant insert on table "public"."payment_allocations" to "anon";

grant references on table "public"."payment_allocations" to "anon";

grant select on table "public"."payment_allocations" to "anon";

grant trigger on table "public"."payment_allocations" to "anon";

grant truncate on table "public"."payment_allocations" to "anon";

grant update on table "public"."payment_allocations" to "anon";

grant delete on table "public"."payment_allocations" to "authenticated";

grant insert on table "public"."payment_allocations" to "authenticated";

grant references on table "public"."payment_allocations" to "authenticated";

grant select on table "public"."payment_allocations" to "authenticated";

grant trigger on table "public"."payment_allocations" to "authenticated";

grant truncate on table "public"."payment_allocations" to "authenticated";

grant update on table "public"."payment_allocations" to "authenticated";

grant delete on table "public"."payment_allocations" to "service_role";

grant insert on table "public"."payment_allocations" to "service_role";

grant references on table "public"."payment_allocations" to "service_role";

grant select on table "public"."payment_allocations" to "service_role";

grant trigger on table "public"."payment_allocations" to "service_role";

grant truncate on table "public"."payment_allocations" to "service_role";

grant update on table "public"."payment_allocations" to "service_role";

grant delete on table "public"."payments" to "anon";

grant insert on table "public"."payments" to "anon";

grant references on table "public"."payments" to "anon";

grant select on table "public"."payments" to "anon";

grant trigger on table "public"."payments" to "anon";

grant truncate on table "public"."payments" to "anon";

grant update on table "public"."payments" to "anon";

grant delete on table "public"."payments" to "authenticated";

grant insert on table "public"."payments" to "authenticated";

grant references on table "public"."payments" to "authenticated";

grant select on table "public"."payments" to "authenticated";

grant trigger on table "public"."payments" to "authenticated";

grant truncate on table "public"."payments" to "authenticated";

grant update on table "public"."payments" to "authenticated";

grant delete on table "public"."payments" to "service_role";

grant insert on table "public"."payments" to "service_role";

grant references on table "public"."payments" to "service_role";

grant select on table "public"."payments" to "service_role";

grant trigger on table "public"."payments" to "service_role";

grant truncate on table "public"."payments" to "service_role";

grant update on table "public"."payments" to "service_role";

grant delete on table "public"."purchaseorders" to "anon";

grant insert on table "public"."purchaseorders" to "anon";

grant references on table "public"."purchaseorders" to "anon";

grant select on table "public"."purchaseorders" to "anon";

grant trigger on table "public"."purchaseorders" to "anon";

grant truncate on table "public"."purchaseorders" to "anon";

grant update on table "public"."purchaseorders" to "anon";

grant delete on table "public"."purchaseorders" to "authenticated";

grant insert on table "public"."purchaseorders" to "authenticated";

grant references on table "public"."purchaseorders" to "authenticated";

grant select on table "public"."purchaseorders" to "authenticated";

grant trigger on table "public"."purchaseorders" to "authenticated";

grant truncate on table "public"."purchaseorders" to "authenticated";

grant update on table "public"."purchaseorders" to "authenticated";

grant delete on table "public"."purchaseorders" to "service_role";

grant insert on table "public"."purchaseorders" to "service_role";

grant references on table "public"."purchaseorders" to "service_role";

grant select on table "public"."purchaseorders" to "service_role";

grant trigger on table "public"."purchaseorders" to "service_role";

grant truncate on table "public"."purchaseorders" to "service_role";

grant update on table "public"."purchaseorders" to "service_role";

grant delete on table "public"."salesorders" to "anon";

grant insert on table "public"."salesorders" to "anon";

grant references on table "public"."salesorders" to "anon";

grant select on table "public"."salesorders" to "anon";

grant trigger on table "public"."salesorders" to "anon";

grant truncate on table "public"."salesorders" to "anon";

grant update on table "public"."salesorders" to "anon";

grant delete on table "public"."salesorders" to "authenticated";

grant insert on table "public"."salesorders" to "authenticated";

grant references on table "public"."salesorders" to "authenticated";

grant select on table "public"."salesorders" to "authenticated";

grant trigger on table "public"."salesorders" to "authenticated";

grant truncate on table "public"."salesorders" to "authenticated";

grant update on table "public"."salesorders" to "authenticated";

grant delete on table "public"."salesorders" to "service_role";

grant insert on table "public"."salesorders" to "service_role";

grant references on table "public"."salesorders" to "service_role";

grant select on table "public"."salesorders" to "service_role";

grant trigger on table "public"."salesorders" to "service_role";

grant truncate on table "public"."salesorders" to "service_role";

grant update on table "public"."salesorders" to "service_role";

grant delete on table "public"."vendor_media" to "anon";

grant insert on table "public"."vendor_media" to "anon";

grant references on table "public"."vendor_media" to "anon";

grant select on table "public"."vendor_media" to "anon";

grant trigger on table "public"."vendor_media" to "anon";

grant truncate on table "public"."vendor_media" to "anon";

grant update on table "public"."vendor_media" to "anon";

grant delete on table "public"."vendor_media" to "authenticated";

grant insert on table "public"."vendor_media" to "authenticated";

grant references on table "public"."vendor_media" to "authenticated";

grant select on table "public"."vendor_media" to "authenticated";

grant trigger on table "public"."vendor_media" to "authenticated";

grant truncate on table "public"."vendor_media" to "authenticated";

grant update on table "public"."vendor_media" to "authenticated";

grant delete on table "public"."vendor_media" to "service_role";

grant insert on table "public"."vendor_media" to "service_role";

grant references on table "public"."vendor_media" to "service_role";

grant select on table "public"."vendor_media" to "service_role";

grant trigger on table "public"."vendor_media" to "service_role";

grant truncate on table "public"."vendor_media" to "service_role";

grant update on table "public"."vendor_media" to "service_role";


  create policy "Authenticated users can delete clients"
  on "public"."clients"
  as permissive
  for delete
  to authenticated
using (true);



  create policy "Authenticated users can insert clients"
  on "public"."clients"
  as permissive
  for insert
  to authenticated
with check (true);



  create policy "Authenticated users can update clients"
  on "public"."clients"
  as permissive
  for update
  to authenticated
using (true)
with check (true);



  create policy "Authenticated users can view clients"
  on "public"."clients"
  as permissive
  for select
  to authenticated
using (true);



  create policy "finance_authenticated_insert"
  on "public"."document_events"
  as permissive
  for insert
  to authenticated
with check ((created_by = auth.uid()));



  create policy "finance_authenticated_read"
  on "public"."document_events"
  as permissive
  for select
  to authenticated
using (true);



  create policy "finance_authenticated_all"
  on "public"."invoice_lines"
  as permissive
  for all
  to authenticated
using (true)
with check (true);



  create policy "finance_authenticated_read"
  on "public"."invoice_sequences"
  as permissive
  for select
  to authenticated
using (true);



  create policy "finance_authenticated_all"
  on "public"."invoices"
  as permissive
  for all
  to authenticated
using (true)
with check (true);



  create policy "authenticated users can read media"
  on "public"."media"
  as permissive
  for select
  to authenticated
using (true);



  create policy "finance_authenticated_read"
  on "public"."organization_profiles"
  as permissive
  for select
  to authenticated
using (true);



  create policy "finance_authenticated_all"
  on "public"."payment_allocations"
  as permissive
  for all
  to authenticated
using (true)
with check (true);



  create policy "finance_authenticated_all"
  on "public"."payments"
  as permissive
  for all
  to authenticated
using (true)
with check (true);



  create policy "authenticated users can read sub media"
  on "public"."sub_media"
  as permissive
  for select
  to authenticated
using (true);



  create policy "authenticated users can delete vendor addresses"
  on "public"."vendor_addresses"
  as permissive
  for delete
  to authenticated
using (true);



  create policy "authenticated users can insert vendor addresses"
  on "public"."vendor_addresses"
  as permissive
  for insert
  to authenticated
with check (true);



  create policy "authenticated users can read vendor addresses"
  on "public"."vendor_addresses"
  as permissive
  for select
  to authenticated
using (true);



  create policy "authenticated users can update vendor addresses"
  on "public"."vendor_addresses"
  as permissive
  for update
  to authenticated
using (true)
with check (true);



  create policy "authenticated users can delete vendors"
  on "public"."vendors"
  as permissive
  for delete
  to authenticated
using (true);



  create policy "authenticated users can insert vendors"
  on "public"."vendors"
  as permissive
  for insert
  to authenticated
with check (true);



  create policy "authenticated users can read vendors"
  on "public"."vendors"
  as permissive
  for select
  to authenticated
using (true);



  create policy "authenticated users can update vendors"
  on "public"."vendors"
  as permissive
  for update
  to authenticated
using (true)
with check (true);


CREATE TRIGGER invoice_lines_prevent_issued_mutation BEFORE INSERT OR DELETE OR UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.prevent_issued_invoice_line_mutation();

CREATE TRIGGER invoice_lines_touch_updated_at BEFORE UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();

CREATE TRIGGER invoices_prevent_issued_mutation BEFORE DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.prevent_issued_invoice_mutation();

CREATE TRIGGER invoices_touch_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();

CREATE TRIGGER organization_profiles_touch_updated_at BEFORE UPDATE ON public.organization_profiles FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();

CREATE TRIGGER payment_allocations_validate BEFORE INSERT OR UPDATE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.validate_payment_allocation();

CREATE TRIGGER payments_prevent_void_with_allocations BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.prevent_void_payment_with_allocations();

CREATE TRIGGER payments_touch_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();


  create policy "authenticated users can delete vendor documents"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'vendor-documents'::text));



  create policy "authenticated users can read vendor documents"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'vendor-documents'::text));



  create policy "authenticated users can update vendor documents"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'vendor-documents'::text))
with check ((bucket_id = 'vendor-documents'::text));



  create policy "authenticated users can upload vendor documents"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'vendor-documents'::text));



  create policy "vendor documents delete"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'Dikho'::text));



  create policy "vendor documents read"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'Dikho'::text));



  create policy "vendor documents update"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'Dikho'::text))
with check ((bucket_id = 'Dikho'::text));



  create policy "vendor documents upload"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'Dikho'::text));



