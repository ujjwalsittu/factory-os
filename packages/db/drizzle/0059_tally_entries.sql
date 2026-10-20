CREATE TABLE "tally_document_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"alter_id" integer,
	"document_kind" text NOT NULL,
	"document_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"replaced_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tally_voucher_type_map" DROP CONSTRAINT "tally_voucher_type_map_ck";--> statement-breakpoint
DROP INDEX "party_settlement_number_uq";--> statement-breakpoint
ALTER TABLE "party_settlement" ADD COLUMN "source" text DEFAULT 'factoryos' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD COLUMN "tally_guid" text;--> statement-breakpoint
ALTER TABLE "tally_document_version" ADD CONSTRAINT "tally_document_version_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_document_version" ADD CONSTRAINT "tally_document_version_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tally_document_version_guid_idx" ON "tally_document_version" USING btree ("entity_id","guid");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_document_version_document_uq" ON "tally_document_version" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_settlement_tally_guid_uq" ON "party_settlement" USING btree ("entity_id","tally_guid") WHERE "party_settlement"."tally_guid" is not null and "party_settlement"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "party_settlement_number_uq" ON "party_settlement" USING btree ("entity_id","number") WHERE "party_settlement"."source" = 'factoryos';--> statement-breakpoint
ALTER TABLE "tally_voucher_type_map" ADD CONSTRAINT "tally_voucher_type_map_ck" CHECK ("tally_voucher_type_map"."document_kind" in ('sales_invoice','purchase_invoice','sales_credit_note','supplier_debit_note','receipt','payment','journal','stock_journal','none'));