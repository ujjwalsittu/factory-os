CREATE TABLE "account_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"root" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_settings" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"cutover_date" date,
	"activated_at" timestamp with time zone,
	"activated_by" text,
	"opening_voucher_id" uuid,
	"mappings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acquisition_cost_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	"old_rate" numeric(24, 6) NOT NULL,
	"new_rate" numeric(24, 6) NOT NULL,
	"qty_remaining" numeric(24, 6) NOT NULL,
	"on_hand" numeric(24, 6) NOT NULL,
	"consumed" numeric(24, 6) NOT NULL,
	"stock_ledger_seq" numeric(30, 0),
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gl_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"group_id" uuid NOT NULL,
	"role" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_disposition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"voucher_id" uuid,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"debit" numeric(24, 6) NOT NULL,
	"credit" numeric(24, 6) NOT NULL,
	"party_id" uuid,
	"bill_reference" text,
	"gst_registration_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_one_positive_side" CHECK (("gl_entry"."debit" > 0 and "gl_entry"."credit" = 0) or ("gl_entry"."credit" > 0 and "gl_entry"."debit" = 0))
);
--> statement-breakpoint
CREATE TABLE "journal_voucher" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"posting_date" date NOT NULL,
	"narration" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"purpose" text DEFAULT 'main' NOT NULL,
	"source_number" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"exchange_rate" numeric(24, 6) DEFAULT '1' NOT NULL,
	"draft_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "opening_worksheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receipt_baselines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settlements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_snapshot" jsonb,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_invoice_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"base_cost" numeric(24, 6) NOT NULL,
	"po_rate" numeric(24, 6) NOT NULL,
	"po_exchange_rate" numeric(24, 6) NOT NULL,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_group" ADD CONSTRAINT "account_group_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group" ADD CONSTRAINT "account_group_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_activated_by_user_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_cost_change" ADD CONSTRAINT "acquisition_cost_change_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_cost_change" ADD CONSTRAINT "acquisition_cost_change_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_account" ADD CONSTRAINT "gl_account_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_account" ADD CONSTRAINT "gl_account_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_account" ADD CONSTRAINT "gl_account_group_id_account_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_disposition" ADD CONSTRAINT "gl_disposition_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_disposition" ADD CONSTRAINT "gl_disposition_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_disposition" ADD CONSTRAINT "gl_disposition_voucher_id_journal_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."journal_voucher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entry" ADD CONSTRAINT "gl_entry_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entry" ADD CONSTRAINT "gl_entry_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entry" ADD CONSTRAINT "gl_entry_voucher_id_journal_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."journal_voucher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entry" ADD CONSTRAINT "gl_entry_account_id_gl_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entry" ADD CONSTRAINT "gl_entry_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_voucher" ADD CONSTRAINT "journal_voucher_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_voucher" ADD CONSTRAINT "journal_voucher_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_voucher" ADD CONSTRAINT "journal_voucher_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_worksheet" ADD CONSTRAINT "opening_worksheet_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_worksheet" ADD CONSTRAINT "opening_worksheet_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_worksheet" ADD CONSTRAINT "opening_worksheet_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_invoice_allocation" ADD CONSTRAINT "receipt_invoice_allocation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_invoice_allocation" ADD CONSTRAINT "receipt_invoice_allocation_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_group_entity_key_uq" ON "account_group" USING btree ("entity_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "account_entity_code_uq" ON "gl_account" USING btree ("entity_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "account_entity_role_uq" ON "gl_account" USING btree ("entity_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_disposition_source_uq" ON "gl_disposition" USING btree ("entity_id","source_type","source_id","purpose");--> statement-breakpoint
CREATE INDEX "gl_entity_account_date_idx" ON "gl_entry" USING btree ("entity_id","account_id","posting_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_source_purpose_uq" ON "journal_voucher" USING btree ("entity_id","source_type","source_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_reversal_uq" ON "journal_voucher" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_number_uq" ON "journal_voucher" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "journal_entity_date_idx" ON "journal_voucher" USING btree ("entity_id","posting_date");--> statement-breakpoint
CREATE UNIQUE INDEX "opening_worksheet_entity_uq" ON "opening_worksheet" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "receipt_allocation_source_idx" ON "receipt_invoice_allocation" USING btree ("entity_id","receipt_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_allocation_reversal_uq" ON "receipt_invoice_allocation" USING btree ("reversal_of");
--> statement-breakpoint
CREATE FUNCTION protect_accounting_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Accounting ledger rows are append-only'; END $$;
--> statement-breakpoint
CREATE TRIGGER gl_entry_immutable BEFORE UPDATE OR DELETE ON gl_entry FOR EACH ROW EXECUTE FUNCTION protect_accounting_ledger();
--> statement-breakpoint
CREATE TRIGGER receipt_allocation_immutable BEFORE UPDATE OR DELETE ON receipt_invoice_allocation FOR EACH ROW EXECUTE FUNCTION protect_accounting_ledger();
--> statement-breakpoint
CREATE TRIGGER gl_disposition_immutable BEFORE UPDATE OR DELETE ON gl_disposition FOR EACH ROW EXECUTE FUNCTION protect_accounting_ledger();
