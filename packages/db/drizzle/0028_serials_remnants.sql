CREATE TYPE "public"."batch_kind" AS ENUM('lot', 'serial', 'remnant');--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'cut';--> statement-breakpoint
CREATE TABLE "serial_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"assembly_batch_id" uuid NOT NULL,
	"component_batch_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"stock_entry_id" uuid NOT NULL,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_counter" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "serial_prefix" text;--> statement-breakpoint
ALTER TABLE "batch" ADD COLUMN "kind" "batch_kind" DEFAULT 'lot' NOT NULL;--> statement-breakpoint
ALTER TABLE "batch" ADD COLUMN "length_mm" numeric(24, 6);--> statement-breakpoint
ALTER TABLE "serial_component" ADD CONSTRAINT "serial_component_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_component" ADD CONSTRAINT "serial_component_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_component" ADD CONSTRAINT "serial_component_assembly_batch_id_batch_id_fk" FOREIGN KEY ("assembly_batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_component" ADD CONSTRAINT "serial_component_component_batch_id_batch_id_fk" FOREIGN KEY ("component_batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_component" ADD CONSTRAINT "serial_component_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_component" ADD CONSTRAINT "serial_component_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_component" ADD CONSTRAINT "serial_component_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_counter" ADD CONSTRAINT "serial_counter_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_counter" ADD CONSTRAINT "serial_counter_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serial_component_assembly_idx" ON "serial_component" USING btree ("assembly_batch_id");--> statement-breakpoint
CREATE INDEX "serial_component_component_idx" ON "serial_component" USING btree ("component_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_component_reversal_uq" ON "serial_component" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_counter_item_uq" ON "serial_counter" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "batch_parent_idx" ON "batch" USING btree ("parent_batch_id");--> statement-breakpoint
CREATE TRIGGER serial_component_frozen BEFORE UPDATE OR DELETE ON serial_component FOR EACH ROW EXECUTE FUNCTION factoryos_manufacturing_evidence_frozen();
