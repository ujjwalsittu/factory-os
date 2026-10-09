CREATE TYPE "public"."attachment_kind" AS ENUM('mtc', 'coc', 'coa', 'fai', 'cmm', 'photo', 'calibration', 'drawing', 'other');--> statement-breakpoint
CREATE TYPE "public"."calibration_result" AS ENUM('pass', 'adjusted', 'fail');--> statement-breakpoint
CREATE TYPE "public"."characteristic_kind" AS ENUM('dimension', 'visual', 'functional', 'document');--> statement-breakpoint
CREATE TYPE "public"."fai_reason" AS ENUM('first_build', 'revision_change', 'process_change', 'lapse');--> statement-breakpoint
CREATE TYPE "public"."fai_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."gauge_status" AS ENUM('in_service', 'out_of_service', 'failed');--> statement-breakpoint
CREATE TYPE "public"."inspection_outcome" AS ENUM('pass', 'fail', 'partial');--> statement-breakpoint
CREATE TYPE "public"."inspection_source" AS ENUM('receipt', 'job_work_receipt', 'operation', 'output', 'manual');--> statement-breakpoint
CREATE TYPE "public"."inspection_stage" AS ENUM('incoming', 'in_process', 'final');--> statement-breakpoint
CREATE TYPE "public"."ncr_disposition_kind" AS ENUM('use_as_is', 'rework', 'repair', 'scrap', 'return_to_vendor');--> statement-breakpoint
CREATE TYPE "public"."ncr_disposition_status" AS ENUM('proposed', 'approved', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ncr_status" AS ENUM('open', 'dispositioned', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	"withdraw_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_size_ck" CHECK ("attachment"."size" > 0)
);
--> statement-breakpoint
CREATE TABLE "calibration_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"gauge_id" uuid NOT NULL,
	"calibrated_on" date NOT NULL,
	"result" "calibration_result" NOT NULL,
	"agency" text,
	"certificate_no" text,
	"next_due" date,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fai" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"item_id" uuid NOT NULL,
	"item_revision" text,
	"batch_id" uuid,
	"reason" "fai_reason" NOT NULL,
	"status" "fai_status" DEFAULT 'draft' NOT NULL,
	"inspection_record_id" uuid,
	"forms" jsonb,
	"remarks" text,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gauge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"type" text,
	"location" text,
	"interval_days" integer NOT NULL,
	"last_calibrated" date,
	"due_date" date,
	"status" "gauge_status" DEFAULT 'in_service' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gauge_interval_ck" CHECK ("gauge"."interval_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "inspection_characteristic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"balloon" text,
	"description" text NOT NULL,
	"kind" characteristic_kind NOT NULL,
	"nominal" numeric(24, 6),
	"lower_limit" numeric(24, 6),
	"upper_limit" numeric(24, 6),
	"unit" text,
	"method" text,
	"is_key" boolean DEFAULT false NOT NULL,
	"sample_size" integer,
	CONSTRAINT "inspection_characteristic_limits_ck" CHECK ("inspection_characteristic"."lower_limit" is null or "inspection_characteristic"."upper_limit" is null or "inspection_characteristic"."lower_limit" <= "inspection_characteristic"."upper_limit")
);
--> statement-breakpoint
CREATE TABLE "inspection_measurement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"characteristic_id" uuid,
	"description" text,
	"sample_no" integer DEFAULT 1 NOT NULL,
	"measured" numeric(24, 6),
	"pass" boolean NOT NULL,
	"gauge_id" uuid,
	"gauge_due_date" date,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"stage" "inspection_stage" NOT NULL,
	"operation_seq" integer,
	"revision" text NOT NULL,
	"status" "bom_status" DEFAULT 'draft' NOT NULL,
	"remarks" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_plan_seq_ck" CHECK (("inspection_plan"."stage" = 'in_process') = ("inspection_plan"."operation_seq" is not null))
);
--> statement-breakpoint
CREATE TABLE "inspection_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"stage" "inspection_stage" NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"plan_id" uuid,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(24, 6) NOT NULL,
	"source_type" "inspection_source" NOT NULL,
	"source_id" uuid,
	"work_order_id" uuid,
	"operation_id" uuid,
	"hold_warehouse_id" uuid,
	"accept_warehouse_id" uuid,
	"outcome" "inspection_outcome",
	"qty_accepted" numeric(24, 6) DEFAULT '0' NOT NULL,
	"qty_rejected" numeric(24, 6) DEFAULT '0' NOT NULL,
	"transfer_entry_id" uuid,
	"remarks" text,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_record_qty_ck" CHECK ("inspection_record"."qty" > 0 and "inspection_record"."qty_accepted" + "inspection_record"."qty_rejected" <= "inspection_record"."qty")
);
--> statement-breakpoint
CREATE TABLE "ncr" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "ncr_status" DEFAULT 'open' NOT NULL,
	"inspection_record_id" uuid,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty" numeric(24, 6) NOT NULL,
	"from_warehouse_id" uuid,
	"mrb_warehouse_id" uuid,
	"hold_entry_id" uuid,
	"work_order_id" uuid,
	"description" text NOT NULL,
	"closed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ncr_qty_ck" CHECK ("ncr"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "ncr_disposition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ncr_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" "ncr_disposition_kind" NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"status" "ncr_disposition_status" DEFAULT 'proposed' NOT NULL,
	"concession_ref" text,
	"waste_category" text,
	"note" text,
	"proposed_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"stock_entry_id" uuid,
	"work_order_id" uuid,
	"return_claim_id" uuid,
	"posted_at" timestamp with time zone,
	CONSTRAINT "ncr_disposition_qty_ck" CHECK ("ncr_disposition"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "requires_final_inspection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "requires_fai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "fai_process_change" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD COLUMN "inspection_record_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "rework_of_ncr_id" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_event" ADD CONSTRAINT "calibration_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_event" ADD CONSTRAINT "calibration_event_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_event" ADD CONSTRAINT "calibration_event_gauge_id_gauge_id_fk" FOREIGN KEY ("gauge_id") REFERENCES "public"."gauge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_event" ADD CONSTRAINT "calibration_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fai" ADD CONSTRAINT "fai_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fai" ADD CONSTRAINT "fai_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fai" ADD CONSTRAINT "fai_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fai" ADD CONSTRAINT "fai_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fai" ADD CONSTRAINT "fai_inspection_record_id_inspection_record_id_fk" FOREIGN KEY ("inspection_record_id") REFERENCES "public"."inspection_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fai" ADD CONSTRAINT "fai_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fai" ADD CONSTRAINT "fai_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fai" ADD CONSTRAINT "fai_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gauge" ADD CONSTRAINT "gauge_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gauge" ADD CONSTRAINT "gauge_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gauge" ADD CONSTRAINT "gauge_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_characteristic" ADD CONSTRAINT "inspection_characteristic_plan_id_inspection_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inspection_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_measurement" ADD CONSTRAINT "inspection_measurement_record_id_inspection_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."inspection_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_measurement" ADD CONSTRAINT "inspection_measurement_characteristic_id_inspection_characteristic_id_fk" FOREIGN KEY ("characteristic_id") REFERENCES "public"."inspection_characteristic"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_measurement" ADD CONSTRAINT "inspection_measurement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plan" ADD CONSTRAINT "inspection_plan_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plan" ADD CONSTRAINT "inspection_plan_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plan" ADD CONSTRAINT "inspection_plan_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plan" ADD CONSTRAINT "inspection_plan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_plan_id_inspection_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inspection_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_operation_id_work_order_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."work_order_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_hold_warehouse_id_warehouse_id_fk" FOREIGN KEY ("hold_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_accept_warehouse_id_warehouse_id_fk" FOREIGN KEY ("accept_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_transfer_entry_id_stock_entry_id_fk" FOREIGN KEY ("transfer_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_record" ADD CONSTRAINT "inspection_record_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_inspection_record_id_inspection_record_id_fk" FOREIGN KEY ("inspection_record_id") REFERENCES "public"."inspection_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_mrb_warehouse_id_warehouse_id_fk" FOREIGN KEY ("mrb_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_hold_entry_id_stock_entry_id_fk" FOREIGN KEY ("hold_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_disposition" ADD CONSTRAINT "ncr_disposition_ncr_id_ncr_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncr"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_disposition" ADD CONSTRAINT "ncr_disposition_proposed_by_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_disposition" ADD CONSTRAINT "ncr_disposition_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_disposition" ADD CONSTRAINT "ncr_disposition_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_disposition" ADD CONSTRAINT "ncr_disposition_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_owner_idx" ON "attachment" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_object_uq" ON "attachment" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "calibration_event_gauge_idx" ON "calibration_event" USING btree ("gauge_id","calibrated_on");--> statement-breakpoint
CREATE UNIQUE INDEX "fai_number_uq" ON "fai" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "fai_item_idx" ON "fai" USING btree ("entity_id","item_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gauge_code_uq" ON "gauge" USING btree ("entity_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_characteristic_line_uq" ON "inspection_characteristic" USING btree ("plan_id","line_no");--> statement-breakpoint
CREATE INDEX "inspection_measurement_record_idx" ON "inspection_measurement" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "inspection_measurement_gauge_idx" ON "inspection_measurement" USING btree ("gauge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_plan_rev_uq" ON "inspection_plan" USING btree ("entity_id","item_id","stage",coalesce("operation_seq", 0),"revision");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_plan_active_uq" ON "inspection_plan" USING btree ("entity_id","item_id","stage",coalesce("operation_seq", 0)) WHERE "inspection_plan"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_record_number_uq" ON "inspection_record" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "inspection_record_source_idx" ON "inspection_record" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "inspection_record_item_idx" ON "inspection_record" USING btree ("entity_id","item_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "ncr_number_uq" ON "ncr" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "ncr_status_idx" ON "ncr" USING btree ("entity_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ncr_disposition_line_uq" ON "ncr_disposition" USING btree ("ncr_id","line_no");--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_rework_of_ncr_id_fk" FOREIGN KEY ("rework_of_ncr_id") REFERENCES "public"."ncr"("id");--> statement-breakpoint
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_inspection_record_id_fk" FOREIGN KEY ("inspection_record_id") REFERENCES "public"."inspection_record"("id");--> statement-breakpoint
ALTER TABLE "inspection_measurement" ADD CONSTRAINT "inspection_measurement_gauge_id_fk" FOREIGN KEY ("gauge_id") REFERENCES "public"."gauge"("id");--> statement-breakpoint
CREATE TRIGGER inspection_measurement_frozen BEFORE UPDATE OR DELETE ON inspection_measurement FOR EACH ROW EXECUTE FUNCTION factoryos_manufacturing_evidence_frozen();--> statement-breakpoint
CREATE TRIGGER calibration_event_frozen BEFORE UPDATE OR DELETE ON calibration_event FOR EACH ROW EXECUTE FUNCTION factoryos_manufacturing_evidence_frozen();--> statement-breakpoint
CREATE FUNCTION factoryos_attachment_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attachments are append only; withdraw them instead'; END IF;
  IF OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL OR (to_jsonb(NEW) - 'withdrawn_at' - 'withdrawn_by' - 'withdraw_reason') <> (to_jsonb(OLD) - 'withdrawn_at' - 'withdrawn_by' - 'withdraw_reason') THEN
    RAISE EXCEPTION 'Attachments are append only; only a withdrawal can be recorded';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER attachment_append_only BEFORE UPDATE OR DELETE ON attachment FOR EACH ROW EXECUTE FUNCTION factoryos_attachment_append_only();
