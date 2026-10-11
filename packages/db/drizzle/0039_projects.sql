CREATE TYPE "public"."project_cost_category" AS ENUM('material', 'machine', 'labour', 'bought_in', 'other');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'active', 'completed', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted', 'approved');--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"customer_ref" text,
	"manager_user_id" text,
	"service_item_id" uuid NOT NULL,
	"contract_value" numeric(18, 2) NOT NULL,
	"retention_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"dlp_months" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"cancel_reason" text,
	"completed_on" date,
	"closed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_value_ck" CHECK ("project"."contract_value" > 0),
	CONSTRAINT "project_retention_ck" CHECK ("project"."retention_pct" between 0 and 50),
	CONSTRAINT "project_dlp_ck" CHECK ("project"."dlp_months" between 0 and 60)
);
--> statement-breakpoint
CREATE TABLE "project_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "project_cost_category" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	CONSTRAINT "project_budget_ck" CHECK ("project_budget"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_cost_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"hourly_rate" numeric(18, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_cost_rate_ck" CHECK ("project_cost_rate"."hourly_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"amount" numeric(18, 2) NOT NULL,
	"achieved_on" date,
	"acceptance_ref" text,
	"achieved_by" text,
	"sales_invoice_id" uuid,
	CONSTRAINT "project_milestone_amount_ck" CHECK ("project_milestone"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_retention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"released_on" date,
	"release_ref" text,
	"released_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_retention_ck" CHECK ("project_retention"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "timesheet_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid,
	"work_date" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"notes" text,
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"reject_reason" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"cost_rate" numeric(18, 2),
	"cost_amount" numeric(18, 2),
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_entry_hours_ck" CHECK ("timesheet_entry"."hours" <> 0 and abs("timesheet_entry"."hours") <= 24 and mod("timesheet_entry"."hours" * 4, 1) = 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_manager_user_id_user_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_service_item_id_item_id_fk" FOREIGN KEY ("service_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget" ADD CONSTRAINT "project_budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_rate" ADD CONSTRAINT "project_cost_rate_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_rate" ADD CONSTRAINT "project_cost_rate_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_rate" ADD CONSTRAINT "project_cost_rate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_rate" ADD CONSTRAINT "project_cost_rate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_achieved_by_user_id_fk" FOREIGN KEY ("achieved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_retention" ADD CONSTRAINT "project_retention_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_retention" ADD CONSTRAINT "project_retention_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_retention" ADD CONSTRAINT "project_retention_milestone_id_project_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_retention" ADD CONSTRAINT "project_retention_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_milestone_id_project_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_number_uq" ON "project" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "project_customer_idx" ON "project" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budget_uq" ON "project_budget" USING btree ("project_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "project_cost_rate_uq" ON "project_cost_rate" USING btree ("entity_id","user_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "project_milestone_seq_uq" ON "project_milestone" USING btree ("project_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "project_retention_invoice_uq" ON "project_retention" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "project_retention_project_idx" ON "project_retention" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "timesheet_entry_user_idx" ON "timesheet_entry" USING btree ("entity_id","user_id","work_date");--> statement-breakpoint
CREATE INDEX "timesheet_entry_project_idx" ON "timesheet_entry" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_entry_reversal_uq" ON "timesheet_entry" USING btree ("reversal_of");--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD CONSTRAINT "test_campaign_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_order_project_idx" ON "work_order" USING btree ("project_id") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "purchase_invoice_line_project_idx" ON "purchase_invoice_line" USING btree ("project_id") WHERE "project_id" IS NOT NULL;
