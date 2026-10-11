CREATE TYPE "public"."subscription_delivery_kind" AS ENUM('report', 'alert');--> statement-breakpoint
CREATE TYPE "public"."subscription_period" AS ENUM('month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_ref" text,
	"plan_id" uuid NOT NULL,
	"aoi_name" text NOT NULL,
	"aoi_hectares" numeric(14, 2),
	"aoi_notes" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_aoi_ck" CHECK ("subscription"."aoi_hectares" is null or "subscription"."aoi_hectares" > 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" "subscription_delivery_kind" NOT NULL,
	"delivered_on" date NOT NULL,
	"title" text NOT NULL,
	"reference" text,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"fee_period_start" date,
	"fee_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"overage_period_start" date,
	"overage_reports" integer DEFAULT 0 NOT NULL,
	"overage_alerts" integer DEFAULT 0 NOT NULL,
	"overage_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"proration_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"solution" text NOT NULL,
	"period" "subscription_period" NOT NULL,
	"fee" numeric(18, 2) NOT NULL,
	"included_reports" integer DEFAULT 0 NOT NULL,
	"included_alerts" integer DEFAULT 0 NOT NULL,
	"report_rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"alert_rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"service_item_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plan_ck" CHECK ("subscription_plan"."fee" >= 0 and "subscription_plan"."included_reports" >= 0 and "subscription_plan"."included_alerts" >= 0 and "subscription_plan"."report_rate" >= 0 and "subscription_plan"."alert_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_plan_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"from_plan_id" uuid NOT NULL,
	"to_plan_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"proration_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sales_invoice_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plan_change_ck" CHECK ("subscription_plan_change"."proration_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_subscription_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_delivery" ADD CONSTRAINT "subscription_delivery_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_delivery" ADD CONSTRAINT "subscription_delivery_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_delivery" ADD CONSTRAINT "subscription_delivery_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD CONSTRAINT "subscription_plan_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD CONSTRAINT "subscription_plan_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD CONSTRAINT "subscription_plan_service_item_id_item_id_fk" FOREIGN KEY ("service_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD CONSTRAINT "subscription_plan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_change" ADD CONSTRAINT "subscription_plan_change_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_change" ADD CONSTRAINT "subscription_plan_change_from_plan_id_subscription_plan_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."subscription_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_change" ADD CONSTRAINT "subscription_plan_change_to_plan_id_subscription_plan_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."subscription_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_change" ADD CONSTRAINT "subscription_plan_change_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_change" ADD CONSTRAINT "subscription_plan_change_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_number_uq" ON "subscription" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "subscription_customer_idx" ON "subscription" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscription_delivery_sub_idx" ON "subscription_delivery" USING btree ("subscription_id","delivered_on");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_delivery_reversal_uq" ON "subscription_delivery" USING btree ("reversal_of");--> statement-breakpoint
CREATE INDEX "subscription_invoice_sub_idx" ON "subscription_invoice" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoice_si_uq" ON "subscription_invoice" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plan_code_uq" ON "subscription_plan" USING btree ("entity_id","code");--> statement-breakpoint
CREATE INDEX "subscription_plan_change_sub_idx" ON "subscription_plan_change" USING btree ("subscription_id","effective_on");--> statement-breakpoint
CREATE OR REPLACE FUNCTION subscription_delivery_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'subscription deliveries are append-only; record a reversal instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER subscription_delivery_immutable BEFORE UPDATE OR DELETE ON "subscription_delivery" FOR EACH ROW EXECUTE FUNCTION subscription_delivery_immutable();
