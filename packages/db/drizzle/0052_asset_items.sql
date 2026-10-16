ALTER TYPE "public"."item_type" ADD VALUE 'asset';--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD COLUMN "asset_account_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_asset_account_id_gl_account_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."gl_account"("id") ON DELETE no action ON UPDATE no action;
