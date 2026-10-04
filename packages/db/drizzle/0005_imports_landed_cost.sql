CREATE TYPE "public"."allocation_basis" AS ENUM('value', 'qty', 'weight');--> statement-breakpoint
CREATE TYPE "public"."landed_charge_type" AS ENUM('bcd', 'sws', 'other_duty', 'freight', 'insurance', 'clearing', 'port', 'other');--> statement-breakpoint
CREATE TABLE "landed_cost_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_cost_charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"charge_type" "landed_charge_type" NOT NULL,
	"description" text,
	"party_id" uuid,
	"document_no" text,
	"amount" numeric(18, 2) NOT NULL,
	"basis" "allocation_basis" DEFAULT 'value' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_cost_layer_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	"qty_remaining" numeric(24, 6) NOT NULL,
	"old_rate" numeric(24, 6) NOT NULL,
	"new_rate" numeric(24, 6) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"on_hand_value" numeric(24, 6) NOT NULL,
	"variance_value" numeric(24, 6) NOT NULL,
	"ledger_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "landed_cost_receipt" (
	"voucher_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_cost_voucher" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"posting_date" date NOT NULL,
	"boe_no" text,
	"boe_date" date,
	"port_code" text,
	"customs_exchange_rate" numeric(18, 6),
	"assessable_value" numeric(18, 2),
	"import_igst" numeric(18, 2),
	"import_cess" numeric(18, 2),
	"remarks" text,
	"total_charges" numeric(18, 2),
	"on_hand_value" numeric(18, 2),
	"variance_value" numeric(18, 2),
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "landed_cost_allocation" ADD CONSTRAINT "landed_cost_allocation_voucher_id_landed_cost_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."landed_cost_voucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocation" ADD CONSTRAINT "landed_cost_allocation_charge_id_landed_cost_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."landed_cost_charge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocation" ADD CONSTRAINT "landed_cost_allocation_receipt_line_id_stock_entry_line_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."stock_entry_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocation" ADD CONSTRAINT "landed_cost_allocation_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_allocation" ADD CONSTRAINT "landed_cost_allocation_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_charge" ADD CONSTRAINT "landed_cost_charge_voucher_id_landed_cost_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."landed_cost_voucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_charge" ADD CONSTRAINT "landed_cost_charge_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_layer_change" ADD CONSTRAINT "landed_cost_layer_change_voucher_id_landed_cost_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."landed_cost_voucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_layer_change" ADD CONSTRAINT "landed_cost_layer_change_receipt_line_id_stock_entry_line_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."stock_entry_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_receipt" ADD CONSTRAINT "landed_cost_receipt_voucher_id_landed_cost_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."landed_cost_voucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_receipt" ADD CONSTRAINT "landed_cost_receipt_receipt_id_stock_entry_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher" ADD CONSTRAINT "landed_cost_voucher_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher" ADD CONSTRAINT "landed_cost_voucher_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher" ADD CONSTRAINT "landed_cost_voucher_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher" ADD CONSTRAINT "landed_cost_voucher_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher" ADD CONSTRAINT "landed_cost_voucher_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "landed_cost_allocation_voucher_idx" ON "landed_cost_allocation" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "landed_cost_charge_voucher_idx" ON "landed_cost_charge" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "landed_cost_layer_change_layer_idx" ON "landed_cost_layer_change" USING btree ("layer_id");--> statement-breakpoint
CREATE INDEX "landed_cost_layer_change_voucher_idx" ON "landed_cost_layer_change" USING btree ("voucher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "landed_cost_receipt_uq" ON "landed_cost_receipt" USING btree ("voucher_id","receipt_id");--> statement-breakpoint
CREATE INDEX "landed_cost_receipt_receipt_idx" ON "landed_cost_receipt" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "landed_cost_voucher_entity_number_uq" ON "landed_cost_voucher" USING btree ("entity_id","number");