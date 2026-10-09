CREATE TYPE "public"."machine_block_kind" AS ENUM('maintenance', 'breakdown', 'booking');--> statement-breakpoint
CREATE TABLE "calendar_holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"name" text,
	CONSTRAINT "calendar_shift_weekday_ck" CHECK ("calendar_shift"."weekday" between 1 and 7),
	CONSTRAINT "calendar_shift_time_ck" CHECK ("calendar_shift"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "calendar_shift"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "machine_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"kind" "machine_block_kind" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_block_period_ck" CHECK ("machine_block"."ends_at" > "machine_block"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "schedule_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"horizon_end" timestamp with time zone NOT NULL,
	"placed" integer NOT NULL,
	"unscheduled" integer NOT NULL,
	"late" integer NOT NULL,
	"conflicts" integer NOT NULL,
	"details" jsonb NOT NULL,
	"run_by" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"machine_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"running" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_operation_period_ck" CHECK ("scheduled_operation"."ends_at" >= "scheduled_operation"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "work_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bom_operation" ADD COLUMN "lead_days" integer;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "out_of_sequence_reason" text;--> statement-breakpoint
ALTER TABLE "work_centre" ADD COLUMN "calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "priority" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "scheduled_finish" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_order_operation" ADD COLUMN "lead_days" integer;--> statement-breakpoint
ALTER TABLE "calendar_holiday" ADD CONSTRAINT "calendar_holiday_calendar_id_work_calendar_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_shift" ADD CONSTRAINT "calendar_shift_calendar_id_work_calendar_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_block" ADD CONSTRAINT "machine_block_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_block" ADD CONSTRAINT "machine_block_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_block" ADD CONSTRAINT "machine_block_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_block" ADD CONSTRAINT "machine_block_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_run" ADD CONSTRAINT "schedule_run_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_run" ADD CONSTRAINT "schedule_run_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_run" ADD CONSTRAINT "schedule_run_run_by_user_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_operation" ADD CONSTRAINT "scheduled_operation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_operation" ADD CONSTRAINT "scheduled_operation_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_operation" ADD CONSTRAINT "scheduled_operation_run_id_schedule_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."schedule_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_operation" ADD CONSTRAINT "scheduled_operation_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_operation" ADD CONSTRAINT "scheduled_operation_operation_id_work_order_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."work_order_operation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_operation" ADD CONSTRAINT "scheduled_operation_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar" ADD CONSTRAINT "work_calendar_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar" ADD CONSTRAINT "work_calendar_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendar" ADD CONSTRAINT "work_calendar_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holiday_date_uq" ON "calendar_holiday" USING btree ("calendar_id","date");--> statement-breakpoint
CREATE INDEX "calendar_shift_calendar_idx" ON "calendar_shift" USING btree ("calendar_id");--> statement-breakpoint
CREATE INDEX "machine_block_machine_idx" ON "machine_block" USING btree ("machine_id","starts_at");--> statement-breakpoint
CREATE INDEX "schedule_run_entity_idx" ON "schedule_run" USING btree ("entity_id","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_operation_op_uq" ON "scheduled_operation" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "scheduled_operation_machine_idx" ON "scheduled_operation" USING btree ("entity_id","machine_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendar_entity_name_uq" ON "work_calendar" USING btree ("entity_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendar_entity_default_uq" ON "work_calendar" USING btree ("entity_id") WHERE "work_calendar"."is_default";--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_priority_ck" CHECK ("work_order"."priority" between 1 and 5);--> statement-breakpoint
-- Manual: work_centre.calendar_id is declared without a Drizzle reference (schema files would import each other).
ALTER TABLE "work_centre" ADD CONSTRAINT "work_centre_calendar_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."work_calendar"("id");