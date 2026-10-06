CREATE TABLE "bank_adjustment_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"charge_id" uuid,
	"voucher_id" uuid,
	"snapshot" jsonb NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_adjustment_kind_ck" CHECK (("bank_adjustment_link"."kind"='charge' and "bank_adjustment_link"."charge_id" is not null and "bank_adjustment_link"."voucher_id" is null) or ("bank_adjustment_link"."kind"='journal' and "bank_adjustment_link"."voucher_id" is not null and "bank_adjustment_link"."charge_id" is null))
);
--> statement-breakpoint
CREATE TABLE "bank_duplicate_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"decision" text NOT NULL,
	"movement_id" uuid,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_duplicate_decision_ck" CHECK ("bank_duplicate_decision"."decision" in ('link','distinct') and length(trim("bank_duplicate_decision"."reason"))>0 and (("bank_duplicate_decision"."decision"='link')=("bank_duplicate_decision"."movement_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "bank_mapping_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_mapping_revision_ck" CHECK ("bank_mapping_revision"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "bank_match_edge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"gl_entry_id" uuid,
	"opening_item_id" uuid,
	"amount" numeric(24, 6) NOT NULL,
	"effective_date" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_edge_ck" CHECK ("bank_match_edge"."amount">0 and (("bank_match_edge"."gl_entry_id" is null)<>("bank_match_edge"."opening_item_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "bank_match_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"preview_hash" text NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_match_kind_ck" CHECK ("bank_match_group"."kind" in ('ordinary','net') and ("bank_match_group"."kind"<>'net' or length(trim("bank_match_group"."reason"))>0))
);
--> statement-breakpoint
CREATE TABLE "bank_net_vector" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"side" text NOT NULL,
	"movement_id" uuid,
	"gl_entry_id" uuid,
	"signed_amount" numeric(24, 6) NOT NULL,
	"effective_date" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_net_ck" CHECK ("bank_net_vector"."signed_amount"<>0 and (("bank_net_vector"."side"='bank' and "bank_net_vector"."movement_id" is not null and "bank_net_vector"."gl_entry_id" is null) or ("bank_net_vector"."side"='book' and "bank_net_vector"."gl_entry_id" is not null and "bank_net_vector"."movement_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "bank_opening_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"baseline_id" uuid NOT NULL,
	"gl_entry_id" uuid,
	"posting_date" date NOT NULL,
	"signed_amount" numeric(24, 6) NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_opening_amount_ck" CHECK ("bank_opening_item"."signed_amount"<>0)
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliation_baseline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"baseline_date" date NOT NULL,
	"book_balance" numeric(24, 6) NOT NULL,
	"bank_balance" numeric(24, 6) NOT NULL,
	"reference" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"preview_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliation_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"baseline_id" uuid,
	"import_id" uuid,
	"match_id" uuid,
	"period_id" uuid,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_event_kind_ck" CHECK (length(trim("bank_reconciliation_event"."reason"))>0 and (("bank_reconciliation_event"."kind"='baseline_reset' and "bank_reconciliation_event"."baseline_id" is not null and "bank_reconciliation_event"."import_id" is null and "bank_reconciliation_event"."match_id" is null and "bank_reconciliation_event"."period_id" is null) or ("bank_reconciliation_event"."kind"='import_reversal' and "bank_reconciliation_event"."import_id" is not null and "bank_reconciliation_event"."baseline_id" is null and "bank_reconciliation_event"."match_id" is null and "bank_reconciliation_event"."period_id" is null) or ("bank_reconciliation_event"."kind"='match_reversal' and "bank_reconciliation_event"."match_id" is not null and "bank_reconciliation_event"."baseline_id" is null and "bank_reconciliation_event"."import_id" is null and "bank_reconciliation_event"."period_id" is null) or ("bank_reconciliation_event"."kind"='period_reopen' and "bank_reconciliation_event"."period_id" is not null and "bank_reconciliation_event"."baseline_id" is null and "bank_reconciliation_event"."import_id" is null and "bank_reconciliation_event"."match_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliation_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"baseline_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"preview_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_period_interval_ck" CHECK ("bank_reconciliation_period"."start_date"<="bank_reconciliation_period"."end_date")
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliation_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"masked_identifier" text NOT NULL,
	"date_window" integer DEFAULT 7 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_profile_settings_ck" CHECK ("bank_reconciliation_profile"."currency"='INR' and "bank_reconciliation_profile"."date_window" between 0 and 30)
);
--> statement-breakpoint
CREATE TABLE "bank_statement_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"mapping_id" uuid NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"opening_balance" numeric(24, 6) NOT NULL,
	"closing_balance" numeric(24, 6) NOT NULL,
	"file_hash" text NOT NULL,
	"raw_csv" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"preview_hash" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_import_interval_ck" CHECK ("bank_statement_import"."start_date"<="bank_statement_import"."end_date")
);
--> statement-breakpoint
CREATE TABLE "bank_statement_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"original_import_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"transaction_id" text,
	"transaction_date" date NOT NULL,
	"signed_amount" numeric(24, 6) NOT NULL,
	"reference" text NOT NULL,
	"description" text NOT NULL,
	"signature" text NOT NULL,
	"raw_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "br_movement_ck" CHECK ("bank_statement_movement"."signed_amount"<>0 and "bank_statement_movement"."ordinal">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_adjustment_link_scope_uq" ON "bank_adjustment_link" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_adjustment_active_uq" ON "bank_adjustment_link" USING btree ("movement_id") WHERE "bank_adjustment_link"."released_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_duplicate_decision_scope_uq" ON "bank_duplicate_decision" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_duplicate_ordinal_uq" ON "bank_duplicate_decision" USING btree ("import_id","ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_mapping_revision_scope_uq" ON "bank_mapping_revision" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_mapping_revision_uq" ON "bank_mapping_revision" USING btree ("profile_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_match_edge_scope_uq" ON "bank_match_edge" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_match_group_scope_uq" ON "bank_match_group" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_net_vector_scope_uq" ON "bank_net_vector" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_opening_item_scope_uq" ON "bank_opening_item" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_opening_gl_uq" ON "bank_opening_item" USING btree ("baseline_id","gl_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_reconciliation_baseline_scope_uq" ON "bank_reconciliation_baseline" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_reconciliation_event_scope_uq" ON "bank_reconciliation_event" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_event_baseline_uq" ON "bank_reconciliation_event" USING btree ("baseline_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_event_import_uq" ON "bank_reconciliation_event" USING btree ("import_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_event_match_uq" ON "bank_reconciliation_event" USING btree ("match_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_event_period_uq" ON "bank_reconciliation_event" USING btree ("period_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_reconciliation_period_scope_uq" ON "bank_reconciliation_period" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_profile_scope_uq" ON "bank_reconciliation_profile" USING btree ("id","tenant_id","entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_profile_account_uq" ON "bank_reconciliation_profile" USING btree ("entity_id","account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_import_scope_uq" ON "bank_statement_import" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_import_file_uq" ON "bank_statement_import" USING btree ("profile_id","file_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_membership_scope_uq" ON "bank_statement_membership" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_membership_ordinal_uq" ON "bank_statement_membership" USING btree ("import_id","ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_membership_movement_uq" ON "bank_statement_membership" USING btree ("import_id","movement_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_movement_scope_uq" ON "bank_statement_movement" USING btree ("id","tenant_id","entity_id","profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_movement_transaction_uq" ON "bank_statement_movement" USING btree ("profile_id","transaction_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "br_movement_ordinal_uq" ON "bank_statement_movement" USING btree ("original_import_id","ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "gl_entry_scope_uq" ON "gl_entry" USING btree ("id","tenant_id","entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_scope_uq" ON "journal_voucher" USING btree ("id","tenant_id","entity_id");
--> statement-breakpoint
ALTER TABLE "bank_adjustment_link" ADD CONSTRAINT "bank_adjustment_link_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_adjustment_link" ADD CONSTRAINT "bank_adjustment_link_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_adjustment_link" ADD CONSTRAINT "bank_adjustment_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_adjustment_link" ADD CONSTRAINT "bank_adjustment_link_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_adjustment_link" ADD CONSTRAINT "br_adjustment_movement_fk" FOREIGN KEY ("movement_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_movement"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_adjustment_link" ADD CONSTRAINT "br_adjustment_charge_fk" FOREIGN KEY ("charge_id","tenant_id","entity_id") REFERENCES "public"."bank_charge_document"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_adjustment_link" ADD CONSTRAINT "br_adjustment_voucher_fk" FOREIGN KEY ("voucher_id","tenant_id","entity_id") REFERENCES "public"."journal_voucher"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_duplicate_decision" ADD CONSTRAINT "bank_duplicate_decision_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_duplicate_decision" ADD CONSTRAINT "bank_duplicate_decision_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_duplicate_decision" ADD CONSTRAINT "bank_duplicate_decision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_duplicate_decision" ADD CONSTRAINT "bank_duplicate_decision_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_duplicate_decision" ADD CONSTRAINT "br_duplicate_import_fk" FOREIGN KEY ("import_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_import"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_duplicate_decision" ADD CONSTRAINT "br_duplicate_movement_fk" FOREIGN KEY ("movement_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_movement"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_mapping_revision" ADD CONSTRAINT "bank_mapping_revision_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_mapping_revision" ADD CONSTRAINT "bank_mapping_revision_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_mapping_revision" ADD CONSTRAINT "bank_mapping_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_mapping_revision" ADD CONSTRAINT "bank_mapping_revision_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_edge" ADD CONSTRAINT "bank_match_edge_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_edge" ADD CONSTRAINT "bank_match_edge_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_edge" ADD CONSTRAINT "bank_match_edge_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_edge" ADD CONSTRAINT "bank_match_edge_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_edge" ADD CONSTRAINT "br_edge_match_fk" FOREIGN KEY ("match_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_match_group"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_edge" ADD CONSTRAINT "br_edge_movement_fk" FOREIGN KEY ("movement_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_movement"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_edge" ADD CONSTRAINT "br_edge_opening_fk" FOREIGN KEY ("opening_item_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_opening_item"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_edge" ADD CONSTRAINT "br_edge_gl_fk" FOREIGN KEY ("gl_entry_id","tenant_id","entity_id") REFERENCES "public"."gl_entry"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_group" ADD CONSTRAINT "bank_match_group_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_group" ADD CONSTRAINT "bank_match_group_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_group" ADD CONSTRAINT "bank_match_group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_match_group" ADD CONSTRAINT "bank_match_group_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_net_vector" ADD CONSTRAINT "bank_net_vector_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_net_vector" ADD CONSTRAINT "bank_net_vector_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_net_vector" ADD CONSTRAINT "bank_net_vector_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_net_vector" ADD CONSTRAINT "bank_net_vector_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_net_vector" ADD CONSTRAINT "br_net_match_fk" FOREIGN KEY ("match_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_match_group"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_net_vector" ADD CONSTRAINT "br_net_movement_fk" FOREIGN KEY ("movement_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_movement"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_net_vector" ADD CONSTRAINT "br_net_gl_fk" FOREIGN KEY ("gl_entry_id","tenant_id","entity_id") REFERENCES "public"."gl_entry"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_opening_item" ADD CONSTRAINT "bank_opening_item_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_opening_item" ADD CONSTRAINT "bank_opening_item_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_opening_item" ADD CONSTRAINT "bank_opening_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_opening_item" ADD CONSTRAINT "bank_opening_item_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_opening_item" ADD CONSTRAINT "br_opening_baseline_fk" FOREIGN KEY ("baseline_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_reconciliation_baseline"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_opening_item" ADD CONSTRAINT "br_opening_gl_fk" FOREIGN KEY ("gl_entry_id","tenant_id","entity_id") REFERENCES "public"."gl_entry"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_baseline" ADD CONSTRAINT "bank_reconciliation_baseline_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_baseline" ADD CONSTRAINT "bank_reconciliation_baseline_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_baseline" ADD CONSTRAINT "bank_reconciliation_baseline_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_baseline" ADD CONSTRAINT "bank_reconciliation_baseline_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_event" ADD CONSTRAINT "bank_reconciliation_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_event" ADD CONSTRAINT "bank_reconciliation_event_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_event" ADD CONSTRAINT "bank_reconciliation_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_event" ADD CONSTRAINT "bank_reconciliation_event_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_event" ADD CONSTRAINT "br_event_baseline_fk" FOREIGN KEY ("baseline_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_reconciliation_baseline"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_event" ADD CONSTRAINT "br_event_import_fk" FOREIGN KEY ("import_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_import"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_event" ADD CONSTRAINT "br_event_match_fk" FOREIGN KEY ("match_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_match_group"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_event" ADD CONSTRAINT "br_event_period_fk" FOREIGN KEY ("period_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_reconciliation_period"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_period" ADD CONSTRAINT "bank_reconciliation_period_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_period" ADD CONSTRAINT "bank_reconciliation_period_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_period" ADD CONSTRAINT "bank_reconciliation_period_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_period" ADD CONSTRAINT "bank_reconciliation_period_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_period" ADD CONSTRAINT "br_period_baseline_fk" FOREIGN KEY ("baseline_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_reconciliation_baseline"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_profile" ADD CONSTRAINT "bank_reconciliation_profile_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_profile" ADD CONSTRAINT "bank_reconciliation_profile_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_profile" ADD CONSTRAINT "bank_reconciliation_profile_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_profile" ADD CONSTRAINT "br_profile_entity_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_profile" ADD CONSTRAINT "br_profile_account_fk" FOREIGN KEY ("account_id","tenant_id","entity_id") REFERENCES "public"."gl_account"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "bank_statement_import_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "bank_statement_import_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "bank_statement_import_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "bank_statement_import_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "br_import_mapping_fk" FOREIGN KEY ("mapping_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_mapping_revision"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_membership" ADD CONSTRAINT "bank_statement_membership_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_membership" ADD CONSTRAINT "bank_statement_membership_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_membership" ADD CONSTRAINT "bank_statement_membership_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_membership" ADD CONSTRAINT "bank_statement_membership_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_membership" ADD CONSTRAINT "br_membership_import_fk" FOREIGN KEY ("import_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_import"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_membership" ADD CONSTRAINT "br_membership_movement_fk" FOREIGN KEY ("movement_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_movement"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_movement" ADD CONSTRAINT "bank_statement_movement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_movement" ADD CONSTRAINT "bank_statement_movement_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_movement" ADD CONSTRAINT "bank_statement_movement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_movement" ADD CONSTRAINT "bank_statement_movement_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."bank_reconciliation_profile"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_movement" ADD CONSTRAINT "br_movement_import_fk" FOREIGN KEY ("original_import_id","tenant_id","entity_id","profile_id") REFERENCES "public"."bank_statement_import"("id","tenant_id","entity_id","profile_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION bank_evidence_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Bank reconciliation evidence is append-only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER bank_mapping_revision_immutable BEFORE UPDATE OR DELETE ON bank_mapping_revision FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_baseline_immutable BEFORE UPDATE OR DELETE ON bank_reconciliation_baseline FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_opening_item_immutable BEFORE UPDATE OR DELETE ON bank_opening_item FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_statement_movement_immutable BEFORE UPDATE OR DELETE ON bank_statement_movement FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_statement_membership_immutable BEFORE UPDATE OR DELETE ON bank_statement_membership FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_decision_immutable BEFORE UPDATE OR DELETE ON bank_duplicate_decision FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_match_group_immutable BEFORE UPDATE OR DELETE ON bank_match_group FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_match_edge_immutable BEFORE UPDATE OR DELETE ON bank_match_edge FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_net_vector_immutable BEFORE UPDATE OR DELETE ON bank_net_vector FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_event_immutable BEFORE UPDATE OR DELETE ON bank_reconciliation_event FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_period_immutable BEFORE UPDATE OR DELETE ON bank_reconciliation_period FOR EACH ROW EXECUTE FUNCTION bank_evidence_append_only();
--> statement-breakpoint
CREATE FUNCTION bank_import_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Submitted bank import is immutable; reverse by event'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.status='cancelled' THEN RAISE EXCEPTION 'Bank import reversal requires an event'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER bank_import_immutable BEFORE UPDATE OR DELETE ON bank_statement_import FOR EACH ROW EXECUTE FUNCTION bank_import_identity();
--> statement-breakpoint
CREATE FUNCTION bank_profile_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bank profile identity is permanent'; END IF;
 IF (to_jsonb(NEW)-'date_window') IS DISTINCT FROM (to_jsonb(OLD)-'date_window') THEN RAISE EXCEPTION 'Bank profile identity is immutable'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER bank_profile_immutable BEFORE UPDATE OR DELETE ON bank_reconciliation_profile FOR EACH ROW EXECUTE FUNCTION bank_profile_identity();
--> statement-breakpoint
CREATE FUNCTION bank_adjustment_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bank adjustment provenance is immutable'; END IF;
 IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR coalesce(length(trim(NEW.release_reason)),0)=0 OR (to_jsonb(NEW)-ARRAY['released_at','release_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['released_at','release_reason']) THEN RAISE EXCEPTION 'Only a documented first reservation release is allowed'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER bank_adjustment_immutable BEFORE UPDATE OR DELETE ON bank_adjustment_link FOR EACH ROW EXECUTE FUNCTION bank_adjustment_identity();
