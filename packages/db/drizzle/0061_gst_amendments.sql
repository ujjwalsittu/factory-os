CREATE TABLE "gst_amendment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"key" text NOT NULL,
	"amend_table" text NOT NULL,
	"document_type" text,
	"document_id" uuid,
	"original_period" text NOT NULL,
	"reported" jsonb NOT NULL,
	"revised" jsonb NOT NULL,
	"difference" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "gst_amendment_table_ck" CHECK ("gst_amendment"."amend_table" in ('b2ba','b2cla','expa','cdnra','cdnura','b2csa')),
	CONSTRAINT "gst_amendment_status_ck" CHECK ("gst_amendment"."status" in ('proposed','included','dropped')),
	CONSTRAINT "gst_amendment_dropped_reason_ck" CHECK ("gst_amendment"."status" <> 'dropped' or length(trim("gst_amendment"."reason")) >= 5),
	CONSTRAINT "gst_amendment_decided_ck" CHECK (("gst_amendment"."status" = 'proposed') = ("gst_amendment"."decided_by" is null))
);
--> statement-breakpoint
ALTER TABLE "gst_amendment" ADD CONSTRAINT "gst_amendment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_amendment" ADD CONSTRAINT "gst_amendment_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_amendment" ADD CONSTRAINT "gst_amendment_return_id_gst_return_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."gst_return"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_amendment" ADD CONSTRAINT "gst_amendment_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gst_amendment_key_uq" ON "gst_amendment" USING btree ("return_id","key");--> statement-breakpoint
CREATE INDEX "gst_amendment_document_idx" ON "gst_amendment" USING btree ("document_id");--> statement-breakpoint
-- Decision 074b: amendments are frozen with the GSTR-1 that carries them once it is filed (same rule as its lines).
CREATE TRIGGER gst_amendment_frozen BEFORE INSERT OR UPDATE OR DELETE ON gst_amendment FOR EACH ROW EXECUTE FUNCTION gst_return_line_frozen();
