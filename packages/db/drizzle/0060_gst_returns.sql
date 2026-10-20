CREATE TABLE "gst_return" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"gst_registration_id" uuid NOT NULL,
	"period" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"prepared_by" text NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"filed_by" text,
	"filed_at" timestamp with time zone,
	"arn" text,
	"filed_on" date,
	CONSTRAINT "gst_return_kind_ck" CHECK ("gst_return"."kind" in ('gstr1','gstr3b')),
	CONSTRAINT "gst_return_status_ck" CHECK ("gst_return"."status" in ('draft','reviewed','approved','filed')),
	CONSTRAINT "gst_return_period_ck" CHECK ("gst_return"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "gst_return_filed_ck" CHECK (("gst_return"."status" = 'filed') = ("gst_return"."arn" is not null and "gst_return"."filed_on" is not null and "gst_return"."filed_by" is not null)),
	CONSTRAINT "gst_return_maker_checker_ck" CHECK ("gst_return"."approved_by" is null or "gst_return"."approved_by" <> "gst_return"."prepared_by")
);
--> statement-breakpoint
CREATE TABLE "gst_return_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"section" text NOT NULL,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"document_date" date NOT NULL,
	"late_from" text,
	"figures" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uom" ADD COLUMN "gst_uqc" text;--> statement-breakpoint
ALTER TABLE "gst_return" ADD CONSTRAINT "gst_return_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_return" ADD CONSTRAINT "gst_return_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_return" ADD CONSTRAINT "gst_return_gst_registration_id_gst_registration_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_return" ADD CONSTRAINT "gst_return_prepared_by_user_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_return" ADD CONSTRAINT "gst_return_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_return" ADD CONSTRAINT "gst_return_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_return" ADD CONSTRAINT "gst_return_filed_by_user_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_return_line" ADD CONSTRAINT "gst_return_line_return_id_gst_return_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."gst_return"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gst_return_period_uq" ON "gst_return" USING btree ("gst_registration_id","period","kind");--> statement-breakpoint
CREATE INDEX "gst_return_entity_idx" ON "gst_return" USING btree ("entity_id","period");--> statement-breakpoint
CREATE INDEX "gst_return_line_return_idx" ON "gst_return_line" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "gst_return_line_document_idx" ON "gst_return_line" USING btree ("document_id");--> statement-breakpoint
-- Decision 074: standard units get their GST UQC; the rest are chosen on the unit form.
UPDATE "uom" SET "gst_uqc" = CASE "code" WHEN 'NOS' THEN 'NOS' WHEN 'SET' THEN 'SET' WHEN 'BOX' THEN 'BOX' WHEN 'KG' THEN 'KGS' WHEN 'G' THEN 'GMS' WHEN 'M' THEN 'MTR' WHEN 'L' THEN 'LTR' WHEN 'ML' THEN 'MLT' WHEN 'SQM' THEN 'SQM' END WHERE "gst_uqc" IS NULL;--> statement-breakpoint
-- A filed return's lines are its frozen snapshot: never changed or removed.
CREATE FUNCTION gst_return_line_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM gst_return r WHERE r.id = COALESCE(OLD.return_id, NEW.return_id) AND r.status = 'filed') THEN
    RAISE EXCEPTION 'A filed GST return''s lines cannot change';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint
CREATE TRIGGER gst_return_line_frozen BEFORE INSERT OR UPDATE OR DELETE ON gst_return_line FOR EACH ROW EXECUTE FUNCTION gst_return_line_frozen();--> statement-breakpoint
CREATE FUNCTION gst_return_filed_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'filed' AND (NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.status <> 'filed' OR NEW.arn IS DISTINCT FROM OLD.arn OR NEW.filed_on IS DISTINCT FROM OLD.filed_on) THEN
    RAISE EXCEPTION 'A filed GST return cannot change';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER gst_return_filed_frozen BEFORE UPDATE ON gst_return FOR EACH ROW EXECUTE FUNCTION gst_return_filed_frozen();--> statement-breakpoint
CREATE FUNCTION gst_return_filed_kept() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A filed GST return cannot be removed';
END $$;--> statement-breakpoint
CREATE TRIGGER gst_return_filed_no_delete BEFORE DELETE ON gst_return FOR EACH ROW WHEN (OLD.status = 'filed') EXECUTE FUNCTION gst_return_filed_kept();
