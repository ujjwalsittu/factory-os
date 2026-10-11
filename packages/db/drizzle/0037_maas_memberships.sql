CREATE TYPE "public"."maas_membership_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TABLE "maas_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"included_minutes" integer NOT NULL,
	"fee" numeric(18, 2) NOT NULL,
	"status" "maas_membership_status" DEFAULT 'active' NOT NULL,
	"cancel_reason" text,
	"sales_invoice_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maas_membership_term_ck" CHECK ("maas_membership"."ends_on" >= "maas_membership"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "maas_membership_draw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"reversal_of" uuid,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maas_membership_draw_minutes_ck" CHECK (("maas_membership_draw"."reversal_of" is null and "maas_membership_draw"."minutes" > 0) or ("maas_membership_draw"."reversal_of" is not null and "maas_membership_draw"."minutes" < 0))
);
--> statement-breakpoint
CREATE TABLE "maas_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"included_minutes" integer NOT NULL,
	"term_months" integer NOT NULL,
	"fee" numeric(18, 2) NOT NULL,
	"service_item_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maas_plan_minutes_ck" CHECK ("maas_plan"."included_minutes" > 0 and "maas_plan"."included_minutes" % 60 = 0),
	CONSTRAINT "maas_plan_term_ck" CHECK ("maas_plan"."term_months" between 1 and 60),
	CONSTRAINT "maas_plan_fee_ck" CHECK ("maas_plan"."fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "billed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maas_membership" ADD CONSTRAINT "maas_membership_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership" ADD CONSTRAINT "maas_membership_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership" ADD CONSTRAINT "maas_membership_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership" ADD CONSTRAINT "maas_membership_plan_id_maas_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maas_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership" ADD CONSTRAINT "maas_membership_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership" ADD CONSTRAINT "maas_membership_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership_draw" ADD CONSTRAINT "maas_membership_draw_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership_draw" ADD CONSTRAINT "maas_membership_draw_membership_id_maas_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."maas_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership_draw" ADD CONSTRAINT "maas_membership_draw_booking_id_maas_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."maas_booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_membership_draw" ADD CONSTRAINT "maas_membership_draw_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_plan" ADD CONSTRAINT "maas_plan_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_plan" ADD CONSTRAINT "maas_plan_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_plan" ADD CONSTRAINT "maas_plan_service_item_id_item_id_fk" FOREIGN KEY ("service_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_plan" ADD CONSTRAINT "maas_plan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maas_membership_number_uq" ON "maas_membership" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "maas_membership_customer_idx" ON "maas_membership" USING btree ("customer_id","starts_on");--> statement-breakpoint
CREATE INDEX "maas_membership_draw_membership_idx" ON "maas_membership_draw" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "maas_membership_draw_booking_idx" ON "maas_membership_draw" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maas_membership_draw_reversal_uq" ON "maas_membership_draw" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "maas_plan_code_uq" ON "maas_plan" USING btree ("entity_id","code");--> statement-breakpoint
CREATE OR REPLACE FUNCTION maas_draw_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'membership draws are append-only; record a reversal instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER maas_membership_draw_immutable BEFORE UPDATE OR DELETE ON "maas_membership_draw" FOR EACH ROW EXECUTE FUNCTION maas_draw_immutable();
