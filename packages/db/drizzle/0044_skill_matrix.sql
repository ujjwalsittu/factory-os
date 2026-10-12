CREATE TYPE "public"."skill_level" AS ENUM('trainee', 'qualified', 'trainer');--> statement-breakpoint
CREATE TABLE "machine_skill" (
	"machine_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "machine_skill_machine_id_skill_id_pk" PRIMARY KEY("machine_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"recertify_months" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_months_ck" CHECK ("skill"."recertify_months" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "skill_certification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" "skill_level" NOT NULL,
	"certified_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"certified_by" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text,
	CONSTRAINT "skill_certification_dates_ck" CHECK ("skill_certification"."expires_on" > "skill_certification"."certified_on"),
	CONSTRAINT "skill_certification_self_ck" CHECK ("skill_certification"."certified_by" <> "skill_certification"."user_id")
);
--> statement-breakpoint
CREATE TABLE "skill_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"machine_id" uuid,
	"reason" text NOT NULL,
	"valid_on" date NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_card_id" uuid,
	CONSTRAINT "skill_override_self_ck" CHECK ("skill_override"."granted_by" <> "skill_override"."user_id")
);
--> statement-breakpoint
CREATE TABLE "work_centre_skill" (
	"work_centre_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "work_centre_skill_work_centre_id_skill_id_pk" PRIMARY KEY("work_centre_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "cosign_user_id" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "cosigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inspection_plan" ADD COLUMN "required_skill_id" uuid;--> statement-breakpoint
ALTER TABLE "machine_skill" ADD CONSTRAINT "machine_skill_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_skill" ADD CONSTRAINT "machine_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_certification" ADD CONSTRAINT "skill_certification_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_certification" ADD CONSTRAINT "skill_certification_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_certification" ADD CONSTRAINT "skill_certification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_certification" ADD CONSTRAINT "skill_certification_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_certification" ADD CONSTRAINT "skill_certification_certified_by_user_id_fk" FOREIGN KEY ("certified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_certification" ADD CONSTRAINT "skill_certification_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_override" ADD CONSTRAINT "skill_override_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_override" ADD CONSTRAINT "skill_override_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_override" ADD CONSTRAINT "skill_override_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_override" ADD CONSTRAINT "skill_override_operation_id_work_order_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."work_order_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_override" ADD CONSTRAINT "skill_override_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_override" ADD CONSTRAINT "skill_override_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_override" ADD CONSTRAINT "skill_override_job_card_id_job_card_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centre_skill" ADD CONSTRAINT "work_centre_skill_work_centre_id_work_centre_id_fk" FOREIGN KEY ("work_centre_id") REFERENCES "public"."work_centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centre_skill" ADD CONSTRAINT "work_centre_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_code_uq" ON "skill" USING btree ("entity_id","code");--> statement-breakpoint
CREATE INDEX "skill_certification_user_idx" ON "skill_certification" USING btree ("entity_id","user_id","skill_id");--> statement-breakpoint
CREATE INDEX "skill_certification_skill_idx" ON "skill_certification" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_override_operation_idx" ON "skill_override" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_override_card_uq" ON "skill_override" USING btree ("job_card_id");--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_cosign_user_id_user_id_fk" FOREIGN KEY ("cosign_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plan" ADD CONSTRAINT "inspection_plan_required_skill_id_skill_id_fk" FOREIGN KEY ("required_skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION skill_certification_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
     AND (to_jsonb(NEW) - 'revoked_at' - 'revoked_by' - 'revoke_reason') = (to_jsonb(OLD) - 'revoked_at' - 'revoked_by' - 'revoke_reason') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Certifications are kept; record a new one or revoke it once';
END;
$$;--> statement-breakpoint
CREATE TRIGGER skill_certification_append_only BEFORE UPDATE OR DELETE ON "skill_certification" FOR EACH ROW EXECUTE FUNCTION skill_certification_append_only();
