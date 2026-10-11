CREATE TYPE "public"."maas_booking_status" AS ENUM('tentative', 'confirmed', 'in_use', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."maas_usage_source" AS ENUM('timer', 'manual');--> statement-breakpoint
CREATE TABLE "maas_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "maas_booking_status" DEFAULT 'tentative' NOT NULL,
	"purpose" text,
	"machine_block_id" uuid,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"cancel_reason" text,
	"sales_invoice_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maas_booking_period_ck" CHECK ("maas_booking"."ends_at" > "maas_booking"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "maas_rate_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"service_item_id" uuid NOT NULL,
	"standard_rate" numeric(18, 2) NOT NULL,
	"member_rate" numeric(18, 2),
	"minimum_minutes" integer DEFAULT 0 NOT NULL,
	"rounding_minutes" integer DEFAULT 15 NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maas_rate_card_rounding_ck" CHECK ("maas_rate_card"."rounding_minutes" in (6, 12, 15, 30, 60)),
	CONSTRAINT "maas_rate_card_minimum_ck" CHECK ("maas_rate_card"."minimum_minutes" >= 0 and "maas_rate_card"."minimum_minutes" % "maas_rate_card"."rounding_minutes" = 0),
	CONSTRAINT "maas_rate_card_rates_ck" CHECK ("maas_rate_card"."standard_rate" > 0 and ("maas_rate_card"."member_rate" is null or "maas_rate_card"."member_rate" > 0)),
	CONSTRAINT "maas_rate_card_validity_ck" CHECK ("maas_rate_card"."valid_to" is null or "maas_rate_card"."valid_to" >= "maas_rate_card"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "maas_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"source" "maas_usage_source" NOT NULL,
	"note" text,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maas_usage_minutes_ck" CHECK ("maas_usage"."minutes" <> 0)
);
--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "maas_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_machine_block_id_machine_block_id_fk" FOREIGN KEY ("machine_block_id") REFERENCES "public"."machine_block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_rate_card" ADD CONSTRAINT "maas_rate_card_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_rate_card" ADD CONSTRAINT "maas_rate_card_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_rate_card" ADD CONSTRAINT "maas_rate_card_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_rate_card" ADD CONSTRAINT "maas_rate_card_service_item_id_item_id_fk" FOREIGN KEY ("service_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_rate_card" ADD CONSTRAINT "maas_rate_card_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_usage" ADD CONSTRAINT "maas_usage_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_usage" ADD CONSTRAINT "maas_usage_booking_id_maas_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."maas_booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maas_usage" ADD CONSTRAINT "maas_usage_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maas_booking_number_uq" ON "maas_booking" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "maas_booking_machine_idx" ON "maas_booking" USING btree ("machine_id","starts_at");--> statement-breakpoint
CREATE INDEX "maas_booking_customer_idx" ON "maas_booking" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "maas_rate_card_machine_idx" ON "maas_rate_card" USING btree ("machine_id","valid_from");--> statement-breakpoint
CREATE INDEX "maas_usage_booking_idx" ON "maas_usage" USING btree ("booking_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION maas_usage_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'machine usage is append-only; record a correction instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER maas_usage_immutable BEFORE UPDATE OR DELETE ON "maas_usage" FOR EACH ROW EXECUTE FUNCTION maas_usage_immutable();
