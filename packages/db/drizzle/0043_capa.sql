CREATE TYPE "public"."capa_action_kind" AS ENUM('containment', 'corrective', 'preventive');--> statement-breakpoint
CREATE TYPE "public"."capa_action_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."capa_severity" AS ENUM('minor', 'major');--> statement-breakpoint
CREATE TYPE "public"."capa_source" AS ENUM('ncr', 'audit', 'complaint', 'other');--> statement-breakpoint
CREATE TYPE "public"."capa_status" AS ENUM('open', 'in_action', 'verifying', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "capa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"source" "capa_source" NOT NULL,
	"title" text NOT NULL,
	"problem" text NOT NULL,
	"severity" "capa_severity" NOT NULL,
	"owner_user_id" text NOT NULL,
	"verify_after_days" integer DEFAULT 60 NOT NULL,
	"whys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"root_cause" text,
	"team" text,
	"containment" text,
	"recognition" text,
	"status" "capa_status" DEFAULT 'open' NOT NULL,
	"verify_due_on" date,
	"closed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capa_verify_ck" CHECK ("capa"."verify_after_days" between 30 and 180)
);
--> statement-breakpoint
CREATE TABLE "capa_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capa_id" uuid NOT NULL,
	"kind" "capa_action_kind" NOT NULL,
	"description" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"due_on" date NOT NULL,
	"status" "capa_action_status" DEFAULT 'open' NOT NULL,
	"done_on" date,
	"done_note" text,
	"done_by" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capa_ncr" (
	"capa_id" uuid NOT NULL,
	"ncr_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capa_verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capa_id" uuid NOT NULL,
	"effective" boolean NOT NULL,
	"note" text NOT NULL,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capa" ADD CONSTRAINT "capa_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa" ADD CONSTRAINT "capa_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa" ADD CONSTRAINT "capa_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa" ADD CONSTRAINT "capa_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_action" ADD CONSTRAINT "capa_action_capa_id_capa_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_action" ADD CONSTRAINT "capa_action_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_action" ADD CONSTRAINT "capa_action_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_ncr" ADD CONSTRAINT "capa_ncr_capa_id_capa_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_ncr" ADD CONSTRAINT "capa_ncr_ncr_id_ncr_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_verification" ADD CONSTRAINT "capa_verification_capa_id_capa_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_verification" ADD CONSTRAINT "capa_verification_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capa_number_uq" ON "capa" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "capa_status_idx" ON "capa" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "capa_action_capa_idx" ON "capa_action" USING btree ("capa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capa_ncr_uq" ON "capa_ncr" USING btree ("capa_id","ncr_id");--> statement-breakpoint
CREATE INDEX "capa_ncr_ncr_idx" ON "capa_ncr" USING btree ("ncr_id");--> statement-breakpoint
CREATE INDEX "capa_verification_capa_idx" ON "capa_verification" USING btree ("capa_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION capa_verification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CAPA verifications are kept; record a new one instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER capa_verification_immutable BEFORE UPDATE OR DELETE ON "capa_verification" FOR EACH ROW EXECUTE FUNCTION capa_verification_immutable();
