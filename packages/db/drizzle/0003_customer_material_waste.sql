CREATE TYPE "public"."waste_category" AS ENUM('metal_swarf', 'metal_offcut', 'rejected_parts', 'metal_powder', 'e_waste', 'coolant_oil', 'solvent', 'packaging', 'other');--> statement-breakpoint
CREATE TYPE "public"."waste_disposal_method" AS ENUM('returned_to_customer', 'sold', 'authorised_recycler', 'tsdf', 'other');--> statement-breakpoint
CREATE TYPE "public"."waste_movement_kind" AS ENUM('generated', 'disposed');--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'return';--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'scrap';--> statement-breakpoint
CREATE TABLE "waste_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "waste_movement_kind" NOT NULL,
	"movement_date" date NOT NULL,
	"category" "waste_category" NOT NULL,
	"material" text NOT NULL,
	"item_id" uuid,
	"qty" numeric(24, 6) NOT NULL,
	"uom_id" uuid NOT NULL,
	"owner_party_id" uuid,
	"hazardous" boolean DEFAULT false NOT NULL,
	"warehouse_id" uuid,
	"source_ref" text,
	"stock_entry_id" uuid,
	"disposal_method" "waste_disposal_method",
	"counterparty_id" uuid,
	"document_no" text,
	"consent_ref" text,
	"remarks" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text
);
--> statement-breakpoint
ALTER TABLE "stock_bin" DROP CONSTRAINT "stock_bin_uq";--> statement-breakpoint
ALTER TABLE "stock_bin" ADD COLUMN "owner_party_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD COLUMN "owner_party_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD COLUMN "waste_category" text;--> statement-breakpoint
ALTER TABLE "stock_ledger_entry" ADD COLUMN "owner_party_id" uuid;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_owner_party_id_party_id_fk" FOREIGN KEY ("owner_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_counterparty_id_party_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_movement" ADD CONSTRAINT "waste_movement_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waste_entity_idx" ON "waste_movement" USING btree ("entity_id","category","owner_party_id");--> statement-breakpoint
CREATE INDEX "waste_stock_entry_idx" ON "waste_movement" USING btree ("stock_entry_id");--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_owner_party_id_party_id_fk" FOREIGN KEY ("owner_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sle_owner_idx" ON "stock_ledger_entry" USING btree ("entity_id","owner_party_id","posting_date");--> statement-breakpoint
ALTER TABLE "stock_bin" ADD CONSTRAINT "stock_bin_owner_uq" UNIQUE NULLS NOT DISTINCT("entity_id","item_id","warehouse_id","batch_id","owner_party_id");