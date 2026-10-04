CREATE TYPE "public"."inspection_result" AS ENUM('accepted', 'rejected', 'partial');--> statement-breakpoint
CREATE TABLE "purchase_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"gst_registration_id" uuid,
	"purchase_order_id" uuid,
	"supplier_invoice_no" text NOT NULL,
	"supplier_invoice_date" date NOT NULL,
	"posting_date" date NOT NULL,
	"place_of_supply_state_code" text,
	"supply_type" text DEFAULT 'regular' NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"itc_eligible" boolean DEFAULT true NOT NULL,
	"due_date" date,
	"msme_category" text,
	"taxable_value" numeric(18, 2),
	"igst" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"cess" numeric(18, 2),
	"total_tax" numeric(18, 2),
	"grand_total" numeric(18, 2),
	"remarks" text,
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
CREATE TABLE "purchase_invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"po_line_id" uuid,
	"hsn_code" text,
	"qty" numeric(24, 6) NOT NULL,
	"rate" numeric(24, 6) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"taxable_value" numeric(18, 2),
	"igst" numeric(18, 2),
	"cgst" numeric(18, 2),
	"sgst" numeric(18, 2),
	"cess" numeric(18, 2)
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"closed_at" timestamp with time zone,
	"supplier_id" uuid NOT NULL,
	"gst_registration_id" uuid,
	"order_date" date NOT NULL,
	"expected_date" date,
	"supplier_quote_ref" text,
	"payment_terms_days" integer,
	"remarks" text,
	"taxable_value" numeric(18, 2),
	"total_tax" numeric(18, 2),
	"grand_total" numeric(18, 2),
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
CREATE TABLE "purchase_order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text,
	"qty" numeric(24, 6) NOT NULL,
	"rate" numeric(24, 6) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"taxable_value" numeric(18, 2),
	"received_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"billed_qty" numeric(24, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_inspection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"owner_party_id" uuid,
	"from_warehouse_id" uuid NOT NULL,
	"accept_warehouse_id" uuid,
	"reject_warehouse_id" uuid,
	"qty_inspected" numeric(24, 6) NOT NULL,
	"qty_accepted" numeric(24, 6) DEFAULT '0' NOT NULL,
	"qty_rejected" numeric(24, 6) DEFAULT '0' NOT NULL,
	"result" "inspection_result",
	"checks" text,
	"remarks" text,
	"transfer_entry_id" uuid,
	"inspection_date" date NOT NULL,
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
ALTER TABLE "stock_entry" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_entry" ADD COLUMN "system_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD COLUMN "po_line_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_gst_registration_id_gst_registration_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_invoice_id_purchase_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_po_line_id_purchase_order_line_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_gst_registration_id_gst_registration_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_po_id_purchase_order_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_receipt_line_id_stock_entry_line_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."stock_entry_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_owner_party_id_party_id_fk" FOREIGN KEY ("owner_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_accept_warehouse_id_warehouse_id_fk" FOREIGN KEY ("accept_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_reject_warehouse_id_warehouse_id_fk" FOREIGN KEY ("reject_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_transfer_entry_id_stock_entry_id_fk" FOREIGN KEY ("transfer_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_entity_number_uq" ON "purchase_invoice" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "purchase_invoice_supplier_idx" ON "purchase_invoice" USING btree ("entity_id","supplier_id","supplier_invoice_no");--> statement-breakpoint
CREATE INDEX "purchase_invoice_line_invoice_idx" ON "purchase_invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_entity_number_uq" ON "purchase_order" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "purchase_order_supplier_idx" ON "purchase_order" USING btree ("entity_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_order_line_po_idx" ON "purchase_order_line" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_inspection_entity_number_uq" ON "quality_inspection" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "quality_inspection_receipt_line_idx" ON "quality_inspection" USING btree ("receipt_line_id");