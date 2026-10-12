CREATE TYPE "public"."label_printer_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."print_job_kind" AS ENUM('panel', 'board', 'container', 'test');--> statement-breakpoint
CREATE TYPE "public"."print_job_status" AS ENUM('queued', 'sent', 'printed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."smt_container_kind" AS ENUM('reel', 'paste');--> statement-breakpoint
CREATE TABLE "label_printer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"edge_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 9100 NOT NULL,
	"dpi" integer DEFAULT 203 NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"status" "label_printer_status" DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_printer_port_ck" CHECK ("label_printer"."port" between 1 and 65535),
	CONSTRAINT "label_printer_dpi_ck" CHECK ("label_printer"."dpi" in (203, 300, 600)),
	CONSTRAINT "label_printer_size_ck" CHECK ("label_printer"."width_mm" between 10 and 200 and "label_printer"."height_mm" between 5 and 300)
);
--> statement-breakpoint
CREATE TABLE "print_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"printer_id" uuid NOT NULL,
	"kind" "print_job_kind" NOT NULL,
	"source_id" uuid,
	"label" text NOT NULL,
	"zpl" text NOT NULL,
	"status" "print_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"error" text,
	"printed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smt_board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"panel_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"serial_no" text NOT NULL,
	"batch_id" uuid,
	"scrapped_at" timestamp with time zone,
	"scrapped_by" text,
	"scrap_reason" text,
	CONSTRAINT "smt_board_scrap_ck" CHECK ("smt_board"."scrapped_at" is null or "smt_board"."batch_id" is null)
);
--> statement-breakpoint
CREATE TABLE "smt_container" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "smt_container_kind" NOT NULL,
	"code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"qty" numeric(24, 6) NOT NULL,
	"label_hours" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "smt_container_qty_ck" CHECK ("smt_container"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "smt_container_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	CONSTRAINT "smt_container_event_kind_ck" CHECK ("smt_container_event"."kind" in ('opened', 'cabinet_in', 'cabinet_out', 'baked', 'resealed', 'empty', 'out_of_fridge', 'back_in_fridge'))
);
--> statement-breakpoint
CREATE TABLE "smt_feeder_load" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"container_id" uuid NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"loaded_by" text NOT NULL,
	"unloaded_at" timestamp with time zone,
	"unloaded_by" text
);
--> statement-breakpoint
CREATE TABLE "smt_panel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"code" text NOT NULL,
	"placed_at" timestamp with time zone,
	"placed_by" text,
	"machine_id" uuid,
	"depaneled_at" timestamp with time zone,
	"depaneled_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "paste_thaw_minutes" integer;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "paste_open_hours" integer;--> statement-breakpoint
ALTER TABLE "bom" ADD COLUMN "boards_per_panel" integer;--> statement-breakpoint
ALTER TABLE "label_printer" ADD CONSTRAINT "label_printer_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_printer" ADD CONSTRAINT "label_printer_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_printer" ADD CONSTRAINT "label_printer_edge_id_iot_edge_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."iot_edge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_printer" ADD CONSTRAINT "label_printer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_printer_id_label_printer_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."label_printer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_board" ADD CONSTRAINT "smt_board_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_board" ADD CONSTRAINT "smt_board_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_board" ADD CONSTRAINT "smt_board_panel_id_smt_panel_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."smt_panel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_board" ADD CONSTRAINT "smt_board_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_board" ADD CONSTRAINT "smt_board_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_board" ADD CONSTRAINT "smt_board_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_board" ADD CONSTRAINT "smt_board_scrapped_by_user_id_fk" FOREIGN KEY ("scrapped_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container" ADD CONSTRAINT "smt_container_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container" ADD CONSTRAINT "smt_container_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container" ADD CONSTRAINT "smt_container_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container" ADD CONSTRAINT "smt_container_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container" ADD CONSTRAINT "smt_container_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container" ADD CONSTRAINT "smt_container_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container_event" ADD CONSTRAINT "smt_container_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container_event" ADD CONSTRAINT "smt_container_event_container_id_smt_container_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."smt_container"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_container_event" ADD CONSTRAINT "smt_container_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_feeder_load" ADD CONSTRAINT "smt_feeder_load_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_feeder_load" ADD CONSTRAINT "smt_feeder_load_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_feeder_load" ADD CONSTRAINT "smt_feeder_load_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_feeder_load" ADD CONSTRAINT "smt_feeder_load_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_feeder_load" ADD CONSTRAINT "smt_feeder_load_container_id_smt_container_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."smt_container"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_feeder_load" ADD CONSTRAINT "smt_feeder_load_loaded_by_user_id_fk" FOREIGN KEY ("loaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_feeder_load" ADD CONSTRAINT "smt_feeder_load_unloaded_by_user_id_fk" FOREIGN KEY ("unloaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_panel" ADD CONSTRAINT "smt_panel_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_panel" ADD CONSTRAINT "smt_panel_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_panel" ADD CONSTRAINT "smt_panel_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_panel" ADD CONSTRAINT "smt_panel_placed_by_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_panel" ADD CONSTRAINT "smt_panel_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_panel" ADD CONSTRAINT "smt_panel_depaneled_by_user_id_fk" FOREIGN KEY ("depaneled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smt_panel" ADD CONSTRAINT "smt_panel_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "label_printer_code_uq" ON "label_printer" USING btree ("entity_id","code");--> statement-breakpoint
CREATE INDEX "print_job_printer_status_idx" ON "print_job" USING btree ("printer_id","status","created_at");--> statement-breakpoint
CREATE INDEX "print_job_source_idx" ON "print_job" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "smt_board_serial_uq" ON "smt_board" USING btree ("item_id","serial_no");--> statement-breakpoint
CREATE UNIQUE INDEX "smt_board_panel_pos_uq" ON "smt_board" USING btree ("panel_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "smt_board_batch_uq" ON "smt_board" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "smt_board_wo_idx" ON "smt_board" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "smt_container_code_uq" ON "smt_container" USING btree ("entity_id","code");--> statement-breakpoint
CREATE INDEX "smt_container_batch_idx" ON "smt_container" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "smt_container_event_container_idx" ON "smt_container_event" USING btree ("container_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "smt_feeder_slot_uq" ON "smt_feeder_load" USING btree ("work_order_id","machine_id","slot") WHERE "smt_feeder_load"."unloaded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "smt_feeder_container_uq" ON "smt_feeder_load" USING btree ("container_id") WHERE "smt_feeder_load"."unloaded_at" is null;--> statement-breakpoint
CREATE INDEX "smt_feeder_wo_idx" ON "smt_feeder_load" USING btree ("work_order_id","loaded_at");--> statement-breakpoint
CREATE INDEX "smt_feeder_container_idx" ON "smt_feeder_load" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "smt_panel_code_uq" ON "smt_panel" USING btree ("entity_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "smt_panel_wo_seq_uq" ON "smt_panel" USING btree ("work_order_id","seq");--> statement-breakpoint
ALTER TABLE "bom" ADD CONSTRAINT "bom_boards_per_panel_ck" CHECK ("bom"."boards_per_panel" is null or "bom"."boards_per_panel" between 1 and 100);--> statement-breakpoint
CREATE OR REPLACE FUNCTION smt_container_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reel and paste events are kept as recorded';
END;
$$;--> statement-breakpoint
CREATE TRIGGER smt_container_event_append_only BEFORE UPDATE OR DELETE ON "smt_container_event" FOR EACH ROW EXECUTE FUNCTION smt_container_event_append_only();
