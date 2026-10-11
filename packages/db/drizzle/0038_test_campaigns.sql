CREATE TYPE "public"."test_campaign_status" AS ENUM('draft', 'active', 'reported', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."test_step_result" AS ENUM('pending', 'pass', 'fail', 'na');--> statement-breakpoint
CREATE TABLE "custody_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"description" text NOT NULL,
	"serial_no" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"inward_challan_no" text NOT NULL,
	"received_condition" text NOT NULL,
	"received_by" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outward_challan_no" text,
	"return_condition" text,
	"returned_by" text,
	"returned_at" timestamp with time zone,
	CONSTRAINT "custody_item_qty_ck" CHECK ("custody_item"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "test_campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"scope" text,
	"customer_ref" text,
	"service_item_id" uuid NOT NULL,
	"quoted_amount" numeric(18, 2) NOT NULL,
	"status" "test_campaign_status" DEFAULT 'draft' NOT NULL,
	"cancel_reason" text,
	"report_summary" text,
	"report_approved_by" text,
	"report_approved_at" timestamp with time zone,
	"sales_invoice_id" uuid,
	"closed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_campaign_amount_ck" CHECK ("test_campaign"."quoted_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "test_campaign_extra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"rate" numeric(18, 2) NOT NULL,
	"service_item_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_campaign_extra_ck" CHECK ("test_campaign_extra"."qty" > 0 and "test_campaign_extra"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "test_campaign_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"requirement" text,
	"result" "test_step_result" DEFAULT 'pending' NOT NULL,
	"measured" text,
	"notes" text,
	"recorded_by" text,
	"recorded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "custody_item" ADD CONSTRAINT "custody_item_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_item" ADD CONSTRAINT "custody_item_campaign_id_test_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."test_campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_item" ADD CONSTRAINT "custody_item_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_item" ADD CONSTRAINT "custody_item_returned_by_user_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD CONSTRAINT "test_campaign_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD CONSTRAINT "test_campaign_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD CONSTRAINT "test_campaign_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD CONSTRAINT "test_campaign_service_item_id_item_id_fk" FOREIGN KEY ("service_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD CONSTRAINT "test_campaign_report_approved_by_user_id_fk" FOREIGN KEY ("report_approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD CONSTRAINT "test_campaign_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign" ADD CONSTRAINT "test_campaign_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign_extra" ADD CONSTRAINT "test_campaign_extra_campaign_id_test_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."test_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign_extra" ADD CONSTRAINT "test_campaign_extra_service_item_id_item_id_fk" FOREIGN KEY ("service_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign_extra" ADD CONSTRAINT "test_campaign_extra_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign_step" ADD CONSTRAINT "test_campaign_step_campaign_id_test_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."test_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_campaign_step" ADD CONSTRAINT "test_campaign_step_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custody_item_campaign_idx" ON "custody_item" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_campaign_number_uq" ON "test_campaign" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "test_campaign_customer_idx" ON "test_campaign" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_campaign_step_seq_uq" ON "test_campaign_step" USING btree ("campaign_id","seq");