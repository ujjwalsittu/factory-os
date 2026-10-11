CREATE TABLE "billing_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"as_of" date NOT NULL,
	"kinds" jsonb NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_run_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sales_invoice_id" uuid,
	"customer_id" uuid NOT NULL,
	"customer_ref" text,
	"items" jsonb NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"submit_error" text
);
--> statement-breakpoint
ALTER TABLE "billing_run" ADD CONSTRAINT "billing_run_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_run" ADD CONSTRAINT "billing_run_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_run" ADD CONSTRAINT "billing_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_run_invoice" ADD CONSTRAINT "billing_run_invoice_run_id_billing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."billing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_run_invoice" ADD CONSTRAINT "billing_run_invoice_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_run_invoice" ADD CONSTRAINT "billing_run_invoice_customer_id_party_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_run_number_uq" ON "billing_run" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "billing_run_invoice_run_idx" ON "billing_run_invoice" USING btree ("run_id");