


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."finance_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."finance_touch_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_profile_id" "uuid" NOT NULL,
    "sales_order_id" bigint,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "invoice_number" "text",
    "invoice_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date",
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "place_of_supply" "text" NOT NULL,
    "buyer_name" "text" NOT NULL,
    "buyer_gstin" "text",
    "buyer_pan" "text",
    "buyer_contact_name" "text",
    "buyer_email" "text",
    "buyer_phone" "text",
    "buyer_address_line1" "text" NOT NULL,
    "buyer_address_line2" "text",
    "buyer_city" "text" NOT NULL,
    "buyer_state" "text" NOT NULL,
    "buyer_state_code" "text" NOT NULL,
    "buyer_country" "text" DEFAULT 'India'::"text" NOT NULL,
    "buyer_pincode" "text" NOT NULL,
    "seller_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "grand_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "terms" "text",
    "issued_at" timestamp with time zone,
    "issued_by" "uuid",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "cancellation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoices_check" CHECK (("grand_total" = ("subtotal" + "tax_total"))),
    CONSTRAINT "invoices_check1" CHECK ((("status" = 'issued'::"text") = ("invoice_number" IS NOT NULL))),
    CONSTRAINT "invoices_check2" CHECK ((("due_date" IS NULL) OR ("due_date" >= "invoice_date"))),
    CONSTRAINT "invoices_currency_check" CHECK (("currency" = 'INR'::"text")),
    CONSTRAINT "invoices_grand_total_check" CHECK (("grand_total" >= (0)::numeric)),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "invoices_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "invoices_tax_total_check" CHECK (("tax_total" >= (0)::numeric))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") RETURNS "public"."invoices"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_issued_invoice_line_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."prevent_issued_invoice_line_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_issued_invoice_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'issued' THEN
    RAISE EXCEPTION 'Issued invoices cannot be deleted. Create a credit note instead.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'issued' THEN
    RAISE EXCEPTION 'Issued invoices cannot be edited. Create a credit note instead.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."prevent_issued_invoice_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_void_payment_with_allocations"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.status = 'void' AND OLD.status <> 'void'
    AND EXISTS (SELECT 1 FROM public.payment_allocations WHERE payment_id = NEW.id) THEN
    RAISE EXCEPTION 'Remove payment allocations before voiding this receipt.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_void_payment_with_allocations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
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
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_payment_allocation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."validate_payment_allocation"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalogue_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "catalogue_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "s3_key" "text" NOT NULL,
    "file_size" bigint,
    "type" "text" DEFAULT 'file'::"text",
    "active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."catalogue_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalogue_leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "catalogue_id" "uuid",
    "name" "text" NOT NULL,
    "company_name" "text",
    "email" "text",
    "mobile" "text",
    "city" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."catalogue_leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalogues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "cover_image" "text",
    "active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."catalogues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" bigint NOT NULL,
    "type" "text",
    "company_name" "text",
    "country_dialcode" bigint,
    "contact" numeric,
    "email" "text",
    "alias" "text",
    "gstin" "text",
    "gstin_date" "date",
    "registration" "text",
    "pan_number" "text",
    "status" bigint,
    "tds_percentage" "text",
    "tds_section" "text",
    "contact_person" "text",
    "designation" "text",
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "pincode" "text",
    "country" "text" DEFAULT 'India'::"text"
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


ALTER TABLE "public"."clients" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."clients_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."document_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "document_events_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['invoice'::"text", 'payment'::"text"])))
);


ALTER TABLE "public"."document_events" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."invoice_balances" AS
SELECT
    NULL::"uuid" AS "invoice_id",
    NULL::"uuid" AS "organization_profile_id",
    NULL::"text" AS "status",
    NULL::"text" AS "invoice_number",
    NULL::"date" AS "invoice_date",
    NULL::"date" AS "due_date",
    NULL::"text" AS "buyer_name",
    NULL::numeric(14,2) AS "grand_total",
    NULL::numeric(14,2) AS "paid_amount",
    NULL::numeric(14,2) AS "outstanding_amount";


