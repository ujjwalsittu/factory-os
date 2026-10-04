CREATE TYPE "public"."gst_treatment" AS ENUM('registered', 'unregistered', 'composition', 'sez', 'overseas', 'deemed_export');--> statement-breakpoint
CREATE TYPE "public"."hsn_kind" AS ENUM('hsn', 'sac');--> statement-breakpoint
CREATE TYPE "public"."item_tracking" AS ENUM('none', 'batch', 'serial');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('raw_material', 'powder', 'component', 'consumable', 'sub_assembly', 'finished_good', 'kit', 'tool', 'gauge', 'service', 'scrap');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('draft', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_entry_purpose" AS ENUM('receipt', 'issue', 'transfer', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."warehouse_type" AS ENUM('stores', 'quarantine', 'mrb', 'wip', 'dry_cabinet', 'cleanroom', 'finished_goods', 'scrap', 'customer_owned', 'at_job_worker', 'transit');--> statement-breakpoint
CREATE TABLE "hsn_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "hsn_kind" NOT NULL,
	"description" text NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "item_type" NOT NULL,
	"tracking" "item_tracking" DEFAULT 'none' NOT NULL,
	"is_stock_item" boolean DEFAULT true NOT NULL,
	"stock_uom_id" uuid NOT NULL,
	"hsn_code" text,
	"revision" text,
	"drawing_no" text,
	"shelf_life_days" integer,
	"msl_level" text,
	"requires_incoming_inspection" boolean DEFAULT false NOT NULL,
	"export_controlled" boolean DEFAULT false NOT NULL,
	"reorder_level" numeric(24, 6),
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"gst_treatment" "gst_treatment" DEFAULT 'registered' NOT NULL,
	"gstin" text,
	"pan" text,
	"state_code" text,
	"msme_udyam" text,
	"msme_category" text,
	"credit_days" integer,
	"email" text,
	"phone" text,
	"addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"decimals" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"heat_no" text,
	"supplier_batch_no" text,
	"supplier_id" uuid,
	"mfg_date" date,
	"expiry_date" date,
	"parent_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fifo_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sle_seq" bigint NOT NULL,
	"layer_id" uuid NOT NULL,
	"qty" numeric(24, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fifo_layer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty_in" numeric(24, 6) NOT NULL,
	"qty_remaining" numeric(24, 6) NOT NULL,
	"rate" numeric(24, 6) NOT NULL,
	"source_seq" bigint NOT NULL,
	"posting_date" date NOT NULL,
	"voucher_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"fy" text NOT NULL,
	"pattern" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_bin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_bin_uq" UNIQUE NULLS NOT DISTINCT("entity_id","item_id","warehouse_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "stock_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"purpose" "stock_entry_purpose" NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"posting_date" date NOT NULL,
	"party_id" uuid,
	"reference" text,
	"remarks" text,
	"created_by" text NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_entry_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"from_warehouse_id" uuid,
	"to_warehouse_id" uuid,
	"batch_id" uuid,
	"new_batch_no" text,
	"heat_no" text,
	"expiry_date" date,
	"rate" numeric(24, 6),
	"value" numeric(24, 6),
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "stock_ledger_entry" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(24, 6) NOT NULL,
	"rate" numeric(24, 6) NOT NULL,
	"value" numeric(24, 6) NOT NULL,
	"posting_date" date NOT NULL,
	"voucher_type" text NOT NULL,
	"voucher_id" uuid NOT NULL,
	"voucher_line_id" uuid,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"plant_id" uuid,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "warehouse_type" NOT NULL,
	"available_for_issue" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hsn_code" ADD CONSTRAINT "hsn_code_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_stock_uom_id_uom_id_fk" FOREIGN KEY ("stock_uom_id") REFERENCES "public"."uom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party" ADD CONSTRAINT "party_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom" ADD CONSTRAINT "uom_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fifo_consumption" ADD CONSTRAINT "fifo_consumption_layer_id_fifo_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."fifo_layer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_entry_id_stock_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_to_warehouse_id_warehouse_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_plant_id_plant_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hsn_tenant_code_from_uq" ON "hsn_code" USING btree ("tenant_id","code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "item_tenant_code_uq" ON "item" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "item_tenant_type_idx" ON "item" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "party_tenant_code_uq" ON "party" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "party_tenant_gstin_idx" ON "party" USING btree ("tenant_id","gstin");--> statement-breakpoint
CREATE UNIQUE INDEX "uom_tenant_code_uq" ON "uom" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_item_no_uq" ON "batch" USING btree ("item_id","batch_no");--> statement-breakpoint
CREATE INDEX "batch_tenant_heat_idx" ON "batch" USING btree ("tenant_id","heat_no");--> statement-breakpoint
CREATE INDEX "fifo_consumption_sle_idx" ON "fifo_consumption" USING btree ("sle_seq");--> statement-breakpoint
CREATE INDEX "fifo_layer_open_idx" ON "fifo_layer" USING btree ("entity_id","item_id","batch_id","posting_date","source_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "number_series_uq" ON "number_series" USING btree ("entity_id","doc_type","fy");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_entry_entity_number_uq" ON "stock_entry" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "stock_entry_entity_date_idx" ON "stock_entry" USING btree ("entity_id","posting_date");--> statement-breakpoint
CREATE INDEX "stock_entry_line_entry_idx" ON "stock_entry_line" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "sle_item_idx" ON "stock_ledger_entry" USING btree ("entity_id","item_id","seq");--> statement-breakpoint
CREATE INDEX "sle_voucher_idx" ON "stock_ledger_entry" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "sle_batch_idx" ON "stock_ledger_entry" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_entity_code_uq" ON "warehouse" USING btree ("entity_id","code");