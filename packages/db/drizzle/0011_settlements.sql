CREATE TABLE "party_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"direction" text NOT NULL,
	"party_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"exchange_rate" numeric(24, 6) DEFAULT '1' NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"bank_reference" text,
	"narration" text,
	"allocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"advance_bill_id" uuid,
	"voucher_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "party_settlement_direction" CHECK ("party_settlement"."direction" in ('receipt', 'payment')),
	CONSTRAINT "party_settlement_amount" CHECK ("party_settlement"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_allocation_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"settlement_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"reason" text NOT NULL,
	"allocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voucher_id" uuid,
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
CREATE TABLE "trade_bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"side" text NOT NULL,
	"kind" text DEFAULT 'bill' NOT NULL,
	"party_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"origin_key" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"original_amount" numeric(24, 6) NOT NULL,
	"recognition_date" date NOT NULL,
	"due_date" date,
	"msme_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_bill_side" CHECK ("trade_bill"."side" in ('receivable', 'payable')),
	CONSTRAINT "trade_bill_kind" CHECK ("trade_bill"."kind" in ('bill', 'advance', 'journal_credit'))
);
--> statement-breakpoint
CREATE TABLE "trade_bill_effect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"origin_key" text NOT NULL,
	"gl_entry_id" uuid,
	"posting_date" date NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"carrying_inr" numeric(24, 6) NOT NULL,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_subledger_state" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_account_id_gl_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_settlement_id_party_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."party_settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_bill" ADD CONSTRAINT "trade_bill_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_bill" ADD CONSTRAINT "trade_bill_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_bill" ADD CONSTRAINT "trade_bill_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_bill" ADD CONSTRAINT "trade_bill_account_id_gl_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_bill_effect" ADD CONSTRAINT "trade_bill_effect_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_bill_effect" ADD CONSTRAINT "trade_bill_effect_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_bill_effect" ADD CONSTRAINT "trade_bill_effect_bill_id_trade_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."trade_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_subledger_state" ADD CONSTRAINT "trade_subledger_state_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_subledger_state" ADD CONSTRAINT "trade_subledger_state_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_settlement_number_uq" ON "party_settlement" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "party_settlement_party_idx" ON "party_settlement" USING btree ("entity_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_allocation_number_uq" ON "settlement_allocation_document" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "settlement_allocation_source_idx" ON "settlement_allocation_document" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_bill_origin_uq" ON "trade_bill" USING btree ("entity_id","origin_key");--> statement-breakpoint
CREATE INDEX "trade_bill_party_idx" ON "trade_bill" USING btree ("entity_id","side","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_bill_effect_origin_uq" ON "trade_bill_effect" USING btree ("entity_id","origin_key");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_bill_effect_reversal_uq" ON "trade_bill_effect" USING btree ("reversal_of");--> statement-breakpoint
CREATE INDEX "trade_bill_effect_bill_idx" ON "trade_bill_effect" USING btree ("bill_id","posting_date");--> statement-breakpoint
CREATE INDEX "trade_bill_effect_source_idx" ON "trade_bill_effect" USING btree ("entity_id","source_type","source_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION trade_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trade bills and their effects are append-only (%)', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER trade_bill_immutable BEFORE UPDATE OR DELETE ON "trade_bill" FOR EACH ROW EXECUTE FUNCTION trade_evidence_immutable();--> statement-breakpoint
CREATE TRIGGER trade_bill_effect_immutable BEFORE UPDATE OR DELETE ON "trade_bill_effect" FOR EACH ROW EXECUTE FUNCTION trade_evidence_immutable();
