ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'delivery';--> statement-breakpoint
CREATE TABLE "quotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"gst_registration_id" uuid,
	"supply_type" text DEFAULT 'regular' NOT NULL,
	"place_of_supply_state_code" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"remarks" text,
	"taxable_value" numeric(18, 2),
	"igst" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"cess" numeric(18, 2),
	"total_tax" numeric(18, 2),
	"grand_total" numeric(18, 2),
	"quotation_date" date NOT NULL,
	"valid_till" date,
	"customer_ref" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "quotation_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text,
	"hsn_code" text,
	"qty" numeric(24, 6) NOT NULL,
	"rate" numeric(24, 6) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"taxable_value" numeric(18, 2),
	"igst" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"cess" numeric(18, 2),
	"quotation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"gst_registration_id" uuid,
	"supply_type" text DEFAULT 'regular' NOT NULL,
	"place_of_supply_state_code" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"remarks" text,
	"taxable_value" numeric(18, 2),
	"igst" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"cess" numeric(18, 2),
	"total_tax" numeric(18, 2),
	"grand_total" numeric(18, 2),
	"invoice_date" date NOT NULL,
	"due_date" date,
	"sales_order_id" uuid,
	"customer_po_no" text,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"customer_name" text,
	"customer_gstin" text,
	"billing_address" jsonb,
	"shipping_address" jsonb,
	"lut_arn" text,
	"shipping_bill_no" text,
	"shipping_bill_date" date,
	"port_code" text,
	"stock_entry_id" uuid,
	"credit_override" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text,
	"hsn_code" text,
	"qty" numeric(24, 6) NOT NULL,
	"rate" numeric(24, 6) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"taxable_value" numeric(18, 2),
	"igst" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"cess" numeric(18, 2),
	"invoice_id" uuid NOT NULL,
	"so_line_id" uuid,
	"warehouse_id" uuid,
	"batch_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"gst_registration_id" uuid,
	"supply_type" text DEFAULT 'regular' NOT NULL,
	"place_of_supply_state_code" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"remarks" text,
	"taxable_value" numeric(18, 2),
	"igst" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"cess" numeric(18, 2),
	"total_tax" numeric(18, 2),
	"grand_total" numeric(18, 2),
	"order_date" date NOT NULL,
	"delivery_date" date,
	"quotation_id" uuid,
	"customer_po_no" text,
	"customer_po_date" date,
	"payment_terms_days" integer,
	"closed_at" timestamp with time zone,
	"credit_override" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "sales_order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text,
	"hsn_code" text,
	"qty" numeric(24, 6) NOT NULL,
	"rate" numeric(24, 6) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"taxable_value" numeric(18, 2),
	"igst" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"cess" numeric(18, 2),
	"so_id" uuid NOT NULL,
	"invoiced_qty" numeric(24, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gst_registration" ADD COLUMN "lut_arn" text;--> statement-breakpoint
ALTER TABLE "gst_registration" ADD COLUMN "lut_valid_from" date;--> statement-breakpoint
ALTER TABLE "gst_registration" ADD COLUMN "lut_valid_to" date;--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "credit_limit" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_gst_registration_id_gst_registration_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_quotation_id_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_gst_registration_id_gst_registration_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_sales_order_id_sales_order_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_so_line_id_sales_order_line_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_gst_registration_id_gst_registration_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_quotation_id_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_so_id_sales_order_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_entity_number_uq" ON "quotation" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "quotation_customer_idx" ON "quotation" USING btree ("entity_id","customer_id");--> statement-breakpoint
CREATE INDEX "quotation_line_q_idx" ON "quotation_line" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_gstin_number_uq" ON "sales_invoice" USING btree ("gst_registration_id","number");--> statement-breakpoint
CREATE INDEX "sales_invoice_customer_idx" ON "sales_invoice" USING btree ("entity_id","customer_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_line_inv_idx" ON "sales_invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_entity_number_uq" ON "sales_order" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "sales_order_customer_idx" ON "sales_order" USING btree ("entity_id","customer_id");--> statement-breakpoint
CREATE INDEX "sales_order_line_so_idx" ON "sales_order_line" USING btree ("so_id");