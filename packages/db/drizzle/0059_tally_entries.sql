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
DROP INDEX "purchase_invoice_entity_number_uq";--> statement-breakpoint
DROP INDEX "sales_invoice_gstin_number_uq";--> statement-breakpoint
DROP INDEX "party_settlement_number_uq";--> statement-breakpoint
DROP INDEX "sales_note_gstin_number_uq";--> statement-breakpoint
ALTER TABLE "party_settlement" ADD COLUMN "source" text DEFAULT 'factoryos' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_settlement" ADD COLUMN "tally_guid" text;--> statement-breakpoint
ALTER TABLE "tally_document_version" ADD CONSTRAINT "tally_document_version_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_document_version" ADD CONSTRAINT "tally_document_version_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tally_document_version_guid_idx" ON "tally_document_version" USING btree ("entity_id","guid");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_document_version_document_uq" ON "tally_document_version" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_settlement_tally_guid_uq" ON "party_settlement" USING btree ("entity_id","tally_guid") WHERE "party_settlement"."tally_guid" is not null and "party_settlement"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_entity_number_uq" ON "purchase_invoice" USING btree ("entity_id","number") WHERE "purchase_invoice"."source" <> 'tally' or "purchase_invoice"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_gstin_number_uq" ON "sales_invoice" USING btree ("gst_registration_id","number") WHERE "sales_invoice"."source" <> 'tally' or "sales_invoice"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "party_settlement_number_uq" ON "party_settlement" USING btree ("entity_id","number") WHERE "party_settlement"."source" = 'factoryos';--> statement-breakpoint
CREATE UNIQUE INDEX "sales_note_gstin_number_uq" ON "sales_note" USING btree ("gst_registration_id","number") WHERE "sales_note"."source" <> 'tally' or "sales_note"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "tally_voucher_type_map" ADD CONSTRAINT "tally_voucher_type_map_ck" CHECK ("tally_voucher_type_map"."document_kind" in ('sales_invoice','purchase_invoice','sales_credit_note','supplier_debit_note','receipt','payment','journal','stock_journal','none'));--> statement-breakpoint
-- Decision 075 PR 1 documents get their first version, with the stock receipts and returns they made.
INSERT INTO "tally_document_version" ("tenant_id", "entity_id", "guid", "alter_id", "document_kind", "document_id", "import_id", "parts")
SELECT v."tenant_id", v."entity_id", v."guid", v."alter_id", v."document_kind", v."document_id", v."import_id",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('kind', 'stock_entry', 'id', e."id"))
    FROM "stock_entry" e
    WHERE e."entity_id" = v."entity_id" AND e."source" = 'tally' AND e."status" <> 'cancelled'
      AND ((v."document_kind" = 'purchase_invoice' AND e."purpose" = 'receipt' AND e."reference" = (SELECT p."number" FROM "purchase_invoice" p WHERE p."id" = v."document_id") AND e."remarks" LIKE 'Received on purchase invoice %')
        OR (v."document_kind" = 'supplier_debit_note' AND e."purpose" = 'adjustment' AND e."reference" = (SELECT n."number" FROM "supplier_note" n WHERE n."id" = v."document_id") AND e."remarks" LIKE 'Sent back on debit note %'))
  ), '[]'::jsonb)
FROM "tally_voucher" v
WHERE v."document_id" IS NOT NULL;
