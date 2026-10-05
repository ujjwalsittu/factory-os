CREATE TABLE "party_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"draft" jsonb NOT NULL,
	"on_account_bill_id" uuid,
	"voucher_id" uuid
);
--> statement-breakpoint
CREATE TABLE "settlement_allocation_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"settlement_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"voucher_id" uuid
);
--> statement-breakpoint
CREATE TABLE "settlement_allocation_effect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"allocation_document_id" uuid,
	"bill_id" uuid NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"carrying_inr" numeric(24, 6) NOT NULL,
	"source_carrying_inr" numeric(24, 6) NOT NULL,
	"posting_date" date NOT NULL,
	"reversal_of" uuid,
	CONSTRAINT "settlement_effect_nonzero_ck" CHECK ("settlement_allocation_effect"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "trade_bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"side" text NOT NULL,
	"account_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"origin_key" text NOT NULL,
	"currency" text NOT NULL,
	"recognition_date" date NOT NULL,
	"due_date" date,
	"msme_category" text,
	CONSTRAINT "trade_bill_side_ck" CHECK ("trade_bill"."side" in ('receivable','payable'))
);
--> statement-breakpoint
CREATE TABLE "trade_bill_effect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"origin_key" text NOT NULL,
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
	"version" integer NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_on_account_bill_id_trade_bill_id_fk" FOREIGN KEY ("on_account_bill_id") REFERENCES "public"."trade_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_document" ADD CONSTRAINT "settlement_allocation_document_settlement_id_party_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."party_settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_effect" ADD CONSTRAINT "settlement_allocation_effect_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_effect" ADD CONSTRAINT "settlement_allocation_effect_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_effect" ADD CONSTRAINT "settlement_allocation_effect_settlement_id_party_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."party_settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_effect" ADD CONSTRAINT "settlement_allocation_effect_allocation_document_id_settlement_allocation_document_id_fk" FOREIGN KEY ("allocation_document_id") REFERENCES "public"."settlement_allocation_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocation_effect" ADD CONSTRAINT "settlement_allocation_effect_bill_id_trade_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."trade_bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
CREATE UNIQUE INDEX "settlement_allocation_number_uq" ON "settlement_allocation_document" USING btree ("entity_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_effect_reversal_uq" ON "settlement_allocation_effect" USING btree ("reversal_of");--> statement-breakpoint
CREATE INDEX "settlement_effect_bill_idx" ON "settlement_allocation_effect" USING btree ("entity_id","bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_bill_origin_uq" ON "trade_bill" USING btree ("entity_id","source_type","source_id","origin_key");--> statement-breakpoint
CREATE INDEX "trade_bill_party_idx" ON "trade_bill" USING btree ("entity_id","party_id","side");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_effect_origin_uq" ON "trade_bill_effect" USING btree ("entity_id","source_type","source_id","origin_key");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_effect_reversal_uq" ON "trade_bill_effect" USING btree ("reversal_of");--> statement-breakpoint
CREATE INDEX "trade_effect_bill_idx" ON "trade_bill_effect" USING btree ("entity_id","bill_id","posting_date");
--> statement-breakpoint
CREATE TRIGGER trade_bill_immutable BEFORE UPDATE OR DELETE ON trade_bill FOR EACH ROW EXECUTE FUNCTION protect_accounting_ledger();

--> statement-breakpoint
CREATE TRIGGER trade_bill_effect_immutable BEFORE UPDATE OR DELETE ON trade_bill_effect FOR EACH ROW EXECUTE FUNCTION protect_accounting_ledger();

--> statement-breakpoint
CREATE TRIGGER settlement_allocation_effect_immutable BEFORE UPDATE OR DELETE ON settlement_allocation_effect FOR EACH ROW EXECUTE FUNCTION protect_accounting_ledger();
