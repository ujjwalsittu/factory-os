ALTER TABLE "accounting_settings" ADD COLUMN "control_history" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_voucher" ADD COLUMN "clearing_source_id" uuid;