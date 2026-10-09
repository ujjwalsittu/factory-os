CREATE TYPE "public"."itc04_frequency" AS ENUM('half_yearly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."job_work_goods_type" AS ENUM('input', 'capital_good');--> statement-breakpoint
CREATE TYPE "public"."job_work_kind" AS ENUM('operation', 'conversion');--> statement-breakpoint
CREATE TYPE "public"."job_work_status" AS ENUM('draft', 'open', 'closed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'job_work_out';--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'job_work_in';--> statement-breakpoint
ALTER TYPE "public"."work_order_cost_kind" ADD VALUE 'job_work';--> statement-breakpoint
CREATE TABLE "itc04_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"frequency" "itc04_frequency" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_work_challan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"posting_date" date NOT NULL,
	"gst_registration_id" uuid,
	"from_warehouse_id" uuid,
	"stock_entry_id" uuid,
	"interstate" boolean DEFAULT false NOT NULL,
	"place_of_supply_state_code" text,
	"eway_bill_no" text,
	"vehicle_no" text,
	"remarks" text,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_work_challan_number_len_ck" CHECK ("job_work_challan"."number" is null or length("job_work_challan"."number") <= 16)
);
--> statement-breakpoint
CREATE TABLE "job_work_challan_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challan_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(24, 6) NOT NULL,
	"value" numeric(24, 6) NOT NULL,
	"goods_type" "job_work_goods_type" NOT NULL,
	"hsn_code" text,
	"due_by" date,
	"extended_due_by" date,
	"extension_ref" text,
	"deemed_supply_invoice_no" text,
	"deemed_supply_marked_by" text,
	"deemed_supply_marked_at" timestamp with time zone,
	CONSTRAINT "job_work_challan_line_qty_ck" CHECK ("job_work_challan_line"."qty" > 0 and "job_work_challan_line"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_work_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"challan_line_id" uuid NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"loss_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"scrap_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_work_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"kind" "job_work_kind" NOT NULL,
	"status" "job_work_status" DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"work_order_id" uuid,
	"work_order_operation_id" uuid,
	"target_item_id" uuid,
	"target_qty" numeric(24, 6),
	"target_warehouse_id" uuid,
	"nature_of_work" text,
	"expected_return_date" date,
	"remarks" text,
	"close_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_work_order_kind_ck" CHECK (("job_work_order"."kind" = 'operation' and "job_work_order"."work_order_id" is not null and "job_work_order"."work_order_operation_id" is not null) or ("job_work_order"."kind" = 'conversion' and "job_work_order"."target_item_id" is not null and "job_work_order"."target_qty" > 0))
);
--> statement-breakpoint
CREATE TABLE "job_work_order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	CONSTRAINT "job_work_order_line_qty_ck" CHECK ("job_work_order_line"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "job_work_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'submitted' NOT NULL,
	"posting_date" date NOT NULL,
	"job_worker_challan_no" text,
	"job_worker_challan_date" date,
	"stock_entry_id" uuid,
	"remarks" text,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_work_receipt_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(24, 6) NOT NULL,
	"rejected_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"value" numeric(24, 6) DEFAULT '0' NOT NULL,
	"warehouse_id" uuid,
	"stock_entry_line_id" uuid,
	CONSTRAINT "job_work_receipt_line_qty_ck" CHECK ("job_work_receipt_line"."qty" >= 0 and "job_work_receipt_line"."rejected_qty" >= 0 and "job_work_receipt_line"."qty" + "job_work_receipt_line"."rejected_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "bom_operation" ALTER COLUMN "work_centre_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_operation" ALTER COLUMN "work_centre_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "job_work_exempt_tool" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "is_job_worker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD COLUMN "job_work_receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "bom_operation" ADD COLUMN "outsourced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_operation" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_cost" ADD COLUMN "purchase_invoice_line_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_operation" ADD COLUMN "outsourced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_operation" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "itc04_setting" ADD CONSTRAINT "itc04_setting_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itc04_setting" ADD CONSTRAINT "itc04_setting_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itc04_setting" ADD CONSTRAINT "itc04_setting_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan" ADD CONSTRAINT "job_work_challan_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan" ADD CONSTRAINT "job_work_challan_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan" ADD CONSTRAINT "job_work_challan_order_id_job_work_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."job_work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan" ADD CONSTRAINT "job_work_challan_gst_registration_id_gst_registration_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan" ADD CONSTRAINT "job_work_challan_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan" ADD CONSTRAINT "job_work_challan_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan" ADD CONSTRAINT "job_work_challan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan_line" ADD CONSTRAINT "job_work_challan_line_challan_id_job_work_challan_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."job_work_challan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan_line" ADD CONSTRAINT "job_work_challan_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan_line" ADD CONSTRAINT "job_work_challan_line_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_challan_line" ADD CONSTRAINT "job_work_challan_line_deemed_supply_marked_by_user_id_fk" FOREIGN KEY ("deemed_supply_marked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_consumption" ADD CONSTRAINT "job_work_consumption_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_consumption" ADD CONSTRAINT "job_work_consumption_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_consumption" ADD CONSTRAINT "job_work_consumption_receipt_id_job_work_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."job_work_receipt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_consumption" ADD CONSTRAINT "job_work_consumption_challan_line_id_job_work_challan_line_id_fk" FOREIGN KEY ("challan_line_id") REFERENCES "public"."job_work_challan_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_consumption" ADD CONSTRAINT "job_work_consumption_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order" ADD CONSTRAINT "job_work_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order" ADD CONSTRAINT "job_work_order_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order" ADD CONSTRAINT "job_work_order_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order" ADD CONSTRAINT "job_work_order_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order" ADD CONSTRAINT "job_work_order_work_order_operation_id_work_order_operation_id_fk" FOREIGN KEY ("work_order_operation_id") REFERENCES "public"."work_order_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order" ADD CONSTRAINT "job_work_order_target_item_id_item_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order" ADD CONSTRAINT "job_work_order_target_warehouse_id_warehouse_id_fk" FOREIGN KEY ("target_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order" ADD CONSTRAINT "job_work_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order_line" ADD CONSTRAINT "job_work_order_line_order_id_job_work_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."job_work_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_order_line" ADD CONSTRAINT "job_work_order_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt" ADD CONSTRAINT "job_work_receipt_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt" ADD CONSTRAINT "job_work_receipt_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt" ADD CONSTRAINT "job_work_receipt_order_id_job_work_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."job_work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt" ADD CONSTRAINT "job_work_receipt_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt" ADD CONSTRAINT "job_work_receipt_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_line" ADD CONSTRAINT "job_work_receipt_line_receipt_id_job_work_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."job_work_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_line" ADD CONSTRAINT "job_work_receipt_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_line" ADD CONSTRAINT "job_work_receipt_line_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_line" ADD CONSTRAINT "job_work_receipt_line_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_receipt_line" ADD CONSTRAINT "job_work_receipt_line_stock_entry_line_id_stock_entry_line_id_fk" FOREIGN KEY ("stock_entry_line_id") REFERENCES "public"."stock_entry_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "itc04_setting_uq" ON "itc04_setting" USING btree ("entity_id","fy");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_challan_number_uq" ON "job_work_challan" USING btree ("entity_id","gst_registration_id","number");--> statement-breakpoint
CREATE INDEX "job_work_challan_order_idx" ON "job_work_challan" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "job_work_challan_date_idx" ON "job_work_challan" USING btree ("entity_id","posting_date");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_challan_line_uq" ON "job_work_challan_line" USING btree ("challan_id","line_no");--> statement-breakpoint
CREATE INDEX "job_work_consumption_challan_idx" ON "job_work_consumption" USING btree ("challan_line_id");--> statement-breakpoint
CREATE INDEX "job_work_consumption_receipt_idx" ON "job_work_consumption" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_consumption_reversal_uq" ON "job_work_consumption" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_order_number_uq" ON "job_work_order" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "job_work_order_supplier_idx" ON "job_work_order" USING btree ("entity_id","supplier_id");--> statement-breakpoint
CREATE INDEX "job_work_order_wo_idx" ON "job_work_order" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_order_line_uq" ON "job_work_order_line" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_receipt_number_uq" ON "job_work_receipt" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "job_work_receipt_order_idx" ON "job_work_receipt" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "job_work_receipt_date_idx" ON "job_work_receipt" USING btree ("entity_id","posting_date");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_receipt_line_uq" ON "job_work_receipt_line" USING btree ("receipt_id","line_no");--> statement-breakpoint
ALTER TABLE "bom_operation" ADD CONSTRAINT "bom_operation_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operation" ADD CONSTRAINT "work_order_operation_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_operation" ADD CONSTRAINT "bom_operation_centre_ck" CHECK ("bom_operation"."outsourced" or "bom_operation"."work_centre_id" is not null);--> statement-breakpoint
ALTER TABLE "work_order_operation" ADD CONSTRAINT "work_order_operation_centre_ck" CHECK ("work_order_operation"."outsourced" or "work_order_operation"."work_centre_id" is not null);--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_job_work_receipt_id_fk" FOREIGN KEY ("job_work_receipt_id") REFERENCES "public"."job_work_receipt"("id");--> statement-breakpoint
ALTER TABLE "work_order_cost" ADD CONSTRAINT "work_order_cost_purchase_invoice_line_id_fk" FOREIGN KEY ("purchase_invoice_line_id") REFERENCES "public"."purchase_invoice_line"("id");--> statement-breakpoint
CREATE TRIGGER job_work_consumption_frozen BEFORE UPDATE OR DELETE ON job_work_consumption FOR EACH ROW EXECUTE FUNCTION factoryos_manufacturing_evidence_frozen();--> statement-breakpoint
CREATE TRIGGER job_work_receipt_line_frozen BEFORE UPDATE OR DELETE ON job_work_receipt_line FOR EACH ROW EXECUTE FUNCTION factoryos_manufacturing_evidence_frozen();
