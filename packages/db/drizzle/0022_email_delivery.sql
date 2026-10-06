CREATE TABLE "email_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"tenant_id" uuid,
	"scope_key" text NOT NULL,
	"lease_token" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_attempt_tenant_ck" CHECK ("email_attempt"."scope_key"=coalesce("email_attempt"."tenant_id"::text,'account'))
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"scope_key" text NOT NULL,
	"purpose" text NOT NULL,
	"source" jsonb NOT NULL,
	"invitation_id" uuid,
	"source_user_id" text,
	"source_expires_at" timestamp with time zone NOT NULL,
	"dedupe_key" text NOT NULL,
	"template_version" text NOT NULL,
	"recipient_masked" text NOT NULL,
	"envelope" jsonb,
	"status" text NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"dispatch_started_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_scope_ck" CHECK ("email_delivery"."scope_key"=coalesce("email_delivery"."tenant_id"::text,'account') and (("email_delivery"."purpose" in ('member_invitation','owner_invitation') and "email_delivery"."tenant_id" is not null and "email_delivery"."invitation_id" is not null and "email_delivery"."source_user_id" is null and "email_delivery"."source"->>'kind'='invitation' and "email_delivery"."source"->>'tenantId'="email_delivery"."tenant_id"::text and "email_delivery"."source"->>'invitationId'="email_delivery"."invitation_id"::text) or ("email_delivery"."purpose" in ('password_reset','email_verification') and "email_delivery"."tenant_id" is null and "email_delivery"."invitation_id" is null and "email_delivery"."source_user_id" is not null and "email_delivery"."source"->>'kind'="email_delivery"."purpose" and "email_delivery"."source"->>'userId'="email_delivery"."source_user_id"))),
	CONSTRAINT "email_state_ck" CHECK ("email_delivery"."status" in ('unconfigured','queued','dispatching','retry_scheduled','accepted','failed','unknown','expired','cancelled','superseded') and "email_delivery"."retry_count" between 0 and 5 and "email_delivery"."template_version"='v1' and (("email_delivery"."status"='dispatching')=("email_delivery"."lease_token" is not null and "email_delivery"."lease_expires_at" is not null)) and ("email_delivery"."status" not in ('unconfigured','accepted','expired','cancelled','superseded') or "email_delivery"."envelope" is null) and ("email_delivery"."status" not in ('queued','dispatching','retry_scheduled','unknown') or "email_delivery"."envelope" is not null) and ("email_delivery"."status" not in ('unconfigured','accepted','failed','unknown','expired','cancelled','superseded') or "email_delivery"."next_attempt_at" is null))
);
--> statement-breakpoint
CREATE TABLE "email_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt_id" uuid,
	"tenant_id" uuid,
	"scope_key" text NOT NULL,
	"kind" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_event_tenant_ck" CHECK ("email_event"."scope_key"=coalesce("email_event"."tenant_id"::text,'account'))
);
--> statement-breakpoint
CREATE TABLE "email_rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"identity_hash" text NOT NULL,
	"kind" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_rate_ck" CHECK ("email_rate_limit"."identity_hash" ~ '^[a-f0-9]{64}$' and "email_rate_limit"."kind" in ('recipient','origin') and "email_rate_limit"."count">0)
);
--> statement-breakpoint
CREATE TABLE "email_worker_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"last_seen_at" timestamp with time zone NOT NULL,
	"configuration_state" text NOT NULL,
	CONSTRAINT "email_heartbeat_ck" CHECK ("email_worker_heartbeat"."tenant_id" is null and "email_worker_heartbeat"."configuration_state" in ('disabled','ready','unavailable'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_attempt_scope_uq" ON "email_attempt" USING btree ("id","delivery_id","scope_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_scope_uq" ON "email_delivery" USING btree ("id","scope_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_replay_uq" ON "email_delivery" USING btree ("purpose","scope_key","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_rate_window_uq" ON "email_rate_limit" USING btree ("kind","identity_hash","window_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_id_tenant_uq" ON "invitation" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "email_attempt" ADD CONSTRAINT "email_attempt_parent_fk" FOREIGN KEY ("delivery_id","scope_key") REFERENCES "public"."email_delivery"("id","scope_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_invitation_scope_fk" FOREIGN KEY ("invitation_id","tenant_id") REFERENCES "public"."invitation"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_event" ADD CONSTRAINT "email_event_parent_fk" FOREIGN KEY ("delivery_id","scope_key") REFERENCES "public"."email_delivery"("id","scope_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_event" ADD CONSTRAINT "email_event_attempt_fk" FOREIGN KEY ("attempt_id","delivery_id","scope_key") REFERENCES "public"."email_attempt"("id","delivery_id","scope_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_delivery_due_idx" ON "email_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE FUNCTION guard_email_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent email_delivery; cutoff timestamptz; cleanup_now timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN
  cutoff := nullif(current_setting('factoryos.email_cleanup_before',true),'')::timestamptz;
  cleanup_now := nullif(current_setting('factoryos.email_cleanup_now',true),'')::timestamptz;
  IF TG_TABLE_NAME='email_delivery' THEN parent:=OLD;
  ELSE SELECT * INTO parent FROM email_delivery WHERE id=OLD.delivery_id; END IF;
  IF cutoff IS NULL OR cleanup_now IS NULL OR parent.id IS NULL OR parent.created_at>cutoff OR parent.source_expires_at>cleanup_now OR parent.status IN ('queued','dispatching','retry_scheduled') THEN
   RAISE EXCEPTION 'Email evidence retention refused';
  END IF;
  RETURN OLD;
 END IF;
 IF TG_TABLE_NAME<>'email_delivery' THEN RAISE EXCEPTION 'Email evidence is append-only'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','retry_count','next_attempt_at','lease_token','lease_expires_at','worker_id','dispatch_started_at','last_attempt_at','error_code','updated_at','envelope']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','retry_count','next_attempt_at','lease_token','lease_expires_at','worker_id','dispatch_started_at','last_attempt_at','error_code','updated_at','envelope']) OR (NEW.envelope IS DISTINCT FROM OLD.envelope AND NEW.envelope IS NOT NULL) THEN
  RAISE EXCEPTION 'Frozen email identity/envelope cannot change';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER email_delivery_guard BEFORE UPDATE OR DELETE ON email_delivery FOR EACH ROW EXECUTE FUNCTION guard_email_evidence();
--> statement-breakpoint
CREATE TRIGGER email_attempt_guard BEFORE UPDATE OR DELETE ON email_attempt FOR EACH ROW EXECUTE FUNCTION guard_email_evidence();
--> statement-breakpoint
CREATE TRIGGER email_event_guard BEFORE UPDATE OR DELETE ON email_event FOR EACH ROW EXECUTE FUNCTION guard_email_evidence();
