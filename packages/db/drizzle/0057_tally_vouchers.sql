CREATE TABLE "tally_voucher" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"alter_id" integer,
	"voucher_type" text NOT NULL,
	"number" text,
	"date" date NOT NULL,
	"narration" text,
	"party_name" text,
	"party_id" uuid,
	"cancelled" boolean DEFAULT false NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"import_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "tally_voucher_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"ledger_name" text NOT NULL,
	"account_id" uuid,
	"party_id" uuid,
	"side" text NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"bills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "tally_voucher_line_side_ck" CHECK ("tally_voucher_line"."side" in ('debit','credit')),
	CONSTRAINT "tally_voucher_line_amount_ck" CHECK ("tally_voucher_line"."amount" > 0)
);--> statement-breakpoint
ALTER TABLE "tally_staged" DROP CONSTRAINT "tally_staged_kind_ck";--> statement-breakpoint
CREATE UNIQUE INDEX "tally_voucher_guid_uq" ON "tally_voucher" USING btree ("entity_id","guid");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_voucher_scope_uq" ON "tally_voucher" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
CREATE INDEX "tally_voucher_entity_date_idx" ON "tally_voucher" USING btree ("entity_id","date");--> statement-breakpoint
CREATE INDEX "tally_voucher_party_idx" ON "tally_voucher" USING btree ("entity_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_voucher_line_no_uq" ON "tally_voucher_line" USING btree ("voucher_id","line_no");--> statement-breakpoint
CREATE INDEX "tally_voucher_line_account_idx" ON "tally_voucher_line" USING btree ("entity_id","account_id");--> statement-breakpoint
CREATE INDEX "tally_voucher_line_party_idx" ON "tally_voucher_line" USING btree ("entity_id","party_id");--> statement-breakpoint
ALTER TABLE "tally_staged" ADD CONSTRAINT "tally_staged_kind_ck" CHECK ("tally_staged"."kind" in ('group','ledger','party','stockgroup','unit','godown','stockitem','opening','stock','voucher'));--> statement-breakpoint
ALTER TABLE "tally_voucher" ADD CONSTRAINT "tally_voucher_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher" ADD CONSTRAINT "tally_voucher_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher" ADD CONSTRAINT "tally_voucher_import_fk" FOREIGN KEY ("import_id","tenant_id","entity_id") REFERENCES "public"."tally_import"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher_line" ADD CONSTRAINT "tally_voucher_line_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher_line" ADD CONSTRAINT "tally_voucher_line_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher_line" ADD CONSTRAINT "tally_voucher_line_voucher_fk" FOREIGN KEY ("voucher_id","tenant_id","entity_id") REFERENCES "public"."tally_voucher"("id","tenant_id","entity_id") ON DELETE cascade ON UPDATE no action;
