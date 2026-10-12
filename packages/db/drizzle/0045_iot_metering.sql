CREATE TYPE "public"."maas_meter_status" AS ENUM('none', 'applied', 'review');--> statement-breakpoint
CREATE TYPE "public"."iot_device_kind" AS ENUM('machine_tap');--> statement-breakpoint
CREATE TYPE "public"."iot_device_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."iot_edge_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."machine_state" AS ENUM('off', 'idle', 'setup', 'running', 'alarm', 'maintenance');--> statement-breakpoint
ALTER TYPE "public"."maas_usage_source" ADD VALUE 'meter';--> statement-breakpoint
CREATE TABLE "iot_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"edge_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "iot_device_kind" DEFAULT 'machine_tap' NOT NULL,
	"machine_id" uuid NOT NULL,
	"heartbeat_seconds" integer DEFAULT 60 NOT NULL,
	"status" "iot_device_status" DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_state" "machine_state",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "iot_device_heartbeat_ck" CHECK ("iot_device"."heartbeat_seconds" between 10 and 600)
);
--> statement-breakpoint
CREATE TABLE "iot_edge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "iot_edge_status" DEFAULT 'active' NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "machine_state_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"state" "machine_state" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "meter_status" "maas_meter_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "metered_minutes" integer;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "timer_minutes" integer;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "meter_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "meter_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maas_booking" ADD COLUMN "meter_review_note" text;--> statement-breakpoint
ALTER TABLE "iot_device" ADD CONSTRAINT "iot_device_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device" ADD CONSTRAINT "iot_device_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device" ADD CONSTRAINT "iot_device_edge_id_iot_edge_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."iot_edge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device" ADD CONSTRAINT "iot_device_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_edge" ADD CONSTRAINT "iot_edge_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_edge" ADD CONSTRAINT "iot_edge_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_edge" ADD CONSTRAINT "iot_edge_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD CONSTRAINT "machine_state_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD CONSTRAINT "machine_state_event_device_id_iot_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_state_event" ADD CONSTRAINT "machine_state_event_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iot_device_code_uq" ON "iot_device" USING btree ("entity_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "iot_device_machine_uq" ON "iot_device" USING btree ("machine_id") WHERE "iot_device"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "iot_edge_code_uq" ON "iot_edge" USING btree ("entity_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "iot_edge_key_uq" ON "iot_edge" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_state_event_seq_uq" ON "machine_state_event" USING btree ("device_id","seq");--> statement-breakpoint
CREATE INDEX "machine_state_event_machine_idx" ON "machine_state_event" USING btree ("machine_id","at");--> statement-breakpoint
ALTER TABLE "maas_booking" ADD CONSTRAINT "maas_booking_meter_reviewed_by_user_id_fk" FOREIGN KEY ("meter_reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION machine_state_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Machine state events are kept as received';
END;
$$;--> statement-breakpoint
CREATE TRIGGER machine_state_event_append_only BEFORE UPDATE OR DELETE ON "machine_state_event" FOR EACH ROW EXECUTE FUNCTION machine_state_event_append_only();