ALTER VIEW "public"."invoice_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_lines" (
    "id" bigint NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "source_sales_order_item_id" bigint,
    "line_number" integer NOT NULL,
    "description" "text" NOT NULL,
    "hsn_sac" "text",
    "quantity" numeric(14,3) DEFAULT 1 NOT NULL,
    "unit" "text" DEFAULT 'NOS'::"text" NOT NULL,
    "unit_price" numeric(14,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "taxable_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "gst_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "gst_type" "text",
    "cgst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "sgst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "igst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "utgst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoice_lines_cgst_amount_check" CHECK (("cgst_amount" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_check" CHECK (("tax_amount" = ((("cgst_amount" + "sgst_amount") + "igst_amount") + "utgst_amount"))),
    CONSTRAINT "invoice_lines_check1" CHECK (("total_amount" = ("taxable_amount" + "tax_amount"))),
    CONSTRAINT "invoice_lines_check2" CHECK (("discount_amount" <= ("quantity" * "unit_price"))),
    CONSTRAINT "invoice_lines_check3" CHECK (("taxable_amount" = "round"((("quantity" * "unit_price") - "discount_amount"), 2))),
    CONSTRAINT "invoice_lines_discount_amount_check" CHECK (("discount_amount" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_gst_rate_check" CHECK (("gst_rate" = ANY (ARRAY[(0)::numeric, (5)::numeric, (12)::numeric, (18)::numeric, (28)::numeric]))),
    CONSTRAINT "invoice_lines_gst_type_check" CHECK (("gst_type" = ANY (ARRAY['Intra-State'::"text", 'Inter-State'::"text", 'Union Territory'::"text"]))),
    CONSTRAINT "invoice_lines_igst_amount_check" CHECK (("igst_amount" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_line_number_check" CHECK (("line_number" > 0)),
    CONSTRAINT "invoice_lines_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "invoice_lines_sgst_amount_check" CHECK (("sgst_amount" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_tax_amount_check" CHECK (("tax_amount" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_taxable_amount_check" CHECK (("taxable_amount" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_total_amount_check" CHECK (("total_amount" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_unit_price_check" CHECK (("unit_price" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_utgst_amount_check" CHECK (("utgst_amount" >= (0)::numeric))
);


ALTER TABLE "public"."invoice_lines" OWNER TO "postgres";


ALTER TABLE "public"."invoice_lines" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."invoice_lines_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."invoice_sequences" (
    "organization_profile_id" "uuid" NOT NULL,
    "invoice_month" "date" NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "invoice_sequences_invoice_month_check" CHECK (("invoice_month" = ("date_trunc"('month'::"text", ("invoice_month")::timestamp with time zone))::"date")),
    CONSTRAINT "invoice_sequences_last_number_check" CHECK (("last_number" >= 0))
);


ALTER TABLE "public"."invoice_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."login_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "is_new" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."login_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."media" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."media" OWNER TO "postgres";


ALTER TABLE "public"."media" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."media_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."organization_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_code" "text" NOT NULL,
    "legal_name" "text" NOT NULL,
    "gstin" "text",
    "pan" "text",
    "address_line1" "text" NOT NULL,
    "address_line2" "text",
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "state_code" "text" NOT NULL,
    "country" "text" DEFAULT 'India'::"text" NOT NULL,
    "pincode" "text" NOT NULL,
    "bank_name" "text",
    "bank_account_name" "text",
    "bank_account_number" "text",
    "bank_ifsc" "text",
    "bank_branch" "text",
    "invoice_prefix" "text" DEFAULT 'DGM'::"text" NOT NULL,
    "invoice_terms_days" integer DEFAULT 30 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_profiles_invoice_terms_days_check" CHECK (("invoice_terms_days" >= 0))
);


ALTER TABLE "public"."organization_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "payment_allocations_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."payment_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_profile_id" "uuid" NOT NULL,
    "receipt_number" "text",
    "status" "text" DEFAULT 'recorded'::"text" NOT NULL,
    "payment_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "payer_name" "text" NOT NULL,
    "payer_gstin" "text",
    "amount" numeric(14,2) NOT NULL,
    "payment_method" "text" NOT NULL,
    "reference_number" "text",
    "bank_name" "text",
    "notes" "text",
    "voided_at" timestamp with time zone,
    "voided_by" "uuid",
    "void_reason" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "payments_check" CHECK ((("status" = 'void'::"text") = ("voided_at" IS NOT NULL))),
    CONSTRAINT "payments_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['bank_transfer'::"text", 'cash'::"text", 'cheque'::"text", 'upi'::"text", 'other'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['recorded'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salesorder" (
    "id" bigint NOT NULL,
    "order_number" "text" NOT NULL,
    "unique_id" "text",
    "crm_reference_id" "text",
    "company" "text" NOT NULL,
    "order_client_fullname" "text",
    "order_type" "text",
    "brand_name" "text",
    "multi_purpose_so" boolean DEFAULT false NOT NULL,
    "order_date" "date",
    "invoice_date" "date",
    "campaign_start_date" "date",
    "campaign_end_date" "date",
    "sub_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "payment_receipt_amount" numeric(14,2),
    "order_status" "text",
    "purchase_status" "text",
    "order_color" "text",
    "approved_by" "text",
    "approved_date" "date",
    "complete_date" "date",
    "invoice_courier" "text",
    "created_by" "text",
    "created_by_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vendor_address_id" bigint
);


ALTER TABLE "public"."salesorder" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salesorderdocument" (
    "id" bigint NOT NULL,
    "sales_order_id" bigint NOT NULL,
    "type" "text",
    "name" "text" NOT NULL,
    "short_name" "text",
    "label" "text",
    "reference_type" "text",
    "date" "date",
    "invoice_number" "text",
    "is_taxable" boolean DEFAULT true NOT NULL,
    "gst_type" "text",
    "taxable_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "cgst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "sgst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "igst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "utgst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "after_tax_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "document_color" "text",
    "document_note" "text",
    "self_audit_completed" boolean DEFAULT false NOT NULL,
    "file_url" "text",
    "document_courier" "text",
    "courier_status" "text",
    "purchase_order_id" bigint,
    "inv_id" bigint,
    "inv_number" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "so_item_id" bigint
);


ALTER TABLE "public"."salesorderdocument" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."purchaseorderdocuments" WITH ("security_invoker"='on') AS
 SELECT "po_item"."id",
    "po_item"."purchase_order_id",
    "po_item"."type",
    "po_item"."name",
    "po_item"."short_name",
    "po_item"."date",
    "po_item"."label",
    "po_item"."invoice_number",
    "po_item"."is_taxable",
    "po_item"."gst_type",
    "po_item"."taxable_amount",
    "po_item"."utgst_amount",
    "po_item"."igst_amount",
    "po_item"."sgst_amount",
    "po_item"."cgst_amount",
    "po_item"."tax_amount",
    "po_item"."after_tax_amount",
    "po_item"."document_color",
    "po_item"."document_note",
    "po_item"."self_audit_completed",
    "po_item"."courier_status" AS "document_status",
    "po_item"."created_at",
    "po_item"."updated_at",
    "po_item"."file_url",
    "po_item"."taxable_amount" AS "po_before_tax",
    "so_item"."taxable_amount" AS "so_item_before_tax",
    ("so_item"."taxable_amount" - "po_item"."taxable_amount") AS "profit",
    "so"."brand_name"
   FROM (("public"."salesorderdocument" "po_item"
     LEFT JOIN "public"."salesorderdocument" "so_item" ON (("so_item"."id" = "po_item"."so_item_id")))
     LEFT JOIN "public"."salesorder" "so" ON (("so"."id" = "so_item"."sales_order_id")))
  WHERE ("po_item"."purchase_order_id" IS NOT NULL);


ALTER VIEW "public"."purchaseorderdocuments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchaseorders" (
    "id" "text" NOT NULL,
    "crm_reference_id" "text",
    "company" "text",
    "order_type" "text",
    "unique_id" "text",
    "order_number" "text",
    "order_date" "text",
    "sub_total" "text",
    "tax_total" "text",
    "total" "text",
    "order_sales_number" "text",
    "campaign_start_date" "text",
    "campaign_end_date" "text",
    "order_vendor_fullname" "text",
    "created_by" "text",
    "approved_date" "text",
    "approved_by" "text",
    "order_status" "text",
    "complete_date" "text",
    "order_color" "text",
    "payment_request_amount" "text",
    "id_1" "text",
    "city" "text",
    "type" "text",
    "alias" "text",
    "email" "text",
    "gstin" "text",
    "state" "text",
    "address" "text",
    "contact" "text",
    "country" "text",
    "zipcode" "text",
    "telephone" "text",
    "address_id" "text",
    "created_by_1" "text",
    "gstin_date" "text",
    "pan_number" "text",
    "updated_by" "text",
    "tds_section" "text",
    "vendor_type" "text",
    "activated_at" "text",
    "activated_by" "text",
    "company_name" "text",
    "country_code" "text",
    "creator_name" "text",
    "registration" "text",
    "updater_name" "text",
    "date_of_birth" "text",
    "activator_name" "text",
    "contact_person" "text",
    "tds_percentage" "text",
    "opening_balance" "text",
    "country_dialcode" "text",
    "vendor_bank_name" "text",
    "vendor_ifsc_code" "text",
    "payment_term_type" "text",
    "payment_term_value" "text",
    "document_deleted_at" "text",
    "document_deleted_by" "text",
    "created_at_formatted" "text",
    "updated_at_formatted" "text",
    "date_of_incorporation" "text",
    "document_deletor_name" "text",
    "vendor_account_number" "text",
    "activated_at_formatted" "text",
    "vendor_document_file_name" "text",
    "vendor_document_file_path" "text",
    "date_of_marriage_anniversary" "text",
    "document_deleted_at_formatted" "text",
    "vendor_confirm_account_number" "text",
    "status" "text",
    "created_at" "text",
    "ledger_add" "text",
    "updated_at" "text",
    "so_item_before_tax" "text",
    "po_before_tax" "text",
    "profit" "text",
    "brand_name" "text",
    "id_2" "text",
    "purchase_order_id" "text",
    "type_1" "text",
    "name" "text",
    "short_name" "text",
    "date" "text",
    "label" "text",
    "invoice_number" "text",
    "is_taxable" "text",
    "gst_type" "text",
    "taxable_amount" "text",
    "utgst_amount" "text",
    "igst_amount" "text",
    "sgst_amount" "text",
    "cgst_amount" "text",
    "tax_amount" "text",
    "after_tax_amount" "text",
    "document_color" "text",
    "document_note" "text",
    "self_audit_completed" "text",
    "document_status" "text",
    "created_at_1" "text",
    "updated_at_1" "text",
    "file_url" "text"
);


ALTER TABLE "public"."purchaseorders" OWNER TO "postgres";


ALTER TABLE "public"."salesorder" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."salesorder_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."salesorderdocument" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."salesorderdocument_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."salesorders" (
    "id" bigint NOT NULL,
    "crm_reference_id" "text",
    "company" "text",
    "order_type" "text",
    "unique_id" "text",
    "order_number" "text",
    "order_date" timestamp with time zone,
    "invoice_date" "text",
    "sub_total" "text",
    "tax_total" double precision,
    "total" "text",
    "campaign_start_date" timestamp with time zone,
    "campaign_end_date" "text",
    "order_client_fullname" "text",
    "created_by" "text",
    "created_by_id" "text",
    "approved_date" "text",
    "approved_by" "text",
    "order_status" "text",
    "purchase_status" "text",
    "complete_date" "text",
    "order_color" "text",
    "created_at" timestamp with time zone,
    "updated_at" "text",
    "multi_purpose_so" "text",
    "brand_name" "text",
    "invoice_courier" "text",
    "id_1" "text",
    "sales_order_id" "text",
    "type" "text",
    "name" "text",
    "short_name" "text",
    "date" "text",
    "label" "text",
    "invoice_number" "text",
    "is_taxable" "text",
    "gst_type" "text",
    "taxable_amount" "text",
    "utgst_amount" "text",
    "igst_amount" "text",
    "sgst_amount" "text",
    "cgst_amount" "text",
    "tax_amount" "text",
    "after_tax_amount" "text",
    "document_color" "text",
    "document_note" "text",
    "self_audit_completed" "text",
    "reference_type" "text",
    "purchase_order_id" "text",
    "created_at_1" "text",
    "updated_at_1" "text",
    "file_url" "text",
    "document_courier" "text",
    "courier_status" "text"
);


ALTER TABLE "public"."salesorders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sub_media" (
    "id" bigint NOT NULL,
    "media_id" bigint NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."sub_media" OWNER TO "postgres";


ALTER TABLE "public"."sub_media" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sub_media_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "label" "text",
    "first_seen" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_addresses" (
    "id" bigint NOT NULL,
    "vendor_id" bigint NOT NULL,
    "address" "text" NOT NULL,
    "country" "text" DEFAULT 'India'::"text",
    "country_code" "text" DEFAULT 'IN'::"text",
    "state" "text" NOT NULL,
    "city" "text",
    "zipcode" "text",
    "is_default" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_addresses" OWNER TO "postgres";


ALTER TABLE "public"."vendor_addresses" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."vendor_addresses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."vendor_media" (
    "id" bigint NOT NULL,
    "vendor_id" bigint NOT NULL,
    "media_id" bigint NOT NULL,
    "sub_media_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_media" OWNER TO "postgres";


ALTER TABLE "public"."vendor_media" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."vendor_media_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" bigint NOT NULL,
    "type" "text",
    "company_name" "text",
    "country_dialcode" bigint,
    "contact" "text",
    "email" "text",
    "alias" "text",
    "telephone" "text",
    "gstin" "text",
    "gstin_date" "text",
    "registration" "text",
    "pan_number" "text",
    "opening_balance" numeric,
    "vendor_bank_name" "text",
    "vendor_account_number" "text",
    "vendor_confirm_account_number" "text",
    "vendor_ifsc_code" "text",
    "payment_term_type" "text",
    "payment_term_value" bigint,
    "vendor_type" "text",
    "date_of_incorporation" "text",
    "date_of_birth" "text",
    "date_of_marriage_anniversary" "text",
    "status" bigint,
    "tds_percentage" "text",
    "tds_section" "text",
    "ledger_add" "text",
    "vendor_document_file_path" "text",
    "vendor_document_file_name" "text",
    "created_by" "text",
    "updated_by" "text",
    "activated_by" "text",
    "document_deleted_by" "text",
    "document_deleted_at" "text",
    "activated_at" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "file_url" "text",
    "created_at_formatted" "text",
    "updated_at_formatted" "text",
    "activated_at_formatted" "text",
    "document_deleted_at_formatted" "text",
    "creator_name" "text",
    "updater_name" "text",
    "activator_name" "text",
    "document_deletor_name" "text",
    "media_id" bigint,
    "sub_media_id" bigint,
    "contact_person" "text",
    "country_code" "text" DEFAULT 'IN'::"text",
    "payment_term_invoice_date" "date"
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vendors_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendors_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."vendors_id_seq" OWNED BY "public"."vendors"."id";



ALTER TABLE ONLY "public"."vendors" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vendors_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."catalogue_files"
    ADD CONSTRAINT "catalogue_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalogue_leads"
    ADD CONSTRAINT "catalogue_leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalogues"
    ADD CONSTRAINT "catalogues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalogues"
    ADD CONSTRAINT "catalogues_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_events"
    ADD CONSTRAINT "document_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_invoice_id_line_number_key" UNIQUE ("invoice_id", "line_number");



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("organization_profile_id", "invoice_month");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_events"
    ADD CONSTRAINT "login_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_profiles"
    ADD CONSTRAINT "organization_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_profiles"
    ADD CONSTRAINT "organization_profiles_profile_code_key" UNIQUE ("profile_code");



ALTER TABLE ONLY "public"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_payment_id_invoice_id_key" UNIQUE ("payment_id", "invoice_id");



ALTER TABLE ONLY "public"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchaseorders"
    ADD CONSTRAINT "purchaseorders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salesorder"
    ADD CONSTRAINT "salesorder_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salesorderdocument"
    ADD CONSTRAINT "salesorderdocument_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salesorders"
    ADD CONSTRAINT "salesorders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sub_media"
    ADD CONSTRAINT "sub_media_media_id_name_key" UNIQUE ("media_id", "name");



ALTER TABLE ONLY "public"."sub_media"
    ADD CONSTRAINT "sub_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_unique" UNIQUE ("user_id", "device_id");



ALTER TABLE ONLY "public"."vendor_addresses"
    ADD CONSTRAINT "vendor_addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_media"
    ADD CONSTRAINT "vendor_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_media"
    ADD CONSTRAINT "vendor_media_vendor_id_media_id_sub_media_id_key" UNIQUE ("vendor_id", "media_id", "sub_media_id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



CREATE INDEX "document_events_entity_idx" ON "public"."document_events" USING "btree" ("entity_type", "entity_id", "created_at" DESC);



CREATE INDEX "invoice_lines_invoice_id_idx" ON "public"."invoice_lines" USING "btree" ("invoice_id");



CREATE UNIQUE INDEX "invoices_issued_number_unique" ON "public"."invoices" USING "btree" ("organization_profile_id", "invoice_number") WHERE ("invoice_number" IS NOT NULL);



CREATE INDEX "invoices_sales_order_id_idx" ON "public"."invoices" USING "btree" ("sales_order_id");



CREATE INDEX "invoices_status_due_date_idx" ON "public"."invoices" USING "btree" ("status", "due_date");



CREATE INDEX "payment_allocations_invoice_id_idx" ON "public"."payment_allocations" USING "btree" ("invoice_id");



CREATE INDEX "payments_payment_date_idx" ON "public"."payments" USING "btree" ("payment_date" DESC);



CREATE UNIQUE INDEX "payments_receipt_number_unique" ON "public"."payments" USING "btree" ("organization_profile_id", "receipt_number") WHERE ("receipt_number" IS NOT NULL);



CREATE INDEX "salesorder_created_at_idx" ON "public"."salesorder" USING "btree" ("created_at" DESC);



CREATE INDEX "salesorder_order_number_idx" ON "public"."salesorder" USING "btree" ("order_number");



CREATE INDEX "salesorderdocument_purchase_order_id_idx" ON "public"."salesorderdocument" USING "btree" ("purchase_order_id");



CREATE INDEX "salesorderdocument_sales_order_id_idx" ON "public"."salesorderdocument" USING "btree" ("sales_order_id");



CREATE INDEX "salesorderdocument_so_item_id_idx" ON "public"."salesorderdocument" USING "btree" ("so_item_id");



CREATE OR REPLACE VIEW "public"."invoice_balances" WITH ("security_invoker"='true') AS
 SELECT "invoice"."id" AS "invoice_id",
    "invoice"."organization_profile_id",
    "invoice"."status",
    "invoice"."invoice_number",
    "invoice"."invoice_date",
    "invoice"."due_date",
    "invoice"."buyer_name",
    "invoice"."grand_total",
    (COALESCE("sum"("allocation"."amount"), (0)::numeric))::numeric(14,2) AS "paid_amount",
    (("invoice"."grand_total" - COALESCE("sum"("allocation"."amount"), (0)::numeric)))::numeric(14,2) AS "outstanding_amount"
   FROM ("public"."invoices" "invoice"
     LEFT JOIN "public"."payment_allocations" "allocation" ON (("allocation"."invoice_id" = "invoice"."id")))
  GROUP BY "invoice"."id";



CREATE OR REPLACE TRIGGER "invoice_lines_prevent_issued_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_issued_invoice_line_mutation"();



CREATE OR REPLACE TRIGGER "invoice_lines_touch_updated_at" BEFORE UPDATE ON "public"."invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."finance_touch_updated_at"();



CREATE OR REPLACE TRIGGER "invoices_prevent_issued_mutation" BEFORE DELETE OR UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_issued_invoice_mutation"();



CREATE OR REPLACE TRIGGER "invoices_touch_updated_at" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."finance_touch_updated_at"();



CREATE OR REPLACE TRIGGER "organization_profiles_touch_updated_at" BEFORE UPDATE ON "public"."organization_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."finance_touch_updated_at"();



CREATE OR REPLACE TRIGGER "payment_allocations_validate" BEFORE INSERT OR UPDATE ON "public"."payment_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."validate_payment_allocation"();



CREATE OR REPLACE TRIGGER "payments_prevent_void_with_allocations" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_void_payment_with_allocations"();



CREATE OR REPLACE TRIGGER "payments_touch_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."finance_touch_updated_at"();



ALTER TABLE ONLY "public"."catalogue_files"
    ADD CONSTRAINT "catalogue_files_catalogue_id_fkey" FOREIGN KEY ("catalogue_id") REFERENCES "public"."catalogues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalogue_leads"
    ADD CONSTRAINT "catalogue_leads_catalogue_id_fkey" FOREIGN KEY ("catalogue_id") REFERENCES "public"."catalogues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_events"
    ADD CONSTRAINT "document_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_source_sales_order_item_id_fkey" FOREIGN KEY ("source_sales_order_item_id") REFERENCES "public"."salesorderdocument"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_organization_profile_id_fkey" FOREIGN KEY ("organization_profile_id") REFERENCES "public"."organization_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_organization_profile_id_fkey" FOREIGN KEY ("organization_profile_id") REFERENCES "public"."organization_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "public"."salesorder"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."login_events"
    ADD CONSTRAINT "login_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_organization_profile_id_fkey" FOREIGN KEY ("organization_profile_id") REFERENCES "public"."organization_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."salesorder"
    ADD CONSTRAINT "salesorder_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."salesorder"
    ADD CONSTRAINT "salesorder_vendor_address_id_fkey" FOREIGN KEY ("vendor_address_id") REFERENCES "public"."vendor_addresses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."salesorderdocument"
    ADD CONSTRAINT "salesorderdocument_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "public"."salesorder"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salesorderdocument"
    ADD CONSTRAINT "salesorderdocument_so_item_id_fkey" FOREIGN KEY ("so_item_id") REFERENCES "public"."salesorderdocument"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sub_media"
    ADD CONSTRAINT "sub_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_addresses"
    ADD CONSTRAINT "vendor_addresses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_media"
    ADD CONSTRAINT "vendor_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vendor_media"
    ADD CONSTRAINT "vendor_media_sub_media_id_fkey" FOREIGN KEY ("sub_media_id") REFERENCES "public"."sub_media"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vendor_media"
    ADD CONSTRAINT "vendor_media_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_sub_media_id_fkey" FOREIGN KEY ("sub_media_id") REFERENCES "public"."sub_media"("id");



CREATE POLICY "Anyone can insert leads." ON "public"."catalogue_leads" FOR INSERT WITH CHECK (true);



CREATE POLICY "Authenticated users can delete clients" ON "public"."clients" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can insert clients" ON "public"."clients" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can update clients" ON "public"."clients" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can view clients" ON "public"."clients" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Catalogue files are viewable by everyone." ON "public"."catalogue_files" FOR SELECT USING (("active" = true));



CREATE POLICY "Catalogues are viewable by everyone." ON "public"."catalogues" FOR SELECT USING (("active" = true));



CREATE POLICY "Public can add vendor address" ON "public"."vendor_addresses" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Public can delete pending vendor" ON "public"."vendors" FOR DELETE TO "anon" USING (("status" = 0));



CREATE POLICY "Public can delete vendor address" ON "public"."vendor_addresses" FOR DELETE TO "anon" USING (true);



CREATE POLICY "Public can read media" ON "public"."media" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public can read own pending client" ON "public"."clients" FOR SELECT TO "anon" USING (("status" = 0));



CREATE POLICY "Public can read own pending vendor" ON "public"."vendors" FOR SELECT TO "anon" USING (("status" = 0));



CREATE POLICY "Public can read sub_media" ON "public"."sub_media" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public can register as vendor" ON "public"."vendors" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Public can submit client welcome" ON "public"."clients" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Public can update pending vendor document path" ON "public"."vendors" FOR UPDATE TO "anon" USING (("status" = 0)) WITH CHECK (("status" = 0));



CREATE POLICY "authenticated users can delete vendor addresses" ON "public"."vendor_addresses" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "authenticated users can delete vendors" ON "public"."vendors" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "authenticated users can insert vendor addresses" ON "public"."vendor_addresses" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated users can insert vendors" ON "public"."vendors" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated users can read media" ON "public"."media" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated users can read sub media" ON "public"."sub_media" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated users can read vendor addresses" ON "public"."vendor_addresses" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated users can read vendors" ON "public"."vendors" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated users can update vendor addresses" ON "public"."vendor_addresses" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated users can update vendors" ON "public"."vendors" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."catalogue_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalogue_leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalogues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "finance_authenticated_all" ON "public"."invoice_lines" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "finance_authenticated_all" ON "public"."invoices" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "finance_authenticated_all" ON "public"."payment_allocations" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "finance_authenticated_all" ON "public"."payments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "finance_authenticated_insert" ON "public"."document_events" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "finance_authenticated_read" ON "public"."document_events" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "finance_authenticated_read" ON "public"."invoice_sequences" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "finance_authenticated_read" ON "public"."organization_profiles" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."invoice_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "login_events_owner_select" ON "public"."login_events" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."media" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_allocations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchaseorders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salesorder" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "salesorder_authenticated_all" ON "public"."salesorder" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."salesorderdocument" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "salesorderdocument_authenticated_all" ON "public"."salesorderdocument" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."salesorders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sub_media" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_devices_owner_select" ON "public"."user_devices" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."vendor_addresses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_media" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."clients";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."finance_touch_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."finance_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."finance_touch_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



REVOKE ALL ON FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_issued_invoice_line_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_issued_invoice_line_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_issued_invoice_line_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_issued_invoice_line_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_issued_invoice_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_issued_invoice_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_issued_invoice_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_issued_invoice_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_void_payment_with_allocations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_void_payment_with_allocations"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_void_payment_with_allocations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_void_payment_with_allocations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_payment_allocation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_payment_allocation"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_payment_allocation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_payment_allocation"() TO "service_role";


















GRANT ALL ON TABLE "public"."catalogue_files" TO "anon";
GRANT ALL ON TABLE "public"."catalogue_files" TO "authenticated";
GRANT ALL ON TABLE "public"."catalogue_files" TO "service_role";



GRANT ALL ON TABLE "public"."catalogue_leads" TO "anon";
GRANT ALL ON TABLE "public"."catalogue_leads" TO "authenticated";
GRANT ALL ON TABLE "public"."catalogue_leads" TO "service_role";



GRANT ALL ON TABLE "public"."catalogues" TO "anon";
GRANT ALL ON TABLE "public"."catalogues" TO "authenticated";
GRANT ALL ON TABLE "public"."catalogues" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."document_events" TO "anon";
GRANT ALL ON TABLE "public"."document_events" TO "authenticated";
GRANT ALL ON TABLE "public"."document_events" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_balances" TO "anon";
GRANT ALL ON TABLE "public"."invoice_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_balances" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_lines" TO "anon";
GRANT ALL ON TABLE "public"."invoice_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_lines" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoice_lines_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoice_lines_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoice_lines_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_sequences" TO "anon";
GRANT ALL ON TABLE "public"."invoice_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."login_events" TO "anon";
GRANT ALL ON TABLE "public"."login_events" TO "authenticated";
GRANT ALL ON TABLE "public"."login_events" TO "service_role";



GRANT ALL ON TABLE "public"."media" TO "anon";
GRANT ALL ON TABLE "public"."media" TO "authenticated";
GRANT ALL ON TABLE "public"."media" TO "service_role";



GRANT ALL ON SEQUENCE "public"."media_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."media_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."media_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."organization_profiles" TO "anon";
GRANT ALL ON TABLE "public"."organization_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."payment_allocations" TO "anon";
GRANT ALL ON TABLE "public"."payment_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."salesorder" TO "anon";
GRANT ALL ON TABLE "public"."salesorder" TO "authenticated";
GRANT ALL ON TABLE "public"."salesorder" TO "service_role";



GRANT ALL ON TABLE "public"."salesorderdocument" TO "anon";
GRANT ALL ON TABLE "public"."salesorderdocument" TO "authenticated";
GRANT ALL ON TABLE "public"."salesorderdocument" TO "service_role";



GRANT ALL ON TABLE "public"."purchaseorderdocuments" TO "anon";
GRANT ALL ON TABLE "public"."purchaseorderdocuments" TO "authenticated";
GRANT ALL ON TABLE "public"."purchaseorderdocuments" TO "service_role";



GRANT ALL ON TABLE "public"."purchaseorders" TO "anon";
GRANT ALL ON TABLE "public"."purchaseorders" TO "authenticated";
GRANT ALL ON TABLE "public"."purchaseorders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."salesorder_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."salesorder_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."salesorder_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."salesorderdocument_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."salesorderdocument_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."salesorderdocument_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."salesorders" TO "anon";
GRANT ALL ON TABLE "public"."salesorders" TO "authenticated";
GRANT ALL ON TABLE "public"."salesorders" TO "service_role";



GRANT ALL ON TABLE "public"."sub_media" TO "anon";
GRANT ALL ON TABLE "public"."sub_media" TO "authenticated";
GRANT ALL ON TABLE "public"."sub_media" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sub_media_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sub_media_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sub_media_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_devices" TO "anon";
GRANT ALL ON TABLE "public"."user_devices" TO "authenticated";
GRANT ALL ON TABLE "public"."user_devices" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_addresses" TO "anon";
GRANT ALL ON TABLE "public"."vendor_addresses" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_addresses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_addresses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_addresses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_addresses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_media" TO "anon";
GRANT ALL ON TABLE "public"."vendor_media" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_media" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_media_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_media_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_media_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































