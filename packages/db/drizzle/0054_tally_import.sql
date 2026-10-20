CREATE TABLE "tally_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" text DEFAULT 'read' NOT NULL,
	"files" jsonb NOT NULL,
	"company" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_by" text,
	"committed_at" timestamp with time zone,
	CONSTRAINT "tally_import_status_ck" CHECK ("tally_import"."status" in ('read','committed','discarded')),
	CONSTRAINT "tally_import_commit_ck" CHECK (("tally_import"."status" = 'committed') = ("tally_import"."committed_at" is not null and "tally_import"."committed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "tally_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"guid" text NOT NULL,
	"target_id" uuid NOT NULL,
	"alter_id" integer,
	"name" text NOT NULL,
	"import_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally_staged" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"guid" text,
	"alter_id" integer,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"proposed" text NOT NULL,
	"action" text NOT NULL,
	"target_id" uuid,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_id" uuid,
	CONSTRAINT "tally_staged_kind_ck" CHECK ("tally_staged"."kind" in ('group','ledger','party','stockgroup','unit','godown','stockitem')),
	CONSTRAINT "tally_staged_action_ck" CHECK ("tally_staged"."proposed" in ('new','link','update','unchanged','conflict','skip') and "tally_staged"."action" in ('new','link','update','unchanged','conflict','skip'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tally_import_scope_uq" ON "tally_import" USING btree ("id","tenant_id","entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tally_link_guid_uq" ON "tally_link" USING btree ("entity_id","kind","guid");
--> statement-breakpoint
CREATE UNIQUE INDEX "tally_link_target_uq" ON "tally_link" USING btree ("entity_id","kind","target_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tally_staged_ordinal_uq" ON "tally_staged" USING btree ("import_id","ordinal");
--> statement-breakpoint
CREATE INDEX "tally_staged_import_kind_idx" ON "tally_staged" USING btree ("import_id","kind");
--> statement-breakpoint
ALTER TABLE "tally_import" ADD CONSTRAINT "tally_import_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_import" ADD CONSTRAINT "tally_import_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_import" ADD CONSTRAINT "tally_import_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_import" ADD CONSTRAINT "tally_import_committed_by_user_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_import" ADD CONSTRAINT "tally_import_entity_fk" FOREIGN KEY ("entity_id","tenant_id") REFERENCES "public"."legal_entity"("id","tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_link" ADD CONSTRAINT "tally_link_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_link" ADD CONSTRAINT "tally_link_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_link" ADD CONSTRAINT "tally_link_import_fk" FOREIGN KEY ("import_id","tenant_id","entity_id") REFERENCES "public"."tally_import"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_staged" ADD CONSTRAINT "tally_staged_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_staged" ADD CONSTRAINT "tally_staged_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tally_staged" ADD CONSTRAINT "tally_staged_import_fk" FOREIGN KEY ("import_id","tenant_id","entity_id") REFERENCES "public"."tally_import"("id","tenant_id","entity_id") ON DELETE cascade ON UPDATE no action;
