CREATE TABLE "tally_book_month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"source" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tally_book_month_ck" CHECK ("tally_book_month"."source" in ('tally','factoryos') and "tally_book_month"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "tally_ledger_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"ledger" text NOT NULL,
	"item_id" uuid NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally_voucher_type_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"voucher_type" text NOT NULL,
	"document_kind" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tally_voucher_type_map_ck" CHECK ("tally_voucher_type_map"."document_kind" in ('sales_invoice','purchase_invoice','sales_credit_note','supplier_debit_note','none'))
);
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD COLUMN "source" text DEFAULT 'factoryos' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "source" text DEFAULT 'factoryos' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "tally_guid" text;--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "tax_difference" jsonb;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "source" text DEFAULT 'factoryos' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "tally_guid" text;--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "tax_difference" jsonb;--> statement-breakpoint
ALTER TABLE "sales_note" ADD COLUMN "source" text DEFAULT 'factoryos' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_note" ADD COLUMN "tally_guid" text;--> statement-breakpoint
ALTER TABLE "sales_note" ADD COLUMN "tax_difference" jsonb;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD COLUMN "source" text DEFAULT 'factoryos' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD COLUMN "tally_guid" text;--> statement-breakpoint
ALTER TABLE "supplier_note" ADD COLUMN "tax_difference" jsonb;--> statement-breakpoint
ALTER TABLE "tally_voucher" ADD COLUMN "document_kind" text;--> statement-breakpoint
ALTER TABLE "tally_voucher" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "tally_book_month" ADD CONSTRAINT "tally_book_month_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_book_month" ADD CONSTRAINT "tally_book_month_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_book_month" ADD CONSTRAINT "tally_book_month_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_ledger_item" ADD CONSTRAINT "tally_ledger_item_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_ledger_item" ADD CONSTRAINT "tally_ledger_item_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_ledger_item" ADD CONSTRAINT "tally_ledger_item_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher_type_map" ADD CONSTRAINT "tally_voucher_type_map_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher_type_map" ADD CONSTRAINT "tally_voucher_type_map_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher_type_map" ADD CONSTRAINT "tally_voucher_type_map_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tally_book_month_uq" ON "tally_book_month" USING btree ("entity_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_ledger_item_uq" ON "tally_ledger_item" USING btree ("entity_id","ledger");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_voucher_type_map_uq" ON "tally_voucher_type_map" USING btree ("entity_id","voucher_type");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_tally_guid_uq" ON "purchase_invoice" USING btree ("entity_id","tally_guid") WHERE "purchase_invoice"."tally_guid" is not null and "purchase_invoice"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_tally_guid_uq" ON "sales_invoice" USING btree ("entity_id","tally_guid") WHERE "sales_invoice"."tally_guid" is not null and "sales_invoice"."status" <> 'cancelled';