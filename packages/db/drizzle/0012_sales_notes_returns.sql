ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'sales_return';--> statement-breakpoint
CREATE TABLE "sales_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"tax_treatment" text NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"gst_registration_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"due_date" date,
	"reason" text NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(24, 6) NOT NULL,
	"supply_type" text NOT NULL,
	"place_of_supply_state_code" text,
	"customer_name" text,
	"customer_gstin" text,
	"billing_address" jsonb,
	"shipping_address" jsonb,
	"lut_arn" text,
	"tax_eligibility_confirmed" boolean DEFAULT false NOT NULL,
	"tax_eligibility_actor" text,
	"taxable_value" numeric(24, 6) DEFAULT '0' NOT NULL,
	"cgst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"sgst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"igst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"cess" numeric(24, 6) DEFAULT '0' NOT NULL,
	"grand_total" numeric(24, 6) DEFAULT '0' NOT NULL,
	"bill_id" uuid,
	"voucher_id" uuid,
	"stock_entry_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "sales_note_kind" CHECK ("sales_note"."kind" in ('credit','debit')),
	CONSTRAINT "sales_note_tax_treatment" CHECK ("sales_note"."tax_treatment" in ('gst','commercial')),
	CONSTRAINT "sales_note_rate" CHECK ("sales_note"."exchange_rate">0)
);
--> statement-breakpoint
CREATE TABLE "sales_note_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"mode" text NOT NULL,
	"qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"taxable_amount" numeric(24, 6) NOT NULL,
	"return_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"warehouse_id" uuid,
	"taxable_value" numeric(24, 6) NOT NULL,
	"cgst" numeric(24, 6) NOT NULL,
	"sgst" numeric(24, 6) NOT NULL,
	"igst" numeric(24, 6) NOT NULL,
	"cess" numeric(24, 6) NOT NULL,
	"return_value_inr" numeric(24, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_note_line_mode" CHECK ("sales_note_line"."mode" in ('quantity','value')),
	CONSTRAINT "sales_note_line_positive" CHECK ("sales_note_line"."taxable_amount">0 and "sales_note_line"."qty">=0 and "sales_note_line"."return_qty">=0)
);
--> statement-breakpoint
CREATE TABLE "sales_return_effect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"note_line_id" uuid NOT NULL,
	"original_ledger_seq" bigint NOT NULL,
	"original_qty" numeric(24, 6) NOT NULL,
	"original_value" numeric(24, 6) NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"value" numeric(24, 6) NOT NULL,
	"inbound_ledger_seq" bigint NOT NULL,
	"layer_id" uuid NOT NULL,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ALTER COLUMN "settlement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD COLUMN "credit_note_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_note_gstin_number_uq" ON "sales_note" USING btree ("gst_registration_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_note_identity_scope_uq" ON "sales_note" USING btree ("id","tenant_id","entity_id","original_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_note_line_source_uq" ON "sales_note_line" USING btree ("note_id","invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_return_effect_reversal_uq" ON "sales_return_effect" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_identity_scope_uq" ON "sales_invoice" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_line_identity_uq" ON "sales_invoice_line" USING btree ("id","invoice_id");--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_gst_registration_id_gst_registration_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_tax_eligibility_actor_user_id_fk" FOREIGN KEY ("tax_eligibility_actor") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note" ADD CONSTRAINT "sales_note_original_invoice_id_tenant_id_entity_id_sales_invoice_id_tenant_id_entity_id_fk" FOREIGN KEY ("original_invoice_id","tenant_id","entity_id") REFERENCES "public"."sales_invoice"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note_line" ADD CONSTRAINT "sales_note_line_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note_line" ADD CONSTRAINT "sales_note_line_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note_line" ADD CONSTRAINT "sales_note_line_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note_line" ADD CONSTRAINT "sales_note_line_note_id_tenant_id_entity_id_original_invoice_id_sales_note_id_tenant_id_entity_id_original_invoice_id_fk" FOREIGN KEY ("note_id","tenant_id","entity_id","original_invoice_id") REFERENCES "public"."sales_note"("id","tenant_id","entity_id","original_invoice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_note_line" ADD CONSTRAINT "sales_note_line_invoice_line_id_original_invoice_id_sales_invoice_line_id_invoice_id_fk" FOREIGN KEY ("invoice_line_id","original_invoice_id") REFERENCES "public"."sales_invoice_line"("id","invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_effect" ADD CONSTRAINT "sales_return_effect_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_effect" ADD CONSTRAINT "sales_return_effect_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_effect" ADD CONSTRAINT "sales_return_effect_note_id_sales_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."sales_note"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_effect" ADD CONSTRAINT "sales_return_effect_note_line_id_sales_note_line_id_fk" FOREIGN KEY ("note_line_id") REFERENCES "public"."sales_note_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_effect" ADD CONSTRAINT "sales_return_effect_original_ledger_seq_stock_ledger_entry_seq_fk" FOREIGN KEY ("original_ledger_seq") REFERENCES "public"."stock_ledger_entry"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_effect" ADD CONSTRAINT "sales_return_effect_inbound_ledger_seq_stock_ledger_entry_seq_fk" FOREIGN KEY ("inbound_ledger_seq") REFERENCES "public"."stock_ledger_entry"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_effect" ADD CONSTRAINT "sales_return_effect_layer_id_fifo_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."fifo_layer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_note_invoice_idx" ON "sales_note" USING btree ("entity_id","original_invoice_id");--> statement-breakpoint
CREATE INDEX "sales_note_line_note_idx" ON "sales_note_line" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "sales_return_effect_source_idx" ON "sales_return_effect" USING btree ("entity_id","original_ledger_seq");--> statement-breakpoint
CREATE INDEX "sales_return_effect_note_idx" ON "sales_return_effect" USING btree ("note_id");--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_credit_note_id_sales_note_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."sales_note"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_source" CHECK (num_nonnulls("settlement_allocation_document"."settlement_id","settlement_allocation_document"."credit_note_id")=1);--> statement-breakpoint
CREATE TRIGGER sales_return_effect_immutable BEFORE UPDATE OR DELETE ON sales_return_effect FOR EACH ROW EXECUTE FUNCTION trade_evidence_immutable();
