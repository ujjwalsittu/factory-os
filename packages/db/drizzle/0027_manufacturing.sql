CREATE TYPE "public"."bom_status" AS ENUM('draft', 'active', 'obsolete');--> statement-breakpoint
CREATE TYPE "public"."job_card_event_kind" AS ENUM('start', 'pause', 'resume', 'stop');--> statement-breakpoint
CREATE TYPE "public"."job_card_status" AS ENUM('running', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."work_order_cost_kind" AS ENUM('issue', 'return', 'absorption', 'output', 'variance');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('draft', 'released', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'production_issue';--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'production_return';--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'production_output';--> statement-breakpoint
CREATE TABLE "bom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"quantity" numeric(24, 6) DEFAULT '1' NOT NULL,
	"status" "bom_status" DEFAULT 'draft' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"remarks" text,
	"activated_at" timestamp with time zone,
	"activated_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bom_quantity_ck" CHECK ("bom"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "bom_material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"backflush" boolean DEFAULT false NOT NULL,
	"remarks" text,
	CONSTRAINT "bom_material_qty_ck" CHECK ("bom_material"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "bom_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"work_centre_id" uuid NOT NULL,
	"setup_minutes" numeric(24, 6) DEFAULT '0' NOT NULL,
	"run_minutes_per_unit" numeric(24, 6) DEFAULT '0' NOT NULL,
	"instructions" text
);
--> statement-breakpoint
CREATE TABLE "job_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"machine_id" uuid,
	"operator_id" text NOT NULL,
	"status" "job_card_status" DEFAULT 'running' NOT NULL,
	"good_qty" numeric(24, 6),
	"rework_qty" numeric(24, 6),
	"scrap_qty" numeric(24, 6),
	"minutes" numeric(24, 6),
	"hourly_rate" numeric(24, 6),
	"value" numeric(24, 6),
	"posting_date" date,
	"remarks" text,
	"completed_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_card_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_card_id" uuid NOT NULL,
	"kind" "job_card_event_kind" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_centre_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_centre" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"hourly_rate" numeric(24, 6) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_centre_rate_ck" CHECK ("work_centre"."hourly_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "work_order_status" DEFAULT 'draft' NOT NULL,
	"item_id" uuid NOT NULL,
	"bom_id" uuid NOT NULL,
	"planned_qty" numeric(24, 6) NOT NULL,
	"produced_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"source_warehouse_id" uuid NOT NULL,
	"target_warehouse_id" uuid NOT NULL,
	"sales_order_id" uuid,
	"planned_start" date,
	"planned_end" date,
	"remarks" text,
	"released_by" text,
	"released_at" timestamp with time zone,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"completed_on" date,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_qty_ck" CHECK ("work_order"."planned_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "work_order_cost" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"kind" "work_order_cost_kind" NOT NULL,
	"posting_date" date NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"qty" numeric(24, 6),
	"stock_entry_id" uuid,
	"job_card_id" uuid,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_per_unit" numeric(24, 6) NOT NULL,
	"required_qty" numeric(24, 6) NOT NULL,
	"backflush" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"work_centre_id" uuid NOT NULL,
	"planned_minutes" numeric(24, 6) NOT NULL,
	"instructions" text
);
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD COLUMN "work_order_id" uuid;--> statement-breakpoint
ALTER TABLE "bom" ADD CONSTRAINT "bom_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom" ADD CONSTRAINT "bom_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom" ADD CONSTRAINT "bom_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom" ADD CONSTRAINT "bom_activated_by_user_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom" ADD CONSTRAINT "bom_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_material" ADD CONSTRAINT "bom_material_bom_id_bom_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bom"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_material" ADD CONSTRAINT "bom_material_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_operation" ADD CONSTRAINT "bom_operation_bom_id_bom_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bom"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_operation" ADD CONSTRAINT "bom_operation_work_centre_id_work_centre_id_fk" FOREIGN KEY ("work_centre_id") REFERENCES "public"."work_centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_operation_id_work_order_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."work_order_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_operator_id_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_event" ADD CONSTRAINT "job_card_event_job_card_id_job_card_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_event" ADD CONSTRAINT "job_card_event_by_user_id_fk" FOREIGN KEY ("by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_work_centre_id_work_centre_id_fk" FOREIGN KEY ("work_centre_id") REFERENCES "public"."work_centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centre" ADD CONSTRAINT "work_centre_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centre" ADD CONSTRAINT "work_centre_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centre" ADD CONSTRAINT "work_centre_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_bom_id_bom_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_source_warehouse_id_warehouse_id_fk" FOREIGN KEY ("source_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_target_warehouse_id_warehouse_id_fk" FOREIGN KEY ("target_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_sales_order_id_sales_order_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_cost" ADD CONSTRAINT "work_order_cost_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_cost" ADD CONSTRAINT "work_order_cost_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_cost" ADD CONSTRAINT "work_order_cost_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_cost" ADD CONSTRAINT "work_order_cost_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_cost" ADD CONSTRAINT "work_order_cost_job_card_id_job_card_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_cost" ADD CONSTRAINT "work_order_cost_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_material" ADD CONSTRAINT "work_order_material_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_material" ADD CONSTRAINT "work_order_material_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operation" ADD CONSTRAINT "work_order_operation_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operation" ADD CONSTRAINT "work_order_operation_work_centre_id_work_centre_id_fk" FOREIGN KEY ("work_centre_id") REFERENCES "public"."work_centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bom_item_revision_uq" ON "bom" USING btree ("entity_id","item_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_item_default_uq" ON "bom" USING btree ("entity_id","item_id") WHERE "bom"."is_default";--> statement-breakpoint
CREATE INDEX "bom_material_bom_idx" ON "bom_material" USING btree ("bom_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_operation_seq_uq" ON "bom_operation" USING btree ("bom_id","seq");--> statement-breakpoint
CREATE INDEX "job_card_work_order_idx" ON "job_card" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_card_operator_open_uq" ON "job_card" USING btree ("operator_id") WHERE "job_card"."status" in ('running', 'paused');--> statement-breakpoint
CREATE INDEX "job_card_event_card_idx" ON "job_card_event" USING btree ("job_card_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_entity_code_uq" ON "machine" USING btree ("entity_id","code");--> statement-breakpoint
CREATE INDEX "machine_centre_idx" ON "machine" USING btree ("work_centre_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_centre_entity_code_uq" ON "work_centre" USING btree ("entity_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_entity_number_uq" ON "work_order" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "work_order_entity_status_idx" ON "work_order" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "work_order_cost_wo_idx" ON "work_order_cost" USING btree ("work_order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_cost_reversal_uq" ON "work_order_cost" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_material_item_uq" ON "work_order_material" USING btree ("work_order_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_operation_seq_uq" ON "work_order_operation" USING btree ("work_order_id","seq");--> statement-breakpoint
CREATE INDEX "stock_entry_work_order_idx" ON "stock_entry" USING btree ("work_order_id");--> statement-breakpoint
CREATE FUNCTION factoryos_manufacturing_evidence_frozen() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Manufacturing evidence is append only; record a reversal instead'; END; $$;
--> statement-breakpoint
CREATE TRIGGER work_order_cost_frozen BEFORE UPDATE OR DELETE ON work_order_cost FOR EACH ROW EXECUTE FUNCTION factoryos_manufacturing_evidence_frozen();
--> statement-breakpoint
CREATE TRIGGER job_card_event_frozen BEFORE UPDATE OR DELETE ON job_card_event FOR EACH ROW EXECUTE FUNCTION factoryos_manufacturing_evidence_frozen();
