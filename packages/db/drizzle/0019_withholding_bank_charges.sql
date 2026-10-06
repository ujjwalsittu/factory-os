CREATE TABLE "tax_advice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"posting_date" date NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"evidence_key" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"allocations" jsonb NOT NULL,
	"snapshot" jsonb,
	"assessment_id" uuid,
	"voucher_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "tax_advice_values_ck" CHECK ("tax_advice"."amount">0 and "tax_advice"."direction" in ('customer_tds','supplier_tcs'))
);
--> statement-breakpoint
CREATE TABLE "tax_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"identity_id" uuid NOT NULL,
	"profile_id" uuid,
	"posting_date" date NOT NULL,
	"tax_year" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"preview_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "tax_base_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"recipient_assessment_id" uuid NOT NULL,
	"base_amount" numeric(24, 6) NOT NULL,
	"consumption_key" text NOT NULL,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_certificate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"revision" integer NOT NULL,
	"authority" text NOT NULL,
	"act" text NOT NULL,
	"deductor_tan" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"rate_percent" numeric(24, 6) NOT NULL,
	"base_limit" numeric(24, 6) NOT NULL,
	"tax_limit" numeric(24, 6),
	"evidence" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_certificate_values_ck" CHECK ("tax_certificate"."rate_percent">=0 and "tax_certificate"."rate_percent"<=100 and "tax_certificate"."base_limit">=0 and ("tax_certificate"."tax_limit" is null or "tax_certificate"."tax_limit">=0) and "tax_certificate"."valid_to">="tax_certificate"."valid_from" and "tax_certificate"."act" in ('1961','2025'))
);
--> statement-breakpoint
CREATE TABLE "tax_certificate_use" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"base_amount" numeric(24, 6) NOT NULL,
	"tax_amount" numeric(24, 6) NOT NULL,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_configuration" (
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"activation_date" date,
	"deductor_pan" text,
	"tan" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"enabled_profiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opening_id" uuid,
	"activated_by" text,
	"activated_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_configuration_revision_ck" CHECK ("tax_configuration"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "tax_correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"original_event_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"snapshot" jsonb,
	"assessment_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "tax_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"category" text NOT NULL,
	"posting_date" date NOT NULL,
	"tax_year" text NOT NULL,
	"base_amount" numeric(24, 6) NOT NULL,
	"tax_amount" numeric(24, 6) NOT NULL,
	"event_key" text NOT NULL,
	"voucher_id" uuid,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_event_category_ck" CHECK ("tax_event"."category" in ('tds','tcs','customer_tds','supplier_tcs'))
);
--> statement-breakpoint
CREATE TABLE "tax_external_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_external_kind_ck" CHECK ("tax_external_reference"."kind" in ('certificate','reported','correction'))
);
--> statement-breakpoint
CREATE TABLE "tax_opening" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"revision" integer NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reconciliation" jsonb,
	"reviewed_hash" text,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "tax_opening_revision_ck" CHECK ("tax_opening"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "tax_party_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"revision" integer NOT NULL,
	"selectors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_party_revision_ck" CHECK ("tax_party_evidence"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "tax_profile_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile_key" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"definition" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_profile_status_ck" CHECK ("tax_profile_revision"."status" in ('draft','verified') and "tax_profile_revision"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "tax_remittance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"tan" text NOT NULL,
	"act" text NOT NULL,
	"tax_year" text NOT NULL,
	"category" text NOT NULL,
	"period" text NOT NULL,
	"reference_key" text NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"snapshot" jsonb,
	"voucher_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "tax_remittance_values_ck" CHECK ("tax_remittance"."amount">0 and "tax_remittance"."act" in ('1961','2025') and "tax_remittance"."category" in ('tds','tcs'))
);
--> statement-breakpoint
CREATE TABLE "tax_remittance_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"remittance_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"reversal_of" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_source_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"history" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_history_revision_ck" CHECK ("tax_source_history"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "taxpayer_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"identity_key" text NOT NULL,
	"pan_status" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxpayer_pan_status_ck" CHECK ("taxpayer_identity"."pan_status" in ('valid','missing','inoperative','unknown'))
);
--> statement-breakpoint
CREATE TABLE "bank_charge_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"posting_date" date NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"base_amount" numeric(24, 6) NOT NULL,
	"gst_amount" numeric(24, 6) DEFAULT '0' NOT NULL,
	"total_amount" numeric(24, 6) NOT NULL,
	"reference_key" text NOT NULL,
	"settlement_id" uuid,
	"evidence" jsonb NOT NULL,
	"snapshot" jsonb,
	"voucher_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "bank_charge_amount_ck" CHECK ("bank_charge_document"."base_amount">=0 and "bank_charge_document"."gst_amount">=0 and "bank_charge_document"."total_amount">0 and "bank_charge_document"."total_amount"="bank_charge_document"."base_amount"+"bank_charge_document"."gst_amount")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_advice_scope_uq" ON "tax_advice" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_advice_evidence_uq" ON "tax_advice" USING btree ("entity_id","party_id","evidence_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_assessment_scope_uq" ON "tax_assessment" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_assessment_source_uq" ON "tax_assessment" USING btree ("entity_id","source_type","source_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_consumption_key_uq" ON "tax_base_consumption" USING btree ("entity_id","consumption_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_consumption_reversal_uq" ON "tax_base_consumption" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_certificate_scope_uq" ON "tax_certificate" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_certificate_revision_uq" ON "tax_certificate" USING btree ("entity_id","reference","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_certificate_use_event_uq" ON "tax_certificate_use" USING btree ("certificate_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_certificate_use_reversal_uq" ON "tax_certificate_use" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_configuration_entity_uq" ON "tax_configuration" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_event_scope_uq" ON "tax_event" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_event_key_uq" ON "tax_event" USING btree ("entity_id","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_event_reversal_uq" ON "tax_event" USING btree ("reversal_of");--> statement-breakpoint
CREATE INDEX "tax_event_counter_idx" ON "tax_event" USING btree ("entity_id","identity_id","tax_year","category","posting_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_external_reference_uq" ON "tax_external_reference" USING btree ("event_id","kind","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_opening_scope_uq" ON "tax_opening" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_opening_revision_uq" ON "tax_opening" USING btree ("entity_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_party_evidence_revision_uq" ON "tax_party_evidence" USING btree ("entity_id","party_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_profile_scope_uq" ON "tax_profile_revision" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_profile_revision_uq" ON "tax_profile_revision" USING btree ("entity_id","profile_key","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_scope_uq" ON "tax_remittance" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_reference_uq" ON "tax_remittance" USING btree ("entity_id","tan","reference_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_allocation_uq" ON "tax_remittance_allocation" USING btree ("remittance_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_allocation_reversal_uq" ON "tax_remittance_allocation" USING btree ("reversal_of");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_source_history_revision_uq" ON "tax_source_history" USING btree ("entity_id","source_type","source_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "taxpayer_identity_scope_uq" ON "taxpayer_identity" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "taxpayer_identity_key_uq" ON "taxpayer_identity" USING btree ("entity_id","identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_charge_scope_uq" ON "bank_charge_document" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_charge_reference_uq" ON "bank_charge_document" USING btree ("entity_id","reference_key");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entity_scope_uq" ON "legal_entity" USING btree ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_scope_uq" ON "party" USING btree ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_scope_uq" ON "gl_account" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
ALTER TABLE "party_settlement" ADD COLUMN "new_tax" numeric(24, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD COLUMN "bank_charge" numeric(24, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD COLUMN "component_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "tax_advice" ADD CONSTRAINT "tax_advice_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_advice" ADD CONSTRAINT "tax_advice_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_advice" ADD CONSTRAINT "tax_advice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_advice" ADD CONSTRAINT "tax_advice_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_advice" ADD CONSTRAINT "tax_advice_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_advice" ADD CONSTRAINT "tax_advice_party_fk" FOREIGN KEY ("party_id","tenant_id") REFERENCES "public"."party"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_advice" ADD CONSTRAINT "tax_advice_entity_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_advice" ADD CONSTRAINT "tax_advice_assessment_fk" FOREIGN KEY ("assessment_id","tenant_id","entity_id") REFERENCES "public"."tax_assessment"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_assessment" ADD CONSTRAINT "tax_assessment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_assessment" ADD CONSTRAINT "tax_assessment_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_assessment" ADD CONSTRAINT "tax_assessment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_assessment" ADD CONSTRAINT "tax_assessment_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_assessment" ADD CONSTRAINT "tax_assessment_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_assessment" ADD CONSTRAINT "tax_assessment_identity_fk" FOREIGN KEY ("identity_id","tenant_id","entity_id") REFERENCES "public"."taxpayer_identity"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_assessment" ADD CONSTRAINT "tax_assessment_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."tax_profile_revision"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_base_consumption" ADD CONSTRAINT "tax_base_consumption_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_base_consumption" ADD CONSTRAINT "tax_base_consumption_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_base_consumption" ADD CONSTRAINT "tax_base_consumption_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_base_consumption" ADD CONSTRAINT "tax_consumption_event_fk" FOREIGN KEY ("event_id","tenant_id","entity_id") REFERENCES "public"."tax_event"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_base_consumption" ADD CONSTRAINT "tax_consumption_recipient_fk" FOREIGN KEY ("recipient_assessment_id","tenant_id","entity_id") REFERENCES "public"."tax_assessment"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate" ADD CONSTRAINT "tax_certificate_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate" ADD CONSTRAINT "tax_certificate_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate" ADD CONSTRAINT "tax_certificate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate" ADD CONSTRAINT "tax_certificate_identity_fk" FOREIGN KEY ("identity_id","tenant_id","entity_id") REFERENCES "public"."taxpayer_identity"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate" ADD CONSTRAINT "tax_certificate_profile_fk" FOREIGN KEY ("profile_id","tenant_id","entity_id") REFERENCES "public"."tax_profile_revision"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate_use" ADD CONSTRAINT "tax_certificate_use_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate_use" ADD CONSTRAINT "tax_certificate_use_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate_use" ADD CONSTRAINT "tax_certificate_use_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate_use" ADD CONSTRAINT "tax_certificate_use_certificate_fk" FOREIGN KEY ("certificate_id","tenant_id","entity_id") REFERENCES "public"."tax_certificate"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificate_use" ADD CONSTRAINT "tax_certificate_use_event_fk" FOREIGN KEY ("event_id","tenant_id","entity_id") REFERENCES "public"."tax_event"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configuration" ADD CONSTRAINT "tax_configuration_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configuration" ADD CONSTRAINT "tax_configuration_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configuration" ADD CONSTRAINT "tax_configuration_activated_by_user_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configuration" ADD CONSTRAINT "tax_configuration_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configuration" ADD CONSTRAINT "tax_configuration_entity_scope_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_correction" ADD CONSTRAINT "tax_correction_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_correction" ADD CONSTRAINT "tax_correction_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_correction" ADD CONSTRAINT "tax_correction_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_correction" ADD CONSTRAINT "tax_correction_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_correction" ADD CONSTRAINT "tax_correction_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_correction" ADD CONSTRAINT "tax_correction_event_fk" FOREIGN KEY ("original_event_id","tenant_id","entity_id") REFERENCES "public"."tax_event"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_correction" ADD CONSTRAINT "tax_correction_assessment_fk" FOREIGN KEY ("assessment_id","tenant_id","entity_id") REFERENCES "public"."tax_assessment"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_event" ADD CONSTRAINT "tax_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_event" ADD CONSTRAINT "tax_event_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_event" ADD CONSTRAINT "tax_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_event" ADD CONSTRAINT "tax_event_assessment_fk" FOREIGN KEY ("assessment_id","tenant_id","entity_id") REFERENCES "public"."tax_assessment"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_event" ADD CONSTRAINT "tax_event_identity_fk" FOREIGN KEY ("identity_id","tenant_id","entity_id") REFERENCES "public"."taxpayer_identity"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_external_reference" ADD CONSTRAINT "tax_external_reference_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_external_reference" ADD CONSTRAINT "tax_external_reference_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_external_reference" ADD CONSTRAINT "tax_external_reference_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_external_reference" ADD CONSTRAINT "tax_external_event_fk" FOREIGN KEY ("event_id","tenant_id","entity_id") REFERENCES "public"."tax_event"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_opening" ADD CONSTRAINT "tax_opening_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_opening" ADD CONSTRAINT "tax_opening_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_opening" ADD CONSTRAINT "tax_opening_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_opening" ADD CONSTRAINT "tax_opening_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_opening" ADD CONSTRAINT "tax_opening_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_opening" ADD CONSTRAINT "tax_opening_entity_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_party_evidence" ADD CONSTRAINT "tax_party_evidence_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_party_evidence" ADD CONSTRAINT "tax_party_evidence_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_party_evidence" ADD CONSTRAINT "tax_party_evidence_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_party_evidence" ADD CONSTRAINT "tax_party_identity_scope_fk" FOREIGN KEY ("identity_id","tenant_id","entity_id") REFERENCES "public"."taxpayer_identity"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_party_evidence" ADD CONSTRAINT "tax_party_master_scope_fk" FOREIGN KEY ("party_id","tenant_id") REFERENCES "public"."party"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile_revision" ADD CONSTRAINT "tax_profile_revision_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile_revision" ADD CONSTRAINT "tax_profile_revision_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile_revision" ADD CONSTRAINT "tax_profile_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile_revision" ADD CONSTRAINT "tax_profile_entity_scope_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance" ADD CONSTRAINT "tax_remittance_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance" ADD CONSTRAINT "tax_remittance_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance" ADD CONSTRAINT "tax_remittance_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance" ADD CONSTRAINT "tax_remittance_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance" ADD CONSTRAINT "tax_remittance_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance" ADD CONSTRAINT "tax_remittance_entity_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remittance_allocation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remittance_allocation_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remittance_allocation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remit_allocation_remit_fk" FOREIGN KEY ("remittance_id","tenant_id","entity_id") REFERENCES "public"."tax_remittance"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remit_allocation_event_fk" FOREIGN KEY ("event_id","tenant_id","entity_id") REFERENCES "public"."tax_event"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_source_history" ADD CONSTRAINT "tax_source_history_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_source_history" ADD CONSTRAINT "tax_source_history_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_source_history" ADD CONSTRAINT "tax_source_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_source_history" ADD CONSTRAINT "tax_history_opening_fk" FOREIGN KEY ("opening_id","tenant_id","entity_id") REFERENCES "public"."tax_opening"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxpayer_identity" ADD CONSTRAINT "taxpayer_identity_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxpayer_identity" ADD CONSTRAINT "taxpayer_identity_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxpayer_identity" ADD CONSTRAINT "taxpayer_identity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxpayer_identity" ADD CONSTRAINT "taxpayer_entity_scope_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_charge_document" ADD CONSTRAINT "bank_charge_document_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_charge_document" ADD CONSTRAINT "bank_charge_document_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_charge_document" ADD CONSTRAINT "bank_charge_document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_charge_document" ADD CONSTRAINT "bank_charge_document_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_charge_document" ADD CONSTRAINT "bank_charge_document_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_charge_document" ADD CONSTRAINT "bank_charge_entity_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_charge_document" ADD CONSTRAINT "bank_charge_bank_scope_fk" FOREIGN KEY ("bank_account_id","tenant_id","entity_id") REFERENCES "public"."gl_account"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_charge_document" ADD CONSTRAINT "bank_charge_expense_scope_fk" FOREIGN KEY ("expense_account_id","tenant_id","entity_id") REFERENCES "public"."gl_account"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD CONSTRAINT "party_settlement_components_ck" CHECK ("party_settlement"."new_tax">=0 and "party_settlement"."bank_charge">=0 and ("party_settlement"."currency"='INR' or ("party_settlement"."new_tax"=0 and "party_settlement"."bank_charge"=0)));
--> statement-breakpoint
CREATE FUNCTION tax_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Tax evidence is append-only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER tax_profile_revision_immutable BEFORE UPDATE OR DELETE ON tax_profile_revision FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER taxpayer_identity_immutable BEFORE UPDATE OR DELETE ON taxpayer_identity FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER tax_party_evidence_immutable BEFORE UPDATE OR DELETE ON tax_party_evidence FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER tax_certificate_immutable BEFORE UPDATE OR DELETE ON tax_certificate FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER tax_source_history_immutable BEFORE UPDATE OR DELETE ON tax_source_history FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER tax_event_immutable BEFORE UPDATE OR DELETE ON tax_event FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER tax_base_consumption_immutable BEFORE UPDATE OR DELETE ON tax_base_consumption FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER tax_certificate_use_immutable BEFORE UPDATE OR DELETE ON tax_certificate_use FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER tax_remittance_allocation_immutable BEFORE UPDATE OR DELETE ON tax_remittance_allocation FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE TRIGGER tax_external_reference_immutable BEFORE UPDATE OR DELETE ON tax_external_reference FOR EACH ROW EXECUTE FUNCTION tax_append_only();
--> statement-breakpoint
CREATE FUNCTION tax_document_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Submitted tax document cannot be deleted'; END IF; RETURN OLD; END IF;
 IF OLD.status<>'draft' THEN
  IF NEW.status NOT IN ('submitted','cancelled') OR (OLD.status='cancelled' AND NEW.status<>'cancelled') OR
   (to_jsonb(NEW)-ARRAY['status','cancelled_by','cancelled_at','cancel_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','cancelled_by','cancelled_at','cancel_reason']) THEN
   RAISE EXCEPTION 'Submitted tax document evidence is immutable'; END IF;
 END IF; RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER tax_assessment_immutable BEFORE UPDATE OR DELETE ON tax_assessment FOR EACH ROW EXECUTE FUNCTION tax_document_identity();
--> statement-breakpoint
CREATE TRIGGER tax_advice_immutable BEFORE UPDATE OR DELETE ON tax_advice FOR EACH ROW EXECUTE FUNCTION tax_document_identity();
--> statement-breakpoint
CREATE TRIGGER tax_opening_immutable BEFORE UPDATE OR DELETE ON tax_opening FOR EACH ROW EXECUTE FUNCTION tax_document_identity();
--> statement-breakpoint
CREATE TRIGGER tax_remittance_immutable BEFORE UPDATE OR DELETE ON tax_remittance FOR EACH ROW EXECUTE FUNCTION tax_document_identity();
--> statement-breakpoint
CREATE TRIGGER tax_correction_immutable BEFORE UPDATE OR DELETE ON tax_correction FOR EACH ROW EXECUTE FUNCTION tax_document_identity();
--> statement-breakpoint
CREATE TRIGGER bank_charge_document_immutable BEFORE UPDATE OR DELETE ON bank_charge_document FOR EACH ROW EXECUTE FUNCTION tax_document_identity();
--> statement-breakpoint
CREATE FUNCTION settlement_tax_components_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'draft' AND ROW(NEW.new_tax,NEW.bank_charge,NEW.component_snapshot) IS DISTINCT FROM ROW(OLD.new_tax,OLD.bank_charge,OLD.component_snapshot) THEN RAISE EXCEPTION 'Submitted settlement components are immutable'; END IF; RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER party_settlement_tax_components_immutable BEFORE UPDATE ON party_settlement FOR EACH ROW EXECUTE FUNCTION settlement_tax_components_identity();
