CREATE TABLE "gst_sandbox_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"lease_token" uuid NOT NULL,
	"credential_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_sandbox_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"provider" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"credential_revision" integer DEFAULT 0 NOT NULL,
	"scenario" text DEFAULT 'normal' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gst_sandbox_conn_sandbox" CHECK ("gst_sandbox_connection"."environment"='sandbox' and "gst_sandbox_connection"."provider" in ('mock','nic_direct') and "gst_sandbox_connection"."capability" in ('irn','ewb') and "gst_sandbox_connection"."scenario" in ('normal','timeout_after_success','rejected','unsupported_lookup','mismatched_lookup'))
);
--> statement-breakpoint
CREATE TABLE "gst_sandbox_credential_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_sandbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_sandbox_mock_remote" (
	"key" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_sandbox_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"generation_key" text,
	"idempotency_key" text NOT NULL,
	"command" jsonb NOT NULL,
	"command_hash" text NOT NULL,
	"connection_revision" integer NOT NULL,
	"provider" text NOT NULL,
	"scenario" text NOT NULL,
	"parent_id" uuid,
	"result" jsonb,
	"detached_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"attempt_sequence" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gst_sandbox_op_sandbox" CHECK ("gst_sandbox_operation"."environment"='sandbox' and "gst_sandbox_operation"."provider" in ('mock','nic_direct')),
	CONSTRAINT "gst_sandbox_op_status" CHECK ("gst_sandbox_operation"."status" in ('prepared','queued','sending','succeeded','rejected','unknown','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "gst_sandbox_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"fy" text NOT NULL,
	"payload" jsonb NOT NULL,
	"hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gst_sandbox_attempt_seq" ON "gst_sandbox_attempt" USING btree ("operation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_sandbox_conn_scope_uq" ON "gst_sandbox_connection" USING btree ("id","tenant_id","entity_id","registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_sandbox_conn_cap_uq" ON "gst_sandbox_connection" USING btree ("registration_id","environment","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_sandbox_cred_rev_uq" ON "gst_sandbox_credential_revision" USING btree ("connection_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_sandbox_operation_scope_uq" ON "gst_sandbox_operation" USING btree ("id","tenant_id","entity_id","registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_sandbox_generation_uq" ON "gst_sandbox_operation" USING btree ("tenant_id","registration_id","environment","generation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_sandbox_idempotency_uq" ON "gst_sandbox_operation" USING btree ("tenant_id","entity_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_sandbox_snapshot_scope_uq" ON "gst_sandbox_snapshot" USING btree ("id","tenant_id","entity_id","registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_registration_scope_uq" ON "gst_registration" USING btree ("id","tenant_id","entity_id");--> statement-breakpoint
ALTER TABLE "gst_sandbox_attempt" ADD CONSTRAINT "gst_sandbox_attempt_op_fk" FOREIGN KEY ("operation_id","tenant_id","entity_id","registration_id") REFERENCES "public"."gst_sandbox_operation"("id","tenant_id","entity_id","registration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_connection" ADD CONSTRAINT "gst_sandbox_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_connection" ADD CONSTRAINT "gst_sandbox_conn_reg_fk" FOREIGN KEY ("registration_id","tenant_id","entity_id") REFERENCES "public"."gst_registration"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_credential_revision" ADD CONSTRAINT "gst_sandbox_credential_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_credential_revision" ADD CONSTRAINT "gst_sandbox_cred_conn_fk" FOREIGN KEY ("connection_id","tenant_id","entity_id","registration_id") REFERENCES "public"."gst_sandbox_connection"("id","tenant_id","entity_id","registration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_event" ADD CONSTRAINT "gst_sandbox_event_op_fk" FOREIGN KEY ("operation_id","tenant_id","entity_id","registration_id") REFERENCES "public"."gst_sandbox_operation"("id","tenant_id","entity_id","registration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_operation" ADD CONSTRAINT "gst_sandbox_operation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_operation" ADD CONSTRAINT "gst_sandbox_op_conn_fk" FOREIGN KEY ("connection_id","tenant_id","entity_id","registration_id") REFERENCES "public"."gst_sandbox_connection"("id","tenant_id","entity_id","registration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_operation" ADD CONSTRAINT "gst_sandbox_op_snap_fk" FOREIGN KEY ("snapshot_id","tenant_id","entity_id","registration_id") REFERENCES "public"."gst_sandbox_snapshot"("id","tenant_id","entity_id","registration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_snapshot" ADD CONSTRAINT "gst_sandbox_snapshot_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_sandbox_snapshot" ADD CONSTRAINT "gst_sandbox_snapshot_reg_fk" FOREIGN KEY ("registration_id","tenant_id","entity_id") REFERENCES "public"."gst_registration"("id","tenant_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gst_sandbox_queue" ON "gst_sandbox_operation" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "gst_sandbox_snapshot_source" ON "gst_sandbox_snapshot" USING btree ("entity_id","source_kind","source_id");--> statement-breakpoint
CREATE FUNCTION gst_sandbox_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Sandbox evidence is append-only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER gst_sandbox_snapshot_immutable BEFORE UPDATE OR DELETE ON gst_sandbox_snapshot FOR EACH ROW EXECUTE FUNCTION gst_sandbox_append_only();
--> statement-breakpoint
CREATE TRIGGER gst_sandbox_credential_immutable BEFORE UPDATE OR DELETE ON gst_sandbox_credential_revision FOR EACH ROW EXECUTE FUNCTION gst_sandbox_append_only();
--> statement-breakpoint
CREATE TRIGGER gst_sandbox_attempt_immutable BEFORE UPDATE OR DELETE ON gst_sandbox_attempt FOR EACH ROW EXECUTE FUNCTION gst_sandbox_append_only();
--> statement-breakpoint
CREATE TRIGGER gst_sandbox_event_immutable BEFORE UPDATE OR DELETE ON gst_sandbox_event FOR EACH ROW EXECUTE FUNCTION gst_sandbox_append_only();
--> statement-breakpoint
CREATE FUNCTION gst_sandbox_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sandbox operations cannot be deleted'; END IF;
 IF ROW(NEW.tenant_id,NEW.entity_id,NEW.registration_id,NEW.connection_id,NEW.snapshot_id,NEW.environment,NEW.action,NEW.command,NEW.command_hash,NEW.connection_revision,NEW.provider,NEW.scenario,NEW.parent_id,NEW.idempotency_key,NEW.generation_key,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.entity_id,OLD.registration_id,OLD.connection_id,OLD.snapshot_id,OLD.environment,OLD.action,OLD.command,OLD.command_hash,OLD.connection_revision,OLD.provider,OLD.scenario,OLD.parent_id,OLD.idempotency_key,OLD.generation_key,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Sandbox operation identity is immutable'; END IF; RETURN NEW;
 END; $$;
--> statement-breakpoint
CREATE TRIGGER gst_sandbox_operation_immutable BEFORE UPDATE OR DELETE ON gst_sandbox_operation FOR EACH ROW EXECUTE FUNCTION gst_sandbox_operation_identity();
