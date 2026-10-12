CREATE TYPE "public"."maintenance_order_kind" AS ENUM('preventive', 'breakdown');--> statement-breakpoint
CREATE TYPE "public"."maintenance_order_status" AS ENUM('open', 'in_progress', 'done', 'verified', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'maintenance';--> statement-breakpoint
CREATE TABLE "maintenance_labour" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"technician_id" text NOT NULL,
	"minutes" integer NOT NULL,
	"rate" numeric(18, 2) NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_labour_minutes_ck" CHECK ("maintenance_labour"."minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" "maintenance_order_kind" NOT NULL,
	"status" "maintenance_order_status" DEFAULT 'open' NOT NULL,
	"machine_id" uuid NOT NULL,
	"plan_id" uuid,
	"title" text NOT NULL,
	"scheduled_start" timestamp with time zone,
	"symptom" text,
	"failed_at" timestamp with time zone,
	"reported_by" text,
	"block_id" uuid,
	"started_at" timestamp with time zone,
	"cause" text,
	"action" text,
	"done_at" timestamp with time zone,
	"done_by" text,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_order_breakdown_ck" CHECK ("maintenance_order"."kind" <> 'breakdown' or ("maintenance_order"."failed_at" is not null and "maintenance_order"."symptom" is not null))
);
--> statement-breakpoint
CREATE TABLE "maintenance_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"name" text NOT NULL,
	"instructions" text,
	"every_days" integer,
	"every_run_hours" integer,
	"lead_days" integer DEFAULT 7 NOT NULL,
	"planned_minutes" integer DEFAULT 60 NOT NULL,
	"last_done_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_plan_interval_ck" CHECK ("maintenance_plan"."every_days" is not null or "maintenance_plan"."every_run_hours" is not null),
	CONSTRAINT "maintenance_plan_values_ck" CHECK (coalesce("maintenance_plan"."every_days", 1) > 0 and coalesce("maintenance_plan"."every_run_hours", 1) > 0 and "maintenance_plan"."lead_days" >= 0 and "maintenance_plan"."planned_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_plan_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"text" text NOT NULL,
	"unit" text,
	"min" numeric(18, 4),
	"max" numeric(18, 4),
	"spare_item_id" uuid,
	"spare_qty" numeric(24, 6)
);
--> statement-breakpoint
CREATE TABLE "maintenance_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reading" numeric(18, 4),
	"note" text,
	"done_by" text NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_spare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"stock_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machine" ADD COLUMN "critical" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_labour" ADD CONSTRAINT "maintenance_labour_order_id_maintenance_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."maintenance_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_labour" ADD CONSTRAINT "maintenance_labour_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_labour" ADD CONSTRAINT "maintenance_labour_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_plan_id_maintenance_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_reported_by_user_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_block_id_machine_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."machine_block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_order" ADD CONSTRAINT "maintenance_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan" ADD CONSTRAINT "maintenance_plan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_item" ADD CONSTRAINT "maintenance_plan_item_plan_id_maintenance_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_item" ADD CONSTRAINT "maintenance_plan_item_spare_item_id_item_id_fk" FOREIGN KEY ("spare_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_result" ADD CONSTRAINT "maintenance_result_order_id_maintenance_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."maintenance_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_result" ADD CONSTRAINT "maintenance_result_item_id_maintenance_plan_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."maintenance_plan_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_result" ADD CONSTRAINT "maintenance_result_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spare" ADD CONSTRAINT "maintenance_spare_order_id_maintenance_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."maintenance_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spare" ADD CONSTRAINT "maintenance_spare_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_labour_order_idx" ON "maintenance_labour" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_order_number_uq" ON "maintenance_order" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "maintenance_order_machine_idx" ON "maintenance_order" USING btree ("machine_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_order_plan_open_uq" ON "maintenance_order" USING btree ("plan_id") WHERE "maintenance_order"."status" in ('open', 'in_progress');--> statement-breakpoint
CREATE INDEX "maintenance_plan_machine_idx" ON "maintenance_plan" USING btree ("machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_plan_item_line_uq" ON "maintenance_plan_item" USING btree ("plan_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_result_item_uq" ON "maintenance_result" USING btree ("order_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_spare_entry_uq" ON "maintenance_spare" USING btree ("stock_entry_id");--> statement-breakpoint
CREATE INDEX "maintenance_spare_order_idx" ON "maintenance_spare" USING btree ("order_id");