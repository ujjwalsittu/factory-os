ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'purchase_return';--> statement-breakpoint
ALTER TYPE "public"."stock_entry_purpose" ADD VALUE 'purchase_return_receipt';--> statement-breakpoint
CREATE TABLE "supplier_acceptance_effect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"claim_line_id" uuid NOT NULL,
	"note_line_id" uuid NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"taxable_amount" numeric(24, 6) NOT NULL,
	"pending_value_inr" numeric(24, 6) DEFAULT '0' NOT NULL,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"kind" text NOT NULL,
	"tax_treatment" text NOT NULL,
	"supplier_note_no" text NOT NULL,
	"supplier_note_date" date NOT NULL,
	"supplier_fy" text NOT NULL,
	"posting_date" date NOT NULL,
	"reason" text NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(24, 6) NOT NULL,
	"tax_eligibility_confirmed" boolean DEFAULT false NOT NULL,
	"snapshots" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy_snapshot" jsonb,
	"taxable_value" numeric(24, 6) DEFAULT '0' NOT NULL,
	"cgst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"sgst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"igst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"cess" numeric(24, 6) DEFAULT '0' NOT NULL,
	"grand_total" numeric(24, 6) DEFAULT '0' NOT NULL,
	"bill_id" uuid,
	"voucher_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "supplier_note_values" CHECK ("supplier_note"."kind" in ('credit','debit') and "supplier_note"."tax_treatment" in ('gst','commercial') and "supplier_note"."exchange_rate">0)
);
--> statement-breakpoint
CREATE TABLE "supplier_note_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"claim_line_id" uuid,
	"line_no" integer NOT NULL,
	"mode" text NOT NULL,
	"qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"taxable_amount" numeric(24, 6) NOT NULL,
	"cgst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"sgst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"igst" numeric(24, 6) DEFAULT '0' NOT NULL,
	"cess" numeric(24, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "supplier_note_line_values" CHECK ("supplier_note_line"."mode" in ('quantity','value') and "supplier_note_line"."qty">=0 and "supplier_note_line"."taxable_amount">0)
);
--> statement-breakpoint
CREATE TABLE "supplier_resolution_effect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"claim_line_id" uuid NOT NULL,
	"return_effect_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"value_inr" numeric(24, 6) NOT NULL,
	"posting_date" date NOT NULL,
	"reason" text NOT NULL,
	"stock_entry_id" uuid,
	"voucher_id" uuid,
	"created_by" text NOT NULL,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_resolution_kind" CHECK ("supplier_resolution_effect"."kind" in ('write_off','receive_back','acceptance_reversal'))
);
--> statement-breakpoint
CREATE TABLE "supplier_return_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"posting_date" date NOT NULL,
	"reason" text NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(24, 6) NOT NULL,
	"policy_snapshot" jsonb,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"approval_reason" text,
	"snapshots" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "supplier_claim_rate" CHECK ("supplier_return_claim"."exchange_rate">0)
);
--> statement-breakpoint
CREATE TABLE "supplier_return_claim_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"taxable_amount" numeric(24, 6) NOT NULL,
	CONSTRAINT "supplier_claim_line_amount" CHECK ("supplier_return_claim_line"."qty">=0 and "supplier_return_claim_line"."taxable_amount">=0 and ("supplier_return_claim_line"."qty">0 or "supplier_return_claim_line"."taxable_amount">0))
);
--> statement-breakpoint
CREATE TABLE "supplier_return_effect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"claim_line_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"receipt_allocation_id" uuid NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"stock_entry_id" uuid NOT NULL,
	"ledger_seq" bigint NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"value_inr" numeric(24, 6) NOT NULL,
	"consumptions" jsonb NOT NULL,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_return_policy" (
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"dispatch_approval" text DEFAULT 'pending_allowed' NOT NULL,
	"claim_approval" text DEFAULT 'every' NOT NULL,
	"approval_threshold_inr" numeric(24, 6) DEFAULT '0' NOT NULL,
	"credit_application" text DEFAULT 'automatic' NOT NULL,
	"rejected_action" text DEFAULT 'keep_open' NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_policy_values" CHECK ("supplier_return_policy"."dispatch_approval" in ('pending_allowed','acceptance_required') and "supplier_return_policy"."claim_approval" in ('every','above_threshold') and "supplier_return_policy"."approval_threshold_inr">=0 and "supplier_return_policy"."credit_application" in ('automatic','manual') and "supplier_return_policy"."rejected_action" in ('keep_open','request_back','propose_write_off'))
);
--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" DROP CONSTRAINT "settlement_allocation_source";--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD COLUMN "supplier_note_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_acceptance_reversal_uq" ON "supplier_acceptance_effect" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_note_scope_uq" ON "supplier_note" USING btree ("id","tenant_id","entity_id","original_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_note_reference_uq" ON "supplier_note" USING btree ("entity_id","supplier_id","kind","supplier_fy",upper("supplier_note_no")) WHERE "supplier_note"."status"='submitted';--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_note_line_scope_uq" ON "supplier_note_line" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_note_line_source_uq" ON "supplier_note_line" USING btree ("note_id","invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_resolution_reversal_uq" ON "supplier_resolution_effect" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_claim_scope_uq" ON "supplier_return_claim" USING btree ("id","tenant_id","entity_id","original_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_claim_number_uq" ON "supplier_return_claim" USING btree ("entity_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_claim_line_scope_uq" ON "supplier_return_claim_line" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_claim_line_source_uq" ON "supplier_return_claim_line" USING btree ("claim_id","invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_return_effect_scope_uq" ON "supplier_return_effect" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_return_reversal_uq" ON "supplier_return_effect" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_return_policy_entity_uq" ON "supplier_return_policy" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_scope_uq" ON "purchase_invoice" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_line_identity_uq" ON "purchase_invoice_line" USING btree ("id","invoice_id");--> statement-breakpoint
ALTER TABLE "supplier_acceptance_effect" ADD CONSTRAINT "supplier_acceptance_effect_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_acceptance_effect" ADD CONSTRAINT "supplier_acceptance_effect_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_acceptance_effect" ADD CONSTRAINT "supplier_acceptance_claim_fk" FOREIGN KEY ("claim_line_id","tenant_id","entity_id") REFERENCES "public"."supplier_return_claim_line"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_acceptance_effect" ADD CONSTRAINT "supplier_acceptance_note_fk" FOREIGN KEY ("note_line_id","tenant_id","entity_id") REFERENCES "public"."supplier_note_line"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD CONSTRAINT "supplier_note_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD CONSTRAINT "supplier_note_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD CONSTRAINT "supplier_note_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD CONSTRAINT "supplier_note_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD CONSTRAINT "supplier_note_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD CONSTRAINT "supplier_note_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD CONSTRAINT "supplier_note_invoice_scope_fk" FOREIGN KEY ("original_invoice_id","tenant_id","entity_id") REFERENCES "public"."purchase_invoice"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note_line" ADD CONSTRAINT "supplier_note_line_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note_line" ADD CONSTRAINT "supplier_note_line_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note_line" ADD CONSTRAINT "supplier_note_line_note_fk" FOREIGN KEY ("note_id","tenant_id","entity_id","original_invoice_id") REFERENCES "public"."supplier_note"("id","tenant_id","entity_id","original_invoice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note_line" ADD CONSTRAINT "supplier_note_line_original_fk" FOREIGN KEY ("invoice_line_id","original_invoice_id") REFERENCES "public"."purchase_invoice_line"("id","invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_note_line" ADD CONSTRAINT "supplier_note_line_claim_fk" FOREIGN KEY ("claim_line_id","tenant_id","entity_id") REFERENCES "public"."supplier_return_claim_line"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_resolution_effect" ADD CONSTRAINT "supplier_resolution_effect_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_resolution_effect" ADD CONSTRAINT "supplier_resolution_effect_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_resolution_effect" ADD CONSTRAINT "supplier_resolution_effect_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_resolution_effect" ADD CONSTRAINT "supplier_resolution_effect_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_resolution_effect" ADD CONSTRAINT "supplier_resolution_claim_fk" FOREIGN KEY ("claim_line_id","tenant_id","entity_id") REFERENCES "public"."supplier_return_claim_line"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_resolution_effect" ADD CONSTRAINT "supplier_resolution_return_fk" FOREIGN KEY ("return_effect_id","tenant_id","entity_id") REFERENCES "public"."supplier_return_effect"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim" ADD CONSTRAINT "supplier_return_claim_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim" ADD CONSTRAINT "supplier_return_claim_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim" ADD CONSTRAINT "supplier_return_claim_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim" ADD CONSTRAINT "supplier_return_claim_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim" ADD CONSTRAINT "supplier_return_claim_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim" ADD CONSTRAINT "supplier_return_claim_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim" ADD CONSTRAINT "supplier_return_claim_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim" ADD CONSTRAINT "supplier_claim_invoice_scope_fk" FOREIGN KEY ("original_invoice_id","tenant_id","entity_id") REFERENCES "public"."purchase_invoice"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim_line" ADD CONSTRAINT "supplier_return_claim_line_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim_line" ADD CONSTRAINT "supplier_return_claim_line_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim_line" ADD CONSTRAINT "supplier_claim_line_claim_fk" FOREIGN KEY ("claim_id","tenant_id","entity_id","original_invoice_id") REFERENCES "public"."supplier_return_claim"("id","tenant_id","entity_id","original_invoice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_claim_line" ADD CONSTRAINT "supplier_claim_line_invoice_line_fk" FOREIGN KEY ("invoice_line_id","original_invoice_id") REFERENCES "public"."purchase_invoice_line"("id","invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_effect" ADD CONSTRAINT "supplier_return_effect_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_effect" ADD CONSTRAINT "supplier_return_effect_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_effect" ADD CONSTRAINT "supplier_return_effect_receipt_allocation_id_receipt_invoice_allocation_id_fk" FOREIGN KEY ("receipt_allocation_id") REFERENCES "public"."receipt_invoice_allocation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_effect" ADD CONSTRAINT "supplier_return_effect_receipt_line_id_stock_entry_line_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."stock_entry_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_effect" ADD CONSTRAINT "supplier_return_effect_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_effect" ADD CONSTRAINT "supplier_return_effect_ledger_seq_stock_ledger_entry_seq_fk" FOREIGN KEY ("ledger_seq") REFERENCES "public"."stock_ledger_entry"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_effect" ADD CONSTRAINT "supplier_return_effect_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_effect" ADD CONSTRAINT "supplier_return_claim_line_fk" FOREIGN KEY ("claim_line_id","tenant_id","entity_id") REFERENCES "public"."supplier_return_claim_line"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_policy" ADD CONSTRAINT "supplier_return_policy_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_policy" ADD CONSTRAINT "supplier_return_policy_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_policy" ADD CONSTRAINT "supplier_return_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_return_claim_idx" ON "supplier_return_effect" USING btree ("entity_id","claim_line_id");--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_supplier_note_id_supplier_note_id_fk" FOREIGN KEY ("supplier_note_id") REFERENCES "public"."supplier_note"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_source" CHECK (num_nonnulls("settlement_allocation_document"."settlement_id","settlement_allocation_document"."credit_note_id","settlement_allocation_document"."supplier_note_id")=1);
--> statement-breakpoint
CREATE TRIGGER supplier_return_effect_immutable BEFORE UPDATE OR DELETE ON supplier_return_effect FOR EACH ROW EXECUTE FUNCTION trade_evidence_immutable();

--> statement-breakpoint
CREATE TRIGGER supplier_acceptance_effect_immutable BEFORE UPDATE OR DELETE ON supplier_acceptance_effect FOR EACH ROW EXECUTE FUNCTION trade_evidence_immutable();

--> statement-breakpoint
CREATE TRIGGER supplier_resolution_effect_immutable BEFORE UPDATE OR DELETE ON supplier_resolution_effect FOR EACH ROW EXECUTE FUNCTION trade_evidence_immutable();
